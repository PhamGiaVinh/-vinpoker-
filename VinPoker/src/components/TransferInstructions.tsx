import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
    toast.success(t("transferInstructions.copied", { label: lbl }));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user) return;
    if (!["image/jpeg","image/png","image/webp"].includes(raw.type)) {
      toast.error(t("transferInstructions.onlyJpgPngWebp")); return;
    }
    if (raw.size > 5 * 1024 * 1024) { toast.error(t("transferInstructions.imageMax5mb")); return; }
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
      toast.success(t("transferInstructions.proofUploaded"));
    } catch (e: any) {
      toast.error(e.message ?? t("transferInstructions.uploadFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const markTransferred = async () => {
    if (!proofUrl) {
      toast.error(t("transferInstructions.uploadProofFirst"));
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
    toast.success(t("transferInstructions.recordedAdminConfirm"));
    onMarkedTransferred?.();
  };

  const cancelDeal = async () => {
    if (!confirm(t("transferInstructions.confirmCancel"))) return;
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
    toast.success(t("transferInstructions.cancelled"));
    onCancel?.();
  };

  return (
    <div className="space-y-4">
      {/* Countdown */}
      <div className={`rounded-xl border p-4 text-center ${expired ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10"}`}>
        <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          {expired ? t("transferInstructions.transferExpired") : t("transferInstructions.timeRemaining")}
        </div>
        <div className={`text-3xl font-bold font-mono mt-1 ${expired ? "text-destructive" : "text-warning"}`}>
          {expired ? "00:00" : label}
        </div>
        {expired && (
          <p className="text-[11px] text-destructive mt-1">
            {t("transferInstructions.maybeAutoCancelled")}
          </p>
        )}
      </div>

      {/* Bank account */}
      <BankInfoCard />

      {/* Amount + Reference */}
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("transferInstructions.amountToTransfer")}</div>
            <div className="text-2xl font-bold text-primary font-mono">{formatVND(amount)}</div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => copy(String(amount), t("transferInstructions.labelAmount"))}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary/20">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("transferInstructions.transferContent")}</div>
            <div className="font-mono font-bold text-primary truncate">{transferContent}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{t("transferInstructions.contentHint")}</div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => copy(transferContent, t("transferInstructions.labelContent"))}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Required screenshot */}
      <div className={`rounded-xl border p-3 space-y-2 ${proofUrl ? "border-border bg-card/40" : "border-destructive/50 bg-destructive/5"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs">
            <div className="font-semibold">
              {t("transferInstructions.transactionScreenshot")} <span className="text-destructive">{t("transferInstructions.requiredParen")}</span>
            </div>
            <div className="text-muted-foreground text-[11px]">
              {t("transferInstructions.cashierNeedsProof")}
            </div>
          </div>
          {proofUrl ? (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t("transferInstructions.uploaded")}
            </span>
          ) : (
            <span className="text-xs font-semibold text-destructive">{t("transferInstructions.requiredStar")}</span>
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
          {proofUrl ? t("transferInstructions.reuploadImage") : t("transferInstructions.uploadTransferImage")}
        </Button>
        {proofUrl && (
          <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
            <img src={proofUrl} alt={t("transferInstructions.proofImageAlt")} className="w-full max-h-40 object-contain rounded-md border border-border" />
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
            {t("transferInstructions.cancelTransaction")}
          </Button>
        )}
        <Button
          className="flex-1 gradient-neon text-primary-foreground font-bold"
          onClick={markTransferred}
          disabled={submitting || uploading || proofSubmitted || !proofUrl}
          title={!proofUrl ? t("transferInstructions.uploadProofFirstTitle") : undefined}
        >
          {proofSubmitted ? t("transferInstructions.sentWaitingAdmin") : submitting ? t("transferInstructions.sending") : !proofUrl ? t("transferInstructions.needProof") : t("transferInstructions.transferred")}
        </Button>
      </div>
    </div>
  );
};
