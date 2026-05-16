import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compressImage";

interface Props {
  folder: string;
  value?: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  className?: string;
  required?: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;

export const ProofUploader = ({ folder, value, onChange, label, className, required }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const lbl = label ?? t("proofUpload.defaultLabel");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user) return;
    if (!raw.type.startsWith("image/")) {
      toast.error(t("proofUpload.onlyImg"));
      return;
    }
    if (raw.size > MAX_BYTES) {
      toast.error(t("proofUpload.max5"));
      return;
    }
    setUploading(true);
    const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `${user.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("backing-proofs").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    if (error) {
      setUploading(false);
      toast.error(error.message);
      return;
    }
    const { data } = supabase.storage.from("backing-proofs").getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
    toast.success(t("proofUpload.uploadedOk"));
  };

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="proof" className="h-24 w-24 object-cover rounded-md border border-border" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-invalid={required && !value ? true : undefined}
            className={required && !value ? "border-destructive text-destructive hover:bg-destructive/10" : undefined}
          >
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {lbl}
          </Button>
          {required && !value && (
            <span className="text-[10px] font-semibold text-destructive uppercase tracking-wider">* Bắt buộc</span>
          )}
        </div>
      )}
    </div>
  );
};
