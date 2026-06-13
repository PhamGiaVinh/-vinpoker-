import type { TdCitation } from "@/lib/tdai/types";

/**
 * Non-authoritative citation badge. The label is a DEMO placeholder
 * (e.g. "TDA placeholder #44") until PR E supplies sourced citations.
 */
export function TdAiCitation({ citation }: { citation: TdCitation }) {
  const color =
    citation.kind === "house_demo"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${color}`}
      title="Nhãn demo, chưa phải trích dẫn TDA chính thức"
    >
      {citation.label}
    </span>
  );
}
