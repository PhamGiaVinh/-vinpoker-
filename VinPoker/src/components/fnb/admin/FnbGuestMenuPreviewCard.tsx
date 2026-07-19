import { Minus, Plus, UtensilsCrossed } from "lucide-react";
import type { FnbMenuItem } from "@/hooks/useFnbMenu";
import { formatVND } from "@/lib/format";
import { Button } from "@/components/ui/button";

type FnbGuestMenuPreviewCardProps = {
  item: FnbMenuItem;
  categoryName: string;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
};

export function FnbGuestMenuPreviewCard({
  item,
  categoryName,
  quantity,
  onAdd,
  onRemove,
}: FnbGuestMenuPreviewCardProps) {
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/30">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <UtensilsCrossed className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
        <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full border border-background/20 bg-background/85 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
          {categoryName}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <div>
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5">{item.name}</h3>
          <p className="mt-1 font-mono text-sm font-semibold text-primary">{formatVND(item.price_vnd)}</p>
        </div>
        <div className="flex min-h-9 items-center justify-end gap-1.5">
          {quantity > 0 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label={"Bớt một " + item.name}
                onClick={onRemove}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-6 text-center font-mono text-sm" aria-live="polite">{quantity}</span>
            </>
          )}
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label={"Thêm " + item.name}
            onClick={onAdd}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
