import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, Printer, Search, RefreshCw, IdCard, History, Save, Upload, X, Info } from "lucide-react";
import { toast } from "sonner";
import MemberCardPreview, { CardData } from "./MemberCardPreview";
import MemberCardBackPreview, { CardBackData } from "./MemberCardBackPreview";
import QrScanDialog from "./QrScanDialog";

interface Props {
  clubIds: string[];
  clubs: { id: string; name: string; cover_url?: string | null; address?: string | null }[];
}

type MemberRow = {
  id: string;
  club_id: string;
  member_card_id: string;
  full_name: string | null;
  player_user_id: string | null;
};

type LogRow = {
  id: string;
  member_card_id: string;
  reissue_code: string;
  reason: string | null;
  created_at: string;
  club_id: string;
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Scanned = { kind: "user_id" | "member_card_id" | "unknown"; value: string };

/** True when the DB error means the card_reissue_log table hasn't been applied yet (migration pending). */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  return /schema cache|does not exist|could not find the table|relation .* does not exist/i.test(e.message ?? "");
}

function parseScannedText(raw: string): Scanned {
  const s = raw.trim();
  if (!s) return { kind: "unknown", value: "" };
  const vinp = s.match(/^vinpoker:\/\/user\/([0-9a-f-]{36})/i);
  if (vinp) return { kind: "user_id", value: vinp[1] };
  try {
    const u = new URL(s);
    const userParam = u.searchParams.get("user_id") || u.searchParams.get("uid");
    if (userParam && UUID_RE.test(userParam)) return { kind: "user_id", value: userParam };
    const mcid = u.searchParams.get("member_card_id") || u.searchParams.get("card") || u.searchParams.get("mcid");
    if (mcid) return { kind: "member_card_id", value: mcid.trim() };
    const pathMatch = u.pathname.match(/\/(?:user|u|profile|p)\/([0-9a-f-]{36})/i);
    if (pathMatch) return { kind: "user_id", value: pathMatch[1] };
    const last = u.pathname.match(UUID_RE);
    if (last) return { kind: "user_id", value: last[0] };
  } catch {
    /* not URL */
  }
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object") {
      if (j.user_id && UUID_RE.test(String(j.user_id))) return { kind: "user_id", value: String(j.user_id) };
      const v = j.member_card_id || j.card || j.mcid;
      if (v) return { kind: "member_card_id", value: String(v).trim() };
    }
  } catch {
    /* not JSON */
  }
  if (UUID_RE.test(s) && s.length <= 40) return { kind: "user_id", value: s.match(UUID_RE)![0] };
  return { kind: "member_card_id", value: s };
}

function buildReissueCode() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `R-${yyyy}${mm}${dd}-${rand}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const DEFAULT_RULES = [
  "Xuất trình thẻ khi vào CLB.",
  "Không cho mượn hoặc chuyển nhượng thẻ.",
  "Báo mất trong 24h để được cấp lại.",
  "Tuân thủ nội quy và hướng dẫn của CLB.",
].join("\n");

const backStorageKey = (clubId: string) => `cashier:card-back:${clubId}`;
const designStorageKey = (clubId: string) => `cashier:card-design:${clubId}`;
type BackCfg = { rules: string; hotline: string; address: string };
type DesignCfg = { frontUrl?: string | null; backUrl?: string | null };

function loadBackCfg(clubId: string, fallbackAddress?: string | null): BackCfg {
  try {
    const raw = localStorage.getItem(backStorageKey(clubId));
    if (raw) return JSON.parse(raw) as BackCfg;
  } catch {
    /* ignore */
  }
  return { rules: DEFAULT_RULES, hotline: "", address: fallbackAddress ?? "" };
}

function loadDesignCfg(clubId: string): DesignCfg {
  try {
    const raw = localStorage.getItem(designStorageKey(clubId));
    if (raw) return JSON.parse(raw) as DesignCfg;
  } catch {
    /* ignore */
  }
  return {};
}

/** Renders a custom uploaded card image at CR80 size (85.6×54mm). */
function CustomCardImage({ url, label }: { url: string; label: string }) {
  return (
    <div
      className="overflow-hidden shadow-xl"
      style={{ width: "85.6mm", height: "54mm", borderRadius: "3mm", background: "#fff" }}
    >
      <img src={url} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );
}

export default function CardReissueTab({ clubIds, clubs }: Props) {
  const [scan, setScan] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState<MemberRow | null>(null);
  const [reason, setReason] = useState("");
  const [reissueCode, setReissueCode] = useState<string>(buildReissueCode());
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [logAvailable, setLogAvailable] = useState(true); // false when card_reissue_log migration not applied
  const [printing, setPrinting] = useState(false);
  const [savingMember, setSavingMember] = useState(false);
  const [targetClubId, setTargetClubId] = useState<string>(clubIds[0] ?? "");

  const [editFullName, setEditFullName] = useState("");
  const [editMemberCardId, setEditMemberCardId] = useState("");

  const [backRules, setBackRules] = useState(DEFAULT_RULES);
  const [backHotline, setBackHotline] = useState("");
  const [backAddress, setBackAddress] = useState("");

  const [frontDesignUrl, setFrontDesignUrl] = useState<string | null>(null);
  const [backDesignUrl, setBackDesignUrl] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const clubMap = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c])), [clubs]);

  useEffect(() => {
    if (!targetClubId && clubIds[0]) setTargetClubId(clubIds[0]);
  }, [clubIds, targetClubId]);

  useEffect(() => {
    const clubId = member?.club_id ?? targetClubId;
    if (!clubId) return;
    const cfg = loadBackCfg(clubId, clubMap[clubId]?.address ?? null);
    setBackRules(cfg.rules);
    setBackHotline(cfg.hotline);
    setBackAddress(cfg.address);
    const dcfg = loadDesignCfg(clubId);
    setFrontDesignUrl(dcfg.frontUrl ?? null);
    setBackDesignUrl(dcfg.backUrl ?? null);
  }, [member?.club_id, targetClubId, clubMap]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [member]);

  const loadLogs = useCallback(async () => {
    if (!clubIds.length) { setLogs([]); return; }
    // card_reissue_log is not in the generated types until the migration is applied → cast.
    const { data, error } = await (supabase as any)
      .from("card_reissue_log")
      .select("id, member_card_id, reissue_code, reason, created_at, club_id")
      .in("club_id", clubIds)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTable(error)) { setLogAvailable(false); setLogs([]); return; }
      setLogs([]);
      return;
    }
    setLogAvailable(true);
    setLogs((data ?? []) as LogRow[]);
  }, [clubIds]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const autoEnroll = async (userId: string): Promise<MemberRow | null> => {
    const clubId = targetClubId || clubIds[0];
    if (!clubId) {
      toast.error("Chưa chọn CLB để tạo hội viên");
      return null;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone")
      .eq("user_id", userId)
      .maybeSingle();

    const fullName = profile?.display_name?.trim() || "Hội viên mới";
    const d = new Date();
    const ymd =
      String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    const suffix = userId.replace(/-/g, "").slice(-4).toUpperCase();
    const rnd = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    const memberCardId = `VB-${ymd}-${suffix}${rnd}`;

    const { data: inserted, error } = await supabase
      .from("club_members")
      .insert({
        club_id: clubId,
        player_user_id: userId,
        member_card_id: memberCardId,
        full_name: fullName,
        phone: profile?.phone ?? null,
        source: "qr_scan",
      })
      .select("id, club_id, member_card_id, full_name, player_user_id")
      .single();

    if (error) {
      toast.error(`Không thể tạo hội viên: ${error.message}`);
      return null;
    }
    toast.success(`Đã xác thực hội viên cho CLB ${clubMap[clubId]?.name ?? ""}`);
    return inserted as MemberRow;
  };

  const lookup = async (text: string) => {
    const parsed = parseScannedText(text);
    if (!parsed.value) {
      toast.error("Mã trống");
      return;
    }
    setScan(parsed.value);
    setLoading(true);
    setMember(null);
    try {
      let query = supabase
        .from("club_members")
        .select("id, club_id, member_card_id, full_name, player_user_id")
        .in("club_id", clubIds);

      if (parsed.kind === "user_id") {
        query = query.eq("player_user_id", parsed.value);
      } else if (parsed.kind === "member_card_id") {
        query = query.eq("member_card_id", parsed.value);
      } else {
        query = query.or(`member_card_id.eq.${parsed.value},player_user_id.eq.${parsed.value}`);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;

      let row = data as MemberRow | null;

      if (!row && parsed.kind === "user_id") {
        row = await autoEnroll(parsed.value);
        if (!row) return;
      }

      if (!row) {
        toast.error("Không tìm thấy thẻ trong CLB bạn phụ trách");
        return;
      }

      setMember(row);
      setEditFullName(row.full_name ?? "");
      setEditMemberCardId(row.member_card_id);
      setReissueCode(buildReissueCode());
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Lỗi tra cứu"));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (scan.trim()) lookup(scan);
  };

  const activeClubId = member?.club_id ?? targetClubId;
  const activeClub = clubMap[activeClubId];

  const cardData: CardData = useMemo(
    () => ({
      clubName: activeClub?.name ?? "VBacker Club",
      clubLogoUrl: activeClub?.cover_url ?? null,
      fullName: member ? editFullName || "—" : "Tên hội viên",
      memberCardId: member ? editMemberCardId || "—" : "VB-YYMMDD-XXXX",
      reissueCode: member ? reissueCode : "",
      issuedAt: new Date(),
    }),
    [activeClub, member, editFullName, editMemberCardId, reissueCode],
  );

  const backData: CardBackData = useMemo(
    () => ({
      clubName: activeClub?.name ?? "VBacker Club",
      clubLogoUrl: activeClub?.cover_url ?? null,
      rules: backRules.split("\n"),
      hotline: backHotline,
      address: backAddress,
    }),
    [activeClub, backRules, backHotline, backAddress],
  );

  const saveBackCfg = () => {
    if (!activeClubId) return;
    try {
      localStorage.setItem(
        backStorageKey(activeClubId),
        JSON.stringify({ rules: backRules, hotline: backHotline, address: backAddress }),
      );
      toast.success("Đã lưu mẫu mặt sau cho CLB này");
    } catch {
      toast.error("Không lưu được mẫu mặt sau");
    }
  };

  const persistDesign = (next: DesignCfg) => {
    if (!activeClubId) return;
    try {
      localStorage.setItem(designStorageKey(activeClubId), JSON.stringify(next));
    } catch {
      toast.error("Không lưu được thiết kế (file có thể quá lớn)");
    }
  };

  const handleDesignUpload = (side: "front" | "back") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!activeClubId) { toast.error("Chưa chọn CLB"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Chỉ nhận file ảnh (PNG/JPG)"); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Ảnh tối đa 4MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (side === "front") { setFrontDesignUrl(url); persistDesign({ frontUrl: url, backUrl: backDesignUrl }); }
      else { setBackDesignUrl(url); persistDesign({ frontUrl: frontDesignUrl, backUrl: url }); }
      toast.success(`Đã cập nhật thiết kế mặt ${side === "front" ? "trước" : "sau"}`);
    };
    reader.onerror = () => toast.error("Đọc file thất bại");
    reader.readAsDataURL(file);
  };

  const clearDesign = (side: "front" | "back") => () => {
    if (side === "front") { setFrontDesignUrl(null); persistDesign({ frontUrl: null, backUrl: backDesignUrl }); }
    else { setBackDesignUrl(null); persistDesign({ frontUrl: frontDesignUrl, backUrl: null }); }
    toast.success(`Đã gỡ thiết kế mặt ${side === "front" ? "trước" : "sau"} (về mẫu mặc định)`);
  };

  const saveMemberEdits = async () => {
    if (!member) return;
    const newName = editFullName.trim();
    const newCard = editMemberCardId.trim();
    if (!newName || !newCard) { toast.error("Họ tên và mã thẻ không được để trống"); return; }
    if (newName === (member.full_name ?? "") && newCard === member.member_card_id) return;
    setSavingMember(true);
    try {
      const { error } = await supabase
        .from("club_members")
        .update({ full_name: newName, member_card_id: newCard })
        .eq("id", member.id);
      if (error) throw error;
      setMember({ ...member, full_name: newName, member_card_id: newCard });
      toast.success("Đã cập nhật hội viên");
    } catch (e) {
      toast.error(errorMessage(e, "Không cập nhật được hội viên"));
    } finally {
      setSavingMember(false);
    }
  };

  const printAndLog = async () => {
    if (!member) return;
    await saveMemberEdits();
    setPrinting(true);
    try {
      // Best-effort audit log — NEVER blocks printing. The physical card is the cashier's real job;
      // if card_reissue_log isn't applied yet (or a permission issue), we still print and just warn.
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (uid) {
        const { error } = await (supabase as any).from("card_reissue_log").insert({
          club_id: member.club_id,
          member_card_id: editMemberCardId.trim() || member.member_card_id,
          player_user_id: member.player_user_id,
          reissue_code: reissueCode,
          reason: reason.trim() || null,
          reissued_by: uid,
        });
        if (error) {
          if (isMissingTable(error)) {
            setLogAvailable(false);
            toast.warning("Đã in. Lịch sử cấp lại chưa bật (cần áp dụng cập nhật DB).");
          } else {
            toast.warning("Đã in. Không ghi được lịch sử: " + error.message);
          }
        } else {
          setLogAvailable(true);
          toast.success("Đã ghi lịch sử. Đang mở hộp in…");
          loadLogs();
        }
      }
      // ALWAYS open the print dialog.
      setTimeout(() => window.print(), 120);
    } catch (e: unknown) {
      toast.warning("Đang in. " + errorMessage(e, ""));
      setTimeout(() => window.print(), 120);
    } finally {
      setPrinting(false);
    }
  };

  const reset = () => {
    setMember(null);
    setScan("");
    setReason("");
    setEditFullName("");
    setEditMemberCardId("");
    setReissueCode(buildReissueCode());
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-4">
      {/* Hidden printable cards — both sides */}
      <div className="card-print-only fixed inset-0 z-[9999] hidden bg-white">
        <div className="card-print-page">
          {frontDesignUrl ? <CustomCardImage url={frontDesignUrl} label="Mặt trước" /> : <MemberCardPreview data={cardData} />}
        </div>
        <div className="card-print-page">
          {backDesignUrl ? <CustomCardImage url={backDesignUrl} label="Mặt sau" /> : <MemberCardBackPreview data={backData} />}
        </div>
      </div>

      {!logAvailable && (
        <Card className="no-print p-3 flex items-start gap-2 border-warning/40 bg-warning/5">
          <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <b className="text-foreground">In thẻ vẫn hoạt động bình thường.</b> Phần <b>Lịch sử cấp lại</b> chưa
            bật — cần áp dụng cập nhật DB (<code className="font-mono">card_reissue_log</code>). Sau khi áp dụng,
            mỗi lần in sẽ tự ghi nhật ký.
          </div>
        </Card>
      )}

      <Card className="p-4 no-print">
        <form onSubmit={onSubmitInput} className="space-y-3">
          {clubs.length > 1 && (
            <div>
              <Label className="text-xs">CLB sẽ tự xác thực hội viên (nếu chưa có)</Label>
              <select
                value={targetClubId}
                onChange={(e) => setTargetClubId(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {clubs.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
          )}
          <div>
            <Label className="text-xs">Mã thẻ / QR người chơi</Label>
            <div className="flex gap-2 mt-1">
              <Input
                ref={inputRef}
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Quét QR hoặc nhập mã thẻ rồi Enter"
                className="font-mono"
              />
              <Button type="submit" disabled={loading || !scan.trim()} size="default">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="ml-1 hidden sm:inline">Tra cứu</span>
              </Button>
              <Button type="button" variant="outline" onClick={() => setScanOpen(true)}>
                <Camera className="w-4 h-4" />
                <span className="ml-1 hidden sm:inline">Camera</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Quét QR VBacker (vinpoker://user/…) — nếu chưa là hội viên CLB{" "}
              <b>{clubMap[targetClubId]?.name ?? "—"}</b>, hệ thống tự cấp thẻ hội viên rồi mở xem trước để in.
            </p>
          </div>
        </form>
      </Card>

      {loading && <Skeleton className="h-48 rounded-xl no-print" />}

      {/* Edit + Preview */}
      <Card className="p-4 no-print space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <IdCard className="w-4 h-4 text-primary" /> Xem trước &amp; chỉnh sửa thẻ
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {member ? (
                <>CLB: {activeClub?.name ?? "—"} • Mã reissue: <span className="font-mono">{reissueCode}</span></>
              ) : (
                <>Mẫu thẻ sẽ in cho CLB: {activeClub?.name ?? "—"}</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <label className="inline-flex">
              <input type="file" accept="image/*" className="hidden" onChange={handleDesignUpload("front")} />
              <Button asChild variant="outline" size="sm" type="button">
                <span className="cursor-pointer"><Upload className="w-3.5 h-3.5 mr-1" /> Tải mặt trước</span>
              </Button>
            </label>
            <label className="inline-flex">
              <input type="file" accept="image/*" className="hidden" onChange={handleDesignUpload("back")} />
              <Button asChild variant="outline" size="sm" type="button">
                <span className="cursor-pointer"><Upload className="w-3.5 h-3.5 mr-1" /> Tải mặt sau</span>
              </Button>
            </label>
            {(frontDesignUrl || backDesignUrl) && (
              <>
                {frontDesignUrl && (
                  <Button variant="ghost" size="sm" onClick={clearDesign("front")} title="Gỡ thiết kế mặt trước">
                    <X className="w-3.5 h-3.5 mr-1" /> Mặt trước
                  </Button>
                )}
                {backDesignUrl && (
                  <Button variant="ghost" size="sm" onClick={clearDesign("back")} title="Gỡ thiết kế mặt sau">
                    <X className="w-3.5 h-3.5 mr-1" /> Mặt sau
                  </Button>
                )}
              </>
            )}
            {member && (
              <Button variant="ghost" size="sm" onClick={reset}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Mới
              </Button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* LEFT — edit forms */}
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mặt trước</div>
              <div>
                <Label className="text-xs">Họ và tên</Label>
                <Input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} disabled={!member}
                  placeholder={member ? "" : "Quét QR để hiển thị tên"} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Mã thẻ</Label>
                <Input value={editMemberCardId} onChange={(e) => setEditMemberCardId(e.target.value)} disabled={!member}
                  className="mt-1 font-mono" />
              </div>
              {member && (
                <Button type="button" variant="outline" size="sm" onClick={saveMemberEdits} disabled={savingMember}>
                  {savingMember ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                  Lưu thay đổi vào hội viên
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Ảnh lớn trên thẻ luôn dùng <b>logo CLB</b> (lấy từ ảnh CLB do admin setup).
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mặt sau — Nội quy</div>
              <div>
                <Label className="text-xs">Nội quy (mỗi dòng 1 mục, tối đa 6 dòng)</Label>
                <Textarea value={backRules} onChange={(e) => setBackRules(e.target.value)} rows={5} className="mt-1 text-sm" />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label className="text-xs">Hotline</Label>
                  <Input value={backHotline} onChange={(e) => setBackHotline(e.target.value)} placeholder="VD: 0909 000 000" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Địa chỉ</Label>
                  <Input value={backAddress} onChange={(e) => setBackAddress(e.target.value)} placeholder="VD: 123 Nguyễn Huệ, Q.1, TP.HCM" className="mt-1" />
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={saveBackCfg}>
                <Save className="w-3.5 h-3.5 mr-1" /> Lưu mẫu mặt sau cho CLB này
              </Button>
            </div>
          </div>

          {/* RIGHT — live preview */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-4 overflow-x-auto">
            <div>
              <div className="text-[11px] text-muted-foreground mb-2 text-center uppercase tracking-wider">
                Mặt trước {frontDesignUrl && <span className="text-primary">(thiết kế tải lên)</span>}
              </div>
              <div className="flex justify-center">
                {frontDesignUrl ? <CustomCardImage url={frontDesignUrl} label="Mặt trước" /> : <MemberCardPreview data={cardData} />}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-2 text-center uppercase tracking-wider">
                Mặt sau {backDesignUrl && <span className="text-primary">(thiết kế tải lên)</span>}
              </div>
              <div className="flex justify-center">
                {backDesignUrl ? <CustomCardImage url={backDesignUrl} label="Mặt sau" /> : <MemberCardBackPreview data={backData} />}
              </div>
            </div>
          </div>
        </div>

        {!member && (
          <p className="text-xs text-muted-foreground text-center">
            Quét QR VBacker hoặc nhập mã thẻ để thay mẫu bằng thông tin hội viên thật rồi in.
          </p>
        )}

        {member && (
          <>
            <div>
              <Label className="text-xs">Lý do cấp lại (tuỳ chọn)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="VD: thẻ mất, thẻ hỏng, đổi thông tin…" className="mt-1" />
            </div>
            <div className="flex gap-2">
              <Button onClick={printAndLog} disabled={printing} className="flex-1">
                {printing ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Printer className="w-4 h-4 mr-1" />}
                Lưu, ghi log &amp; In 2 mặt
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Khi mở dialog in, chọn máy in thẻ CR80 (85.6×54 mm). Bật "Background graphics" và in 2 trang (mặt trước + mặt sau).
            </p>
          </>
        )}
      </Card>

      <Card className="p-4 no-print">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4" /> Lịch sử cấp lại gần đây
          </div>
          <Button size="sm" variant="ghost" onClick={loadLogs}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
        {!logAvailable ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            Lịch sử sẽ bật sau khi áp dụng cập nhật DB <code className="font-mono">card_reissue_log</code>.
          </div>
        ) : logs === null ? (
          <Skeleton className="h-24" />
        ) : logs.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">Chưa có lịch sử</div>
        ) : (
          <div className="space-y-1 text-sm">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-border/20 py-1.5 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold truncate">{l.member_card_id}</div>
                  <div className="text-muted-foreground truncate">
                    {clubMap[l.club_id]?.name ?? "—"}{l.reason ? ` • ${l.reason}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] text-muted-foreground">{l.reissue_code}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleString("vi-VN")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={(text) => lookup(text)} />
    </div>
  );
}
