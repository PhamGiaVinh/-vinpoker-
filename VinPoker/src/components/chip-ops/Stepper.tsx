import { Check } from "lucide-react";

/** Tiny numbered-pill stepper (no shadcn stepper exists). Token-driven, reusable. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className={i < steps.length - 1 ? "flex flex-1 items-center" : "flex items-center"}>
            <div className="flex items-center gap-2">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border font-display text-sm font-bold ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`hidden text-sm sm:inline ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <div className={`mx-3 h-px flex-1 ${done ? "bg-primary" : "bg-border"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default Stepper;
