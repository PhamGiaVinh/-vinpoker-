import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface YouTubeLiveChatProps {
  videoId: string;
  className?: string;
}

type State = "loading" | "ready" | "error";

export default function YouTubeLiveChat({ videoId, className }: YouTubeLiveChatProps) {
  const [state, setState] = useState<State>("loading");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setState("loading");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setState((s) => (s === "loading" ? "error" : s));
    }, 10000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [videoId]);

  const src = `https://www.youtube.com/live_chat?v=${videoId}&embed_domain=vinpoker.live&is_popout=1`;

  return (
    <div className={cn("relative w-full h-full bg-card overflow-hidden", className)}>
      <iframe
        key={videoId}
        src={src}
        title="YouTube Live Chat"
        width="100%"
        height="100%"
        frameBorder={0}
        allow="autoplay; encrypted-media"
        allowFullScreen
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
        className="w-full h-full border-0"
      />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-card text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Đang tải bình luận...
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center bg-card text-muted-foreground text-sm">
          Bình luận sẽ hiển thị khi bắt đầu livestream.
        </div>
      )}
    </div>
  );
}
