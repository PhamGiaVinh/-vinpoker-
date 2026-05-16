import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Doc = {
  title: string;
  file_url: string;
  mime_type: string | null;
};

type Kind = "pdf" | "office" | "image" | "video" | "audio" | "text" | "other";

const detect = (d: Doc): Kind => {
  const url = d.file_url.toLowerCase();
  const mime = (d.mime_type ?? "").toLowerCase();
  if (mime === "application/pdf" || url.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(url)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/.test(url)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/.test(url)) return "audio";
  if (mime === "text/plain" || mime === "text/markdown" || /\.(txt|md|csv|log|json)$/.test(url))
    return "text";
  if (
    /(officedocument|msword|ms-excel|ms-powerpoint)/.test(mime) ||
    /\.(docx?|xlsx?|pptx?)$/.test(url)
  )
    return "office";
  return "other";
};

export function DocumentViewerDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: Doc | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textErr, setTextErr] = useState(false);

  const kind = doc ? detect(doc) : "other";

  useEffect(() => {
    if (!open || !doc || kind !== "text") {
      setTextContent(null);
      setTextErr(false);
      return;
    }
    let cancelled = false;
    fetch(doc.file_url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("fetch failed"))))
      .then((txt) => !cancelled && setTextContent(txt))
      .catch(() => !cancelled && setTextErr(true));
    return () => {
      cancelled = true;
    };
  }, [open, doc, kind]);

  if (!doc) return null;

  const safeUrl = (() => {
    try {
      const u = new URL(doc.file_url, window.location.href);
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
    } catch {
      return null;
    }
  })();

  const renderBody = () => {
    if (!safeUrl) {
      return (
        <p className="text-muted-foreground text-center py-12">
          {t("documentsPage.viewerUnsupported")}
        </p>
      );
    }
    switch (kind) {
      case "pdf": {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isAndroid = /Android/.test(ua);
        const isInApp = /(FBAN|FBAV|Messenger|Instagram|Zalo|Line|MicroMessenger|MiuiBrowser)/i.test(ua);
        const isMobile = isIOS || isAndroid || window.matchMedia("(max-width: 768px)").matches;

        // iOS in-app browsers (Messenger/FB/Zalo) thường fail PDF.js → dùng Google Docs Viewer
        // iOS Safari thường render PDF native tốt qua iframe trực tiếp
        // Android: dùng Google Docs Viewer vì Chrome mobile không tự render PDF inline
        const mobileSrc =
          isIOS && !isInApp
            ? safeUrl
            : isMobile
              ? `https://docs.google.com/gview?url=${encodeURIComponent(safeUrl)}&embedded=true`
              : null;

        if (mobileSrc) {
          return (
            <div className="w-full h-full flex flex-col gap-2">
              <iframe
                src={mobileSrc}
                className="flex-1 w-full border-0 rounded-md bg-background"
                title={doc.title}
              />
              <a
                href={safeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-center text-muted-foreground underline py-1"
              >
                {t("documentsPage.viewerOpenExternal", "Mở trong trình duyệt")}
              </a>
            </div>
          );
        }

        return (
          <iframe
            src={`/pdf-viewer/web/viewer.html?file=${encodeURIComponent(safeUrl)}`}
            className="w-full h-full border-0 rounded-md bg-background"
            title={doc.title}
          />
        );
      }
      case "office":
        return (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(safeUrl)}`}
            className="w-full h-full border-0 rounded-md bg-background"
            title={doc.title}
          />
        );
      case "image":
        return (
          <div className="w-full h-full overflow-auto flex items-center justify-center bg-muted/30 rounded-md">
            <img src={safeUrl} alt={doc.title} className="max-w-full max-h-full object-contain" />
          </div>
        );
      case "video":
        return (
          <video
            src={safeUrl}
            controls
            playsInline
            className="w-full h-full bg-black rounded-md"
          />
        );
      case "audio":
        return (
          <div className="w-full h-full flex items-center justify-center">
            <audio src={safeUrl} controls className="w-full max-w-md" />
          </div>
        );
      case "text":
        if (textErr) {
          return (
            <p className="text-destructive text-center py-12">
              {t("documentsPage.viewerOfficeFallback")}
            </p>
          );
        }
        if (textContent === null) {
          return (
            <p className="text-muted-foreground text-center py-12">
              {t("documentsPage.viewerLoading")}
            </p>
          );
        }
        return (
          <pre className="w-full h-full overflow-auto text-sm bg-muted/30 rounded-md p-4 whitespace-pre-wrap break-words">
            {textContent}
          </pre>
        );
      default:
        return (
          <div className="text-center py-12 space-y-3">
            <p className="text-muted-foreground">{t("documentsPage.viewerUnsupported")}</p>
            <Button asChild>
              <a href={safeUrl} target="_blank" rel="noreferrer" download>
                <Download className="w-4 h-4" /> {t("documentsPage.download")}
              </a>
            </Button>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <h2 className="font-semibold truncate">{doc.title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {safeUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={safeUrl} target="_blank" rel="noreferrer" download>
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("documentsPage.download")}</span>
                </a>
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-2">{renderBody()}</div>
      </DialogContent>
    </Dialog>
  );
}
