import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import {
  POSITIONS, Position, ActionStep,
  getAvailableActions, getFoldedPositions, getLastRaiser, getNextToAct,
} from "@/lib/gto/rangeTree";
import { useRangeTree } from "@/hooks/useRangeTree";

const ACTION_BG: Record<ActionStep["action"], string> = {
  fold: "bg-gto-fold text-white",
  call: "bg-gto-call text-white",
  raise: "bg-gto-raise text-white",
  allin: "bg-gto-allin text-white",
};
const ACTION_TEXT: Record<ActionStep["action"], string> = {
  fold: "text-gto-fold",
  call: "text-gto-call",
  raise: "text-gto-raise",
  allin: "text-gto-allin",
};

export default function ActionBar() {
  const { state, pushStep, popTo, setViewing } = useRangeTree();
  const { actionPath, stackDepth, viewingPosition } = state;

  const folded = getFoldedPositions(actionPath);
  const lastRaiser = getLastRaiser(actionPath);

  function handleAction(position: Position, opt: { action: ActionStep["action"]; size?: number }) {
    setViewing(position);
    // Khi user bấm OPEN raise (chưa có raiser trước đó) → chỉ "lock" vào range OPEN của vị trí đó,
    // không push step để tránh nhảy sang spot post-raise (chưa có dữ liệu).
    const isOpenRaise =
      (opt.action === "raise" || opt.action === "allin") && !lastRaiser;
    if (isOpenRaise) return;
    const newPath = [...actionPath, { position, action: opt.action, raiseSize: opt.size }];
    pushStep({ position, action: opt.action, raiseSize: opt.size });
    // Nếu là FOLD và pot vẫn chưa có raiser → tự nhảy view sang vị trí kế tiếp
    // (vd: fold quanh tới SB thì hiện range OPEN của SB).
    if (opt.action === "fold" && !lastRaiser) {
      const next = getNextToAct(newPath);
      if (next) setViewing(next);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {POSITIONS.map((pos) => {
          const isFolded = folded.has(pos);
          const isViewing = viewingPosition === pos;
          const isLastRaiser = lastRaiser?.position === pos;
          const actions = getAvailableActions(pos, actionPath, stackDepth);
          const posStep = actionPath.find((s) => s.position === pos);

          return (
            <Card
              key={pos}
              onClick={() => setViewing(pos)}
              className={cn(
                "p-2 space-y-1 cursor-pointer transition-all bg-card/60 border-border/60",
                isViewing && "ring-2 ring-primary border-primary/40",
                isLastRaiser && !isViewing && "border-gto-raise/60",
                isFolded && "opacity-50",
              )}
            >
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-bold">{pos}</span>
                <span className="text-muted-foreground">{stackDepth}</span>
              </div>

              {posStep ? (
                <div
                  className={cn(
                    "text-[11px] font-bold px-1.5 py-0.5 rounded text-center",
                    ACTION_BG[posStep.action],
                  )}
                >
                  {posStep.action === "raise"
                    ? `Raise ${posStep.raiseSize}`
                    : posStep.action === "allin"
                    ? `Allin ${posStep.raiseSize}`
                    : posStep.action === "call"
                    ? `Call ${posStep.raiseSize ?? ""}`
                    : "Fold"}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {actions.map((a) => (
                    <button
                      key={a.action + (a.size ?? "")}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction(pos, a);
                      }}
                      className={cn(
                        "text-left text-[11px] leading-tight px-1.5 py-0.5 rounded transition-colors hover:bg-muted/60",
                        ACTION_TEXT[a.action],
                        isFolded && "text-muted-foreground/60",
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {actionPath.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            onClick={() => popTo(actionPath.length - 1)}
            title="Back"
          >
            <ChevronLeft className="w-3 h-3" />
          </Button>
          {actionPath.map((step, i) => (
            <button
              key={i}
              onClick={() => popTo(i)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <span className="font-semibold">{step.position}</span>
              <span className={ACTION_TEXT[step.action]}>
                {step.action === "raise"
                  ? `raise ${step.raiseSize}`
                  : step.action === "allin"
                  ? `allin`
                  : step.action === "call"
                  ? `call ${step.raiseSize ?? ""}`
                  : "fold"}
              </span>
              {i < actionPath.length - 1 && <span>›</span>}
            </button>
          ))}
          <button
            onClick={() => popTo(0)}
            className="ml-auto underline hover:text-foreground"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
