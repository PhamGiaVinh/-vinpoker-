import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { compressImage } from "@/lib/compressImage";
import { CheckCircle2, Copy, Loader2, Upload } from "lucide-react";

interface RegInfo {
  registration_id: string;
  reference_code: string;
  total_pay: number;
  breakdown: { buy_in: number; platform_fee: number };
  bank_name: string;
  account_number: string;
  account_holder: string;
  qr_code_url?: string | null;
  committed_at?: string;
  status?: string;
  transfer_proof_url?: string | null;
  transfer_proof_submitted?: boolean;
  already_registered?: boolean;
}

interface Props {
  tournamentId: string;
  tournamentName: string;
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

const TIMEOUT_MS = 30 * 60 * 1000;

const useCountdown = (deadline: number) => {
  const [remaining, setRemaining] = useState(Math.max(0, deadline - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return { label: `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`, expired: remaining <= 0 };
};

export const TournamentRegisterModal = ({ tournamentId, tournamentName, open, onClose, onCompleted }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<RegInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !user) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("tournament-register", {
        body: { tournament_id: tournamentId },
      });
      if (!mounted) return;
      setLoading(false);
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error ?? error?.message ?? "Lỗi đăng ký");
        onClose();
        return;
      }
      const r = data as RegInfo;
      setInfo(r);
      setProofUrl(r.transfer_proof_url ?? null);
      setProofSubmitted(!!r.transfer_proof_submitted);
    })();
    return () => { mounted = false; };
  }, [open, tournamentId, user?.id]);


  const transferContent = info ? `VINPoker ${info.reference_code}` : "";
  const copy = (txt: string, lbl: string) => {
    navigator.clipboard.writeText(txt);
    toast.success(`Đã copy ${lbl}`);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user || !info) return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) {
      toast.error("Chỉ chấp nhận JPG/PNG/WEBP"); return;
    }
    if (raw.size > 5 * 1024 * 1024) { toast.error("Ảnh tối đa 5MB"); return; }
    setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${user.id}/tournament-regs/${info.registration_id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("staking-proofs")
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from("staking-proofs")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? path;
      const { error: updErr } = await supabase
        .from("tournament_registrations")
        .update({ transfer_proof_image_url: url })
        .eq("id", info.registration_id);
      if (updErr) throw updErr;
      setProofUrl(url);
      toast.success("Đã tải ảnh chuyển khoản");
    } catch (e: any) {
      toast.error(e.message ?? "Không thể tải lên");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const markTransferred = async () => {
    if (!info) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({ transfer_proof_submitted: true })
      .eq("id", info.registration_id);
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    setProofSubmitted(true);
    toast.success("Đã ghi nhận! CLB sẽ xác nhận trong vòng 5–10 phút.");
    onCompleted?.();
  };

  const cancelReg = async () => {
    if (!info) return;
    if (!confirm("Bạn chắc chắn muốn huỷ đăng ký này?")) return;
    setCancelling(true);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({ status: "cancelled", cancellation_reason: "player_cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", info.registration_id)
      .eq("player_id", user?.id ?? "")
      .eq("status", "pending");
    setCancelling(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã huỷ đăng ký.");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Đăng ký giải tập huấn</DialogTitle>
          <DialogDescription className="text-xs">{tournamentName}</DialogDescription>
        </DialogHeader>

        {loading || !info ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">

            {/* Breakdown */}
            <div className="rounded-xl border border-border bg-card/40 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Lệ phí tập huấn</span><span className="font-mono">{formatVND(info.breakdown.buy_in)}</span></div>
              <div className="flex justify-between pt-2 border-t border-border/60">
                <span className="font-semibold">Tổng thanh toán</span>
                <span className="font-mono font-bold text-primary text-base">{formatVND(info.breakdown.buy_in)}</span>
              </div>
            </div>


            {/* Bank info */}
            <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-2">
              <div className="text-xs font-semibold text-primary">Thông tin chuyển khoản</div>
              <div className="text-sm">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs">Ngân hàng</span><span className="font-medium">{info.bank_name}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground text-xs">Chủ TK</span><span className="font-medium">{info.account_holder}</span></div>
                <div className="flex items-center justify-between gap-2 mt-1.5 p-2 rounded-lg border border-primary/40 bg-primary/5">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase text-muted-foreground">Số TK</div>
                    <div className="font-mono font-bold text-primary">{info.account_number}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => copy(info.account_number, "số TK")}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
              {info.qr_code_url && (
                <img src={info.qr_code_url} alt="QR" className="w-full max-w-[200px] mx-auto rounded border" />
              )}
            </div>

            {/* Reference code */}
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase text-muted-foreground">Nội dung CK (bắt buộc)</div>
                <div className="font-mono font-bold text-primary truncate">{transferContent}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => copy(transferContent, "nội dung")}><Copy className="w-4 h-4" /></Button>
            </div>

            {/* Proof upload */}
            <div className="rounded-xl border border-border bg-card/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <div className="font-semibold">Ảnh chụp giao dịch <span className="text-destructive">*</span></div>
                  <div className="text-[10px] text-muted-foreground">Bắt buộc — chụp màn hình biên lai CK</div>
                </div>
                {proofUrl ? (
                  <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Đã tải</span>
                ) : <span className="text-xs text-muted-foreground">Chưa tải</span>}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                hidden
                onChange={handleFile}
              />
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
                {proofUrl ? "Tải lại ảnh" : "Tải ảnh chuyển khoản"}
              </Button>
              {proofUrl && (
                <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
                  <img src={proofUrl} alt="Tx" className="w-full max-h-40 object-contain rounded-md border" />
                </a>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={cancelReg} disabled={cancelling || submitting || proofSubmitted}>
                Huỷ đăng ký
              </Button>
              <Button className="flex-1 gradient-neon text-primary-foreground font-bold"
                onClick={markTransferred} disabled={submitting || uploading || proofSubmitted || !proofUrl}>
                {proofSubmitted ? "Đã gửi — chờ CLB" : submitting ? "Đang gửi..." : !proofUrl ? "Cần tải ảnh CK" : "Đã chuyển khoản"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
