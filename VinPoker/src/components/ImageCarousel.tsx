import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CarouselImage {
  image_url: string;
  caption?: string | null;
}

/**
 * Swipeable horizontal image carousel (embla). Touch-drag on mobile, prev/next
 * arrows + dot indicators on larger screens. Used for the club "Lịch series"
 * gallery, but generic. Renders nothing for an empty list.
 */
export function ImageCarousel({ images }: { images: CarouselImage[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "center" });
  const [selected, setSelected] = useState(0);
  const [count, setCount] = useState(0);

  const onSelect = useCallback(() => {
    if (emblaApi) setSelected(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const sync = () => { setCount(emblaApi.scrollSnapList().length); onSelect(); };
    sync();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", sync);
    return () => { emblaApi.off("select", onSelect); emblaApi.off("reInit", sync); };
  }, [emblaApi, onSelect]);

  if (!images.length) return null;
  const many = images.length > 1;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-lg border border-border bg-muted/20" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {images.map((img, i) => (
            <div key={i} className="relative min-w-0 flex-[0_0_100%]">
              <img
                src={img.image_url}
                alt={img.caption ?? `Ảnh ${i + 1}`}
                loading="lazy"
                className="mx-auto h-auto max-h-[72vh] w-full object-contain"
              />
              {img.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs font-medium text-white">
                  {img.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {many && (
        <>
          <button
            type="button"
            onClick={() => emblaApi?.scrollPrev()}
            disabled={selected === 0}
            aria-label="Ảnh trước"
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 p-1.5 text-foreground backdrop-blur transition disabled:opacity-30 sm:inline-flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => emblaApi?.scrollNext()}
            disabled={selected === count - 1}
            aria-label="Ảnh sau"
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 p-1.5 text-foreground backdrop-blur transition disabled:opacity-30 sm:inline-flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="mt-2 flex items-center justify-center gap-1.5">
            {Array.from({ length: count }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => emblaApi?.scrollTo(i)}
                aria-label={`Tới ảnh ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === selected ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
