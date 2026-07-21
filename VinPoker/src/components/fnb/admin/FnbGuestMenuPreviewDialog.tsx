import { useMemo, useState } from "react";
import { Coffee, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import type { FnbCategory, FnbMenuItem } from "@/hooks/useFnbMenu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FnbGuestMenuPreviewCard } from "@/components/fnb/admin/FnbGuestMenuPreviewCard";

const ALL_CATEGORIES = "all";

type FnbGuestMenuPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubName: string;
  categories: FnbCategory[];
  items: FnbMenuItem[];
};

export function FnbGuestMenuPreviewDialog({
  open,
  onOpenChange,
  clubName,
  categories,
  items,
}: FnbGuestMenuPreviewDialogProps) {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [cart, setCart] = useState<Record<string, number>>({});

  const activeCategories = useMemo(
    () => categories.filter((category) => category.is_active),
    [categories],
  );
  const activeItems = useMemo(
    () => items.filter((item) => item.is_active),
    [items],
  );
  const shownItems = activeCategory === ALL_CATEGORIES
    ? activeItems
    : activeItems.filter((item) => item.category_id === activeCategory);
  const itemCount = activeItems.reduce((total, item) => total + (cart[item.id] ?? 0), 0);
  const subtotal = activeItems.reduce(
    (total, item) => total + item.price_vnd * (cart[item.id] ?? 0),
    0,
  );

  const categoryName = (categoryId: string | null) => (
    activeCategories.find((category) => category.id === categoryId)?.name ?? "Món khác"
  );
  const addItem = (itemId: string) => {
    setCart((current) => ({ ...current, [itemId]: (current[itemId] ?? 0) + 1 }));
  };
  const removeItem = (itemId: string) => {
    setCart((current) => {
      const nextQuantity = (current[itemId] ?? 0) - 1;
      const next = { ...current };
      if (nextQuantity <= 0) delete next[itemId];
      else next[itemId] = nextQuantity;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fnb-guest-menu-typography h-[min(92vh,820px)] w-[calc(100vw-1rem)] max-w-md overflow-hidden border-primary/25 bg-background p-0 font-medium text-foreground shadow-2xl sm:rounded-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Xem trước menu khách</DialogTitle>
          <DialogDescription>
            Bản xem trước chỉ mô phỏng thao tác chọn món, không gửi đơn hàng thật.
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-full min-h-0 flex-col">
          <header className="relative overflow-hidden border-b border-primary/20 bg-card px-5 pb-5 pt-7">
            <div aria-hidden="true" className="absolute -right-12 -top-16 h-40 w-40 rounded-full border border-primary/15 bg-primary/5" />
            <div aria-hidden="true" className="absolute -right-2 top-4 h-16 w-16 rounded-full border border-primary/20" />
            <div className="relative">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                <UtensilsCrossed className="h-3 w-3" /> Menu tại bàn
              </div>
              <p className="truncate text-xs font-medium text-muted-foreground">{clubName}</p>
              <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight">Đồ ăn &amp; thức uống</h2>
              <p className="mt-2 text-base leading-6 text-muted-foreground">Chọn món, chúng tôi sẽ mang đến tận bàn.</p>
            </div>
          </header>

          <div className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <CategoryButton
                active={activeCategory === ALL_CATEGORIES}
                onClick={() => setActiveCategory(ALL_CATEGORIES)}
              >
                Tất cả
              </CategoryButton>
              {activeCategories.map((category) => (
                <CategoryButton
                  key={category.id}
                  active={activeCategory === category.id}
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.name}
                </CategoryButton>
              ))}
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {shownItems.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 text-center">
                <Coffee className="mb-3 h-8 w-8 text-primary/70" />
                <p className="text-base font-bold">Chưa có món trong mục này</p>
                <p className="mt-1 text-base leading-6 text-muted-foreground">Bật món trong phần Thực đơn để khách nhìn thấy.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {shownItems.map((item) => (
                  <FnbGuestMenuPreviewCard
                    key={item.id}
                    item={item}
                    categoryName={categoryName(item.category_id)}
                    quantity={cart[item.id] ?? 0}
                    onAdd={() => addItem(item.id)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </div>
            )}
          </main>

          <footer className="border-t border-primary/20 bg-card px-4 py-3">
            <Button
              type="button"
              className="h-12 w-full justify-between rounded-xl px-4 text-base font-bold"
              disabled={itemCount === 0}
              onClick={() => toast.info("Đây là bản xem trước — không có đơn thật nào được gửi.")}
            >
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                {itemCount > 0 ? "Xem đơn · " + itemCount + " món" : "Chọn món để bắt đầu"}
              </span>
              <span className="fnb-number">{formatVND(subtotal)}</span>
            </Button>
            <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">Bản xem trước · không gửi đơn và không thu tiền</p>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
