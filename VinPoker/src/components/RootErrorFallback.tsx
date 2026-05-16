import type { FallbackProps } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { RefreshCw, Home } from "lucide-react";
import appLogo from "@/assets/app-logo.png";

export const RootErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const handleRetry = () => {
    try {
      resetErrorBoundary();
    } finally {
      // Hard reload as a safety net for non-recoverable state.
      window.location.reload();
    }
  };

  return (
    <div
      role="alert"
      className="min-h-screen flex items-center justify-center bg-background text-foreground px-6 py-10 pt-[calc(env(safe-area-inset-top)+2rem)]"
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-neon p-8 text-center space-y-6 animate-fade-in">
        <div className="flex justify-center">
          <img
            src={appLogo}
            alt="VinBacker"
            className="w-16 h-16 rounded-2xl object-cover drop-shadow-[0_0_18px_hsl(var(--primary)/0.55)]"
          />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl font-black tracking-wide text-primary">
            Đã có lỗi xảy ra
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Xin lỗi vì sự bất tiện này. Đã có lỗi không mong muốn xảy ra. Vui lòng thử lại — nếu lỗi vẫn tiếp diễn, hãy quay về trang chủ.
          </p>
        </div>

        {message && (
          <details className="text-left text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
            <summary className="cursor-pointer select-none font-medium">Chi tiết kỹ thuật</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{message}</pre>
          </details>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            onClick={handleRetry}
            className="flex-1 gradient-neon text-primary-foreground border-0 font-bold tracking-wider rounded-full shadow-neon hover:opacity-90"
          >
            <RefreshCw className="w-4 h-4" />
            Thử lại
          </Button>
          <Button
            variant="ghost"
            onClick={() => { window.location.href = "/"; }}
            className="flex-1 rounded-full"
          >
            <Home className="w-4 h-4" />
            Về trang chủ
          </Button>
        </div>
      </div>
    </div>
  );
};
