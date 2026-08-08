import { ThinkingOrb } from "thinking-orbs";

export function VThinkingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="v-thinking-indicator"
      className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-4 py-5"
    >
      <div className="relative grid h-16 w-16 place-items-center" aria-hidden="true">
        <div className="absolute inset-1 rounded-full border border-primary/20" />
        <ThinkingOrb state="solving" size={64} speed={3} theme="dark" aria-label="V is thinking" />
      </div>
      <p className="text-sm font-medium text-foreground" aria-hidden="true">V is thinking…</p>
      <span className="sr-only">V đang tổng hợp bằng chứng…</span>
    </div>
  );
}
