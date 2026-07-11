// Public "Hình ảnh" (photos) tab — a read-only gallery of the event photos uploaded
// by club media staff (tournament_photos, anon-readable). Grid + tap-to-enlarge
// lightbox. Empty state when no photos yet (degrades gracefully before the
// tournament_photos table is applied — the query just returns empty). Theme tokens.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface PhotoRow { id: string; photo_url: string }

export function PhotosPanel({ tournamentId, rpt = false }: { tournamentId: string; rpt?: boolean }) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("tournament_photos" as any)
        .select("id, photo_url")
        .eq("tournament_id", tournamentId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (alive) setPhotos((data ?? []) as unknown as PhotoRow[]);
    })();
    return () => { alive = false; };
  }, [tournamentId]);

  if (photos === null) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>;
  }

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/50 bg-card/40 py-12 text-center">
        <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
        <div className="text-sm font-semibold text-foreground">{t("liveHub.photos.empty", "Chưa có ảnh")}</div>
        <div className="text-xs text-muted-foreground">{t("liveHub.photos.soon", "Hình ảnh sự kiện sẽ sớm có ở đây")}</div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.photo_url)}
            className={rpt
              ? "group relative min-h-11 overflow-hidden rounded-xl border border-[hsl(var(--viewer-neon)_/_0.24)] bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "group relative overflow-hidden rounded-lg border border-border/50 bg-muted/30"}
          >
            <img src={p.photo_url} alt={rpt ? t("liveHub.photos.photoAlt", "Ảnh giải đấu") : ""} loading="lazy" className="h-28 w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none sm:h-32" />
          </button>
        ))}
      </div>
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-3xl border-border/60 bg-black/90 p-2">
          {active && <img src={active} alt={rpt ? t("liveHub.photos.photoAlt", "Ảnh giải đấu") : ""} className="max-h-[80vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
