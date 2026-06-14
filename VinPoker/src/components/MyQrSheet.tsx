import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Copy, Check, ChevronDown, ChevronUp, TrendingUp, TrendingDown, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import appLogo from "@/assets/app-logo.png";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName?: string | null;
}

const BUYIN_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "<1M", min: 0, max: 1_000_000 },
  { label: "1–3M", min: 1_000_000, max: 3_000_000 },
  { label: "3–5M", min: 3_000_000, max: 5_000_000 },
  { label: "5–10M", min: 5_000_000, max: 10_000_000 },
  { label: "10M+", min: 10_000_000, max: Number.MAX_SAFE_INTEGER },
];

function formatVnd(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function MyQrSheet({ open, onOpenChange, userId, displayName }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [openPortfolio, setOpenPortfolio] = useState(false);
  const payload = `vinpoker://user/${userId}`;

  const { data: portfolio, isLoading } = useQuery({
    enabled: open && openPortfolio,
    queryKey: ["my-portfolio", userId],
    queryFn: async () => {
      const [statsRes, resultsRes] = await Promise.all([
        supabase
          .from("player_stats")
          .select("itm_rate, roi_percentage, tournaments_played, verified, total_profit_loss, biggest_cash_amount")
          .eq("player_id", userId)
          .maybeSingle(),
        supabase
          .from("player_results")
          .select("buy_in")
          .eq("player_id", userId),
      ]);
      const buckets = BUYIN_BUCKETS.map((b) => ({ ...b, count: 0 }));
      (resultsRes.data ?? []).forEach((r: any) => {
        const v = Number(r.buy_in) || 0;
        const idx = buckets.findIndex((b) => v >= b.min && v < b.max);
        if (idx >= 0) buckets[idx].count += 1;
      });
      return { stats: statsRes.data, buckets, totalResults: resultsRes.data?.length ?? 0 };
    },
  });

  const copy = async () => {
    await navigator.clipboard.writeText(userId);
    setCopied(true);
    toast.success(t("myQr.copiedId"));
    setTimeout(() => setCopied(false), 1500);
  };

  const stats = portfolio?.stats;
  const roiPositive = (stats?.roi_percentage ?? 0) >= 0;
  const maxBucket = Math.max(1, ...(portfolio?.buckets ?? []).map((b) => b.count));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-gold/40 bg-gradient-to-b from-background via-background to-primary/5 pb-[calc(2rem+env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto"
      >
        <SheetHeader className="items-center text-center">
          <div className="flex items-center gap-2 mb-1">
            <img src={appLogo} alt={t("myQr.logoAlt")} className="w-8 h-8 rounded-md" />
            <span className="font-display font-black tracking-[0.18em] text-primary text-lg">VBACKER</span>
          </div>
          <SheetTitle className="text-center">{t("myQr.memberQrTitle")}</SheetTitle>
          <SheetDescription className="text-center text-xs">
            {displayName ? <><span>{t("myQr.greetingPrefix")} </span><span className="text-foreground font-semibold">{displayName}</span><br /></> : null}
            {t("myQr.shareHint")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col items-center gap-4 py-6">
          <div className="bg-white p-4 rounded-xl shadow-lg ring-2 ring-gold/40">
            <QRCodeSVG value={payload} size={220} level="M" />
          </div>
          <button
            onClick={copy}
            className="text-[11px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {t("myQr.playerIdLabel")}: {userId.slice(0, 8)}…{userId.slice(-4)}
          </button>
        </div>

        {/* Portfolio */}
        <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenPortfolio((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition"
          >
            <div className="text-left">
              <div className="text-sm font-semibold">{t("myQr.myPortfolio")}</div>
              <div className="text-[11px] text-muted-foreground">{t("myQr.portfolioSubtitle")}</div>
            </div>
            {openPortfolio ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {openPortfolio && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/60">
              {isLoading ? (
                <div className="py-6 text-center text-xs text-muted-foreground">{t("myQr.loading")}</div>
              ) : !stats || (portfolio?.totalResults ?? 0) === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground italic">
                  {t("myQr.noHistory")}
                </div>
              ) : (
                <>
                  <div className="pt-3 flex items-center justify-center">
                    {stats.verified ? (
                      <Badge className="bg-green-500/20 text-green-500 border-green-500/40">
                        <ShieldCheck className="w-3 h-3 mr-1" /> {t("myQr.verified")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-yellow-500/40 text-yellow-500">
                        <ShieldAlert className="w-3 h-3 mr-1" /> {t("myQr.notVerified")}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-background/50 py-2">
                      <div className="text-[10px] text-muted-foreground tracking-wider">ITM</div>
                      <div className="font-bold text-cyan-400">{stats.itm_rate}%</div>
                    </div>
                    <div className="rounded-md bg-background/50 py-2">
                      <div className="text-[10px] text-muted-foreground tracking-wider">ROI</div>
                      <div className={`font-bold flex items-center justify-center gap-0.5 ${roiPositive ? "text-green-500" : "text-red-500"}`}>
                        {roiPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {roiPositive ? "+" : ""}{stats.roi_percentage}%
                      </div>
                    </div>
                    <div className="rounded-md bg-background/50 py-2">
                      <div className="text-[10px] text-muted-foreground tracking-wider">TOURS</div>
                      <div className="font-bold">{stats.tournaments_played}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground tracking-wider mb-2 px-0.5">
                      {t("myQr.buyinDistribution")}
                    </div>
                    <div className="space-y-1.5">
                      {portfolio!.buckets.map((b) => (
                        <div key={b.label} className="flex items-center gap-2 text-[11px]">
                          <div className="w-12 text-muted-foreground">{b.label}</div>
                          <div className="flex-1 h-2 rounded-full bg-background/60 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary/70 to-primary"
                              style={{ width: `${(b.count / maxBucket) * 100}%` }}
                            />
                          </div>
                          <div className="w-6 text-right font-mono">{b.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-md bg-background/40 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground">{t("myQr.profitLoss")}</div>
                      <div className={`text-sm font-bold ${(stats.total_profit_loss ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {(stats.total_profit_loss ?? 0) >= 0 ? "+" : "-"}
                        {formatVnd(Math.abs(Number(stats.total_profit_loss ?? 0)))}đ
                      </div>
                    </div>
                    <div className="rounded-md bg-background/40 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground">{t("myQr.biggestCash")}</div>
                      <div className="text-sm font-bold text-gold">
                        {formatVnd(Number(stats.biggest_cash_amount ?? 0))}đ
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
