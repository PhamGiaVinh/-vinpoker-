import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Coins, Layers, RefreshCw, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

function permute<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

function icmEquities(chips: number[], prizes: number[]): number[] {
  const n = chips.length;
  const eq = new Array(n).fill(0);
  const total = chips.reduce((a, b) => a + b, 0);
  if (total <= 0) return eq;
  const idx = chips.map((_, i) => i);
  for (const perm of permute(idx)) {
    let remaining = total;
    let prob = 1;
    for (let i = 0; i < n; i++) {
      const p = perm[i];
      prob *= chips[p] / remaining;
      remaining -= chips[p];
    }
    for (let pos = 0; pos < n; pos++) {
      eq[perm[pos]] += prob * (prizes[pos] || 0);
    }
  }
  return eq;
}

const PLAYER_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ORDINALS = [
  "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th",
  "10th", "11th", "12th", "13th", "14th", "15th",
];

export default function ICMCalculator() {
  const { t } = useTranslation();
  const [numPlayers, setNumPlayers] = useState(5);
  const [payouts, setPayouts] = useState<string[]>(["50", "30", "20", "", ""]);
  const [stacks, setStacks] = useState<string[]>(["10000", "9000", "8000", "7000", "6000"]);
  const [results, setResults] = useState<number[] | null>(null);

  // Resize arrays when player count changes
  useEffect(() => {
    setPayouts((p) => {
      const next = p.slice(0, numPlayers);
      while (next.length < numPlayers) next.push("");
      return next;
    });
    setStacks((s) => {
      const next = s.slice(0, numPlayers);
      while (next.length < numPlayers) next.push("");
      return next;
    });
    setResults(null);
  }, [numPlayers]);

  const calculate = () => {
    const chipsArr = stacks.map((s) => parseFloat(s) || 0);
    const prizeArr = payouts.map((p) => parseFloat(p) || 0);
    if (chipsArr.some((c) => c <= 0)) {
      toast.error(t("icmCalc.errChips"));
      return;
    }
    if (prizeArr.reduce((a, b) => a + b, 0) <= 0) {
      toast.error(t("icmCalc.errPrizes"));
      return;
    }
    const eq = icmEquities(chipsArr, prizeArr);
    setResults(eq);
  };

  const updateAt = (
    arr: string[],
    setArr: (v: string[]) => void,
    i: number,
    v: string,
  ) => {
    const next = arr.slice();
    next[i] = v;
    setArr(next);
  };

  // Auto-calc on first render with defaults
  useEffect(() => {
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center ring-1 ring-primary/30">
          <BarChart3 className="w-5 h-5" />
        </div>
        <h2 className="text-xl md:text-2xl font-display font-bold tracking-wide text-primary">
          {t("icmCalc.title")}
        </h2>
      </div>

      {/* Outer panel */}
      <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-3 sm:p-5 md:p-6 shadow-lg space-y-5">
        {/* Number of players */}
        <div>
          <h3 className="text-primary font-semibold mb-3 text-sm sm:text-base">{t("icmCalc.numPlayers")}</h3>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {PLAYER_OPTIONS.map((n) => {
              const active = n === numPlayers;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNumPlayers(n)}
                  className={cn(
                    "h-8 w-8 sm:h-10 sm:w-10 rounded-md border text-xs sm:text-sm font-semibold transition-all",
                    active
                      ? "border-primary text-primary bg-primary/10 ring-1 ring-primary shadow-[0_0_12px_-2px_hsl(var(--primary)/0.6)]"
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border bg-background/40",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 columns - always 3-up, even on mobile */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {/* Payouts */}
          <Column icon={<Coins className="w-4 h-4" />} title={t("icmCalc.payouts")}>
            {Array.from({ length: numPlayers }).map((_, i) => (
              <Row key={i} label={ORDINALS[i]}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={payouts[i] ?? ""}
                  onChange={(e) => updateAt(payouts, setPayouts, i, e.target.value)}
                  placeholder="—"
                  className="h-9 sm:h-10 px-2 sm:px-3 text-xs sm:text-sm bg-background/60 border-border/60 focus-visible:ring-primary/40"
                />
              </Row>
            ))}
          </Column>

          {/* Stacks */}
          <Column icon={<Layers className="w-4 h-4" />} title={t("icmCalc.stacks")}>
            {Array.from({ length: numPlayers }).map((_, i) => (
              <Row key={i}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={stacks[i] ?? ""}
                  onChange={(e) => updateAt(stacks, setStacks, i, e.target.value)}
                  placeholder="—"
                  className="h-9 sm:h-10 px-2 sm:px-3 text-xs sm:text-sm bg-background/60 border-border/60 focus-visible:ring-primary/40"
                />
              </Row>
            ))}
          </Column>

          {/* Results */}
          <Column icon={<BarChart3 className="w-4 h-4" />} title={t("icmCalc.results")}>
            {Array.from({ length: numPlayers }).map((_, i) => {
              const v = results?.[i];
              return (
                <div
                  key={i}
                  className="h-9 sm:h-10 rounded-md border border-border/60 bg-background/60 px-2 sm:px-3 flex items-center justify-between gap-1"
                >
                  <span className="font-semibold tabular-nums text-foreground text-xs sm:text-sm truncate">
                    {v != null ? fmtNum(v) : "—"}
                  </span>
                  <span className="hidden sm:inline text-[10px] tracking-[0.2em] text-muted-foreground/70">
                    {t("icmCalc.value")}
                  </span>
                </div>
              );
            })}
            <Button
              onClick={calculate}
              size="sm"
              className="w-full mt-1 h-9 sm:h-10 px-2 text-xs sm:text-sm bg-primary/90 hover:bg-primary text-primary-foreground font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t("icmCalc.recalc")}</span>
              <span className="sm:hidden">{t("icmCalc.recalcShort")}</span>
              <span className="sm:hidden">Recalc</span>
            </Button>
          </Column>
        </div>
      </div>
    </div>
  );
}

function Column({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-2 sm:p-4 space-y-2 sm:space-y-2.5 min-w-0">
      <h4 className="flex items-center gap-1.5 text-primary font-semibold mb-1 text-xs sm:text-sm">
        <span className="text-primary shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
      </h4>
      {children}
    </div>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 min-w-0">
      {label && (
        <span className="w-6 sm:w-8 text-[10px] sm:text-xs text-muted-foreground shrink-0">{label}</span>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
