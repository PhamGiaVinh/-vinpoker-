import { Loader2 } from "lucide-react";

export function RouteLoader() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div className="text-2xl font-display font-black tracking-widest text-primary animate-pulse">
        VIN BACKER
      </div>
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
      <p className="text-xs text-muted-foreground">Đang tải...</p>
    </div>
  );
}

export function TabLoader({ label = "Đang tải..." }: { label?: string }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-5 h-5 text-primary animate-spin" />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default RouteLoader;
