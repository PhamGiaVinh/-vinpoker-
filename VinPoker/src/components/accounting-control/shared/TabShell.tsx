import type { ReactNode } from "react";

/**
 * Khung chung cho mỗi tab: tiêu đề đầy đủ + "câu hỏi chính" (mỗi màn hình trả lời một
 * câu hỏi trước tiên — doctrine owner-UI một-nhiệm-vụ) + chỗ ghi chú doctrine ở cuối.
 */
export function TabShell({
  title,
  question,
  doctrine,
  children,
}: {
  title: string;
  question: string;
  doctrine?: readonly string[];
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-display text-lg text-foreground">{title}</h2>
        <p className="text-[12px] text-muted-foreground">{question}</p>
      </header>
      {children}
      {doctrine && doctrine.length > 0 && (
        <footer className="pt-1 space-y-1">
          {doctrine.map((d) => (
            <p key={d} className="text-[11px] leading-relaxed text-muted-foreground/80">
              — {d}
            </p>
          ))}
        </footer>
      )}
    </section>
  );
}
