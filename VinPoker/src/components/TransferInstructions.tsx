import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { compressImage } from "@/lib/compressImage";
import { CheckCircle2, Clock, Copy, Loader2, Upload } from "lucide-react";
import { BankInfoCard } from "@/components/BankInfoCard";

interface Props {
  purchaseId?: string;
  dealId: string;
  amount: number;
  reference: string;
  committedAt?: string | null;
  initialProofUrl?: string | null;
  initialProofSubmitted?: boolean;
  onMarkedTransferred?: () => void;
  onCancel?: () => void;
  hideCancel?: boolean;
}

const TIMEOUT_MS = 30 * 60 * 1000;

const useCountdown = (deadline: number) => {
  const [remaining, setRemaining] = useState(Math.max(0, deadline - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return { remaining, label: `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`, expired: remaining <= 0 };
};

export const TransferInstructions = ({
  purchaseId, dealId, amount, reference, committedAt, initialProofUrl, initialProofSubmitted,
  onMarkedTransferred, onCancel, hideCancel,
}: Props) => {
  const { user } = useAuth();
  const startedAt = committedAt ? new Date(committedAt).getTime() : Date.now();
  const deadline = startedAt + TIMEOUT_MS;
  const { label, expired } = useCountdown(deadline);

  const [proofUrl, setProofUrl] = useState<string | null>(initialProofUrl ?? null);
  const [proofSubmitted, setProofSubmitted] = useState<boolean>(!!initialProofSubmitted);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const transferContent = `VINPoker ${reference}`;

  const copy = (txt: string, lbl: string) => {
    navigator.clipboard.writeText(txt);
    toast.success(`Đã copy ${lbl}`);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user) return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) {
      toast.error("Chỉ chấp nhận JPG/PNG/WEBP"); return;
    }
    if (raw.size > 5 * 1024 * 1024) { toast.error("Ảnh tối đa 5MB"); return; }
    setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${user.id}/transfer-proofs/${dealId}-${purchaseId ?? "deal"}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("staking-proofs")
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from("staking-proofs")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? path;
      if (purchaseId) {
        const { error: updErr } = await supabase
          .from("staking_purchases")
          .update({ transfer_proof_url: url })
          .eq("id", purchaseId);
        if (updErr) throw updErr;
      }
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
    if (!proofUrl) {
      toast.error("Vui lòng tải ảnh biên lai chuyển khoản trước");
      return;
    }
    setSubmitting(true);
    if (purchaseId) {
      const { error } = await supabase
        .from("staking_purchases")
        .update({ transfer_proof_submitted: true })
        .eq("id", purchaseId);
      setSubmitting(false);
      if (error) { toast.error(error.message); return; }
    }
    setProofSubmitted(true);
    toast.success("Đã ghi nhận! Admin sẽ xác nhận trong vòng 5–10 phút.");
    onMarkedTransferred?.();
  };

  const cancelDeal = async () => {
    if (!confirm("Bạn chắc chắn muốn huỷ giữ chỗ này?")) return;
    setCancelling(true);
    if (purchaseId) {
      const { error } = await supabase
        .from("staking_purchases")
        .update({ status: "cancelled", cancellation_reason: "backer_cancelled" })
        .eq("id", purchaseId)
        .eq("backer_id", user?.id ?? "")
        .eq("status", "committed");
      setCancelling(false);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Đã huỷ giữ chỗ.");
    onCancel?.();
  };

  return (
    <div className="space-y-4">
      {/* Countdown */}
      <div className={`rounded-xl border p-4 text-center ${expired ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10"}`}>
        <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          {expired ? "Đã hết hạn chuyển khoản" : "Thời gian còn lại để chuyển khoản"}
        </div>
        <div className={`text-3xl font-bold font-mono mt-1 ${expired ? "text-destructive" : "text-warning"}`}>
          {expired ? "00:00" : label}
        </div>
        {expired && (
          <p className="text-[11px] text-destructive mt-1">
            Có thể bị tự động huỷ. Liên hệ Admin nếu bạn đã chuyển khoản.
          </p>
        )}
      </div>

      {/* Bank account */}
      <BankInfoCard />

      {/* Amount + Reference */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Số tiền cần chuyển</div>
            <div className="text-2xl font-bold text-primary font-mono">{formatVND(amount)}</div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => copy(String(amount), "số tiền")}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary/20">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Nội dung chuyển khoản</div>
            <div className="font-mono font-bold text-primary truncate">{transferContent}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Bắt buộc nhập đúng nội dung này để Admin đối chiếu.</div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => copy(transferContent, "nội dung")}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Required screenshot */}
      <div className={`rounded-xl border p-3 space-y-2 ${proofUrl ? "border-border bg-card/40" : "border-destructive/50 bg-destructive/5"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs">
            <div className="font-semibold">
              Ảnh chụp giao dịch <span className="text-destructive">(bắt buộc)</span>
            </div>
            <div className="text-muted-foreground text-[11px]">
              Cashier cần ảnh biên lai để xác nhận deal — không có ảnh sẽ bị từ chối.
            </div>
          </div>
          {proofUrl ? (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Đã tải
            </span>
          ) : (
            <span className="text-xs font-semibold text-destructive">* Bắt buộc</span>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handleFile} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`w-full ${!proofUrl ? "border-destructive text-destructive hover:bg-destructive/10" : ""}`}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
          {proofUrl ? "Tải lại ảnh" : "Tải ảnh chuyển khoản"}
        </Button>
        {proofUrl && (
          <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
            <img src={proofUrl} alt="Tx" className="w-full max-h-40 object-contain rounded-md border border-border" />
          </a>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {!hideCancel && (
          <Button
            variant="outline"
            className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={cancelDeal}
            disabled={cancelling || submitting || proofSubmitted}
          >
            Huỷ giao dịch
          </Button>
        )}
        <Button
          className="flex-1 gradient-neon text-primary-foreground font-bold"
          onClick={markTransferred}
          disabled={submitting || uploading || proofSubmitted || !proofUrl}
          title={!proofUrl ? "Tải ảnh biên lai trước" : undefined}
        >
          {proofSubmitted ? "Đã gửi — chờ Admin" : submitting ? "Đang gửi..." : !proofUrl ? "Cần tải biên lai" : "Đã chuyển khoản"}
        </Button>
      </div>
    </div>
  );
};
