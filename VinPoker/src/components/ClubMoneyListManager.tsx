import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Upload, Trash2 } from "lucide-react";

type ParsedRow = {
  rank?: number;
  name: string;
  amount: number;
  matches: { user_id: string; display_name: string }[];
  selected: string | "skip";
};

const parseLine = (line: string) => {
  const cleaned = line.trim();
  if (!cleaned) return null;
  const rankMatch = cleaned.match(/^(\d{1,3})[.)\s]+(.*)$/);
  let rank: number | undefined;
  let rest = cleaned;
  if (rankMatch) { rank = parseInt(rankMatch[1], 10); rest = rankMatch[2]; }
  const amountMatch = rest.match(/([\$₫]?\s*[\d.,]+)\s*[A-Za-z₫\$]*\s*$/);
  if (!amountMatch) return null;
  const rawAmount = amountMatch[1].replace(/[^\d]/g, "");
  if (!rawAmount) return null;
  const amount = parseInt(rawAmount, 10);
  const name = rest.slice(0, amountMatch.index).replace(/[—\-–|\t]+$/g, "").trim();
  if (!name) return null;
  return { rank, name, amount };
};

interface Props {
  currentUserId: string;
  clubs: { id: string; name: string }[];
}

export const ClubMoneyListManager = ({ currentUserId, clubs }: Props) => {
  const [busy, setBusy] = useState(true);
  const [profiles, setProfiles] = useState<{ user_id: string; display_name: string }[]>([]);
  const [existing, setExisting] = useState<any[]>([]);
  const [clubId, setClubId] = useState<string>(clubs[0]?.id ?? "");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    if (!clubId) { setBusy(false); return; }
    setBusy(true);
    const [{ data: p }, { data: list }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name"),
      supabase.from("club_money_list").select("*").eq("club_id", clubId).order("total_winnings", { ascending: false }),
    ]);
    setProfiles((p ?? []).filter((x: any) => x.display_name));
    setExisting(list ?? []);
    setBusy(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clubId]);
  useEffect(() => { if (!clubId && clubs[0]) setClubId(clubs[0].id); }, [clubs, clubId]);

  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  const profileIndex = useMemo(() => {
    const m: Record<string, { user_id: string; display_name: string }[]> = {};
    profiles.forEach((p) => { const k = norm(p.display_name); (m[k] ||= []).push(p); });
    return m;
  }, [profiles]);

  const handleParse = () => {
    if (!clubId) return toast.error("Chọn 1 CLB trước");
    const parsed: ParsedRow[] = [];
    for (const line of text.split(/\r?\n/)) {
      const r = parseLine(line);
      if (!r) continue;
      const matches = profileIndex[norm(r.name)] ?? [];
      parsed.push({ ...r, matches, selected: matches.length === 1 ? matches[0].user_id : "skip" });
      if (parsed.length >= 200) break;
    }
    if (!parsed.length) return toast.error("Không có dòng hợp lệ. Format: `1. Tên 123,456`");
    setRows(parsed);
    const matched = parsed.filter((r) => r.selected !== "skip").length;
    toast.success(`${parsed.length} dòng · ${matched} khớp acc`);
  };

  const handleImport = async () => {
    if (!rows || !clubId) return;
    const toInsert = rows.map((r) => ({
      club_id: clubId,
      player_id: r.selected && r.selected !== "skip" ? r.selected : null,
      display_name: r.name,
      total_winnings: r.amount,
      rank_source: r.rank ?? null,
      imported_by: currentUserId,
    }));
    setImporting(true);
    const { error: delErr } = await supabase.from("club_money_list").delete().eq("club_id", clubId);
    if (delErr) { setImporting(false); return toast.error(delErr.message); }
    const { error: insErr } = await supabase.from("club_money_list").insert(toInsert);
    setImporting(false);
    if (insErr) return toast.error(insErr.message);
    toast.success(`Đã import ${toInsert.length} player`);
    setText(""); setRows(null); load();
  };

  const handleClearAll = async () => {
    if (!clubId || !confirm("Xoá toàn bộ Money List của CLB này?")) return;
    const { error } = await supabase.from("club_money_list").delete().eq("club_id", clubId);
    if (error) toast.error(error.message); else { toast.success("Đã xoá"); load(); }
  };

  const clubName = clubs.find((c) => c.id === clubId)?.name ?? "";

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Chọn CLB</label>
        <Select value={clubId} onValueChange={setClubId}>
          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Chọn CLB..." /></SelectTrigger>
          <SelectContent>
            {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {!clubId ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Bạn chưa quản lý CLB nào.</Card>
      ) : busy ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold">1. Dán dữ liệu — {clubName}</div>
              <span className="text-[11px] text-muted-foreground">tối đa 200 dòng</span>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={`1. Nguyen Van A   1,234,567\n2. Tran Van B     980,000\n3. Le Van C       750,000`}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button onClick={handleParse} disabled={!text.trim()} size="sm" className="gradient-neon text-primary-foreground border-0">
                Phân tích
              </Button>
              {rows && <Button variant="ghost" size="sm" onClick={() => setRows(null)}>Reset</Button>}
            </div>
          </Card>

          {rows && (
            <Card className="p-4 space-y-2">
              <div className="text-sm font-semibold">2. Kiểm tra & khớp ({rows.length} dòng)</div>
              <div className="max-h-80 overflow-y-auto divide-y divide-border/50 -mx-1">
                {rows.map((r, i) => (
                  <div key={i} className="py-2 px-1 flex items-center gap-2 text-xs">
                    <div className="w-6 text-muted-foreground font-mono">{r.rank ?? i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-muted-foreground">{r.amount.toLocaleString("vi-VN")}₫</div>
                    </div>
                    <div className="w-44">
                      {r.matches.length === 0 ? (
                        <span className="text-muted-foreground text-[11px]">Chỉ tên (chưa có acc)</span>
                      ) : (
                        <Select
                          value={r.selected}
                          onValueChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, selected: v as any } : x))}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">— Bỏ qua —</SelectItem>
                            {r.matches.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button onClick={handleImport} disabled={importing} size="sm" className="w-full gradient-neon text-primary-foreground border-0">
                {importing ? "Đang import..." : <><Upload className="w-4 h-4 mr-1.5" />Thay thế & Import cho {clubName}</>}
              </Button>
            </Card>
          )}

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Danh sách hiện tại ({existing.length})</div>
              {existing.length > 0 && (
                <Button size="sm" variant="ghost" onClick={handleClearAll}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </div>
            {existing.length === 0 ? (
              <p className="text-xs text-muted-foreground">Trống.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-border/50 -mx-1">
                {existing.map((e, i) => (
                  <div key={e.id} className="py-1.5 px-1 flex items-center gap-2 text-xs">
                    <div className="w-6 text-muted-foreground font-mono">{i + 1}</div>
                    <div className="flex-1 truncate">{e.display_name}</div>
                    <div className="text-primary font-semibold">{Number(e.total_winnings).toLocaleString("vi-VN")}₫</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
