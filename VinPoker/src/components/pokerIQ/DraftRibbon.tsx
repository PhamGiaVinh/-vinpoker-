import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Honest banner: drill content is curated draft, not coach/TD-approved yet. */
export function DraftRibbon() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 border-b border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.13)] px-3 py-1.5 text-[11px] font-medium text-[hsl(var(--warning))]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t("pokerDrill.result.draftRibbon")}
    </div>
  );
}
