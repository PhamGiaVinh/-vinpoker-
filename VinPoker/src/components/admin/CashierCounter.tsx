import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { ScanLine, Search, CheckCircle2, Loader2, User, Phone, RefreshCw } from "lucide-react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PurchaseLite = {
  id: string;
  percent: number;
  amount_vnd: number;
  status: string;
  reference_code: string;
  backer_name: string;
};

type DealLite = {
  deal_id: string;
  title: string;
  buy_in_vnd: number;
  sold_percent: number;
  filled_percent: number;
  sum_funded_vnd: number;
  remaining_percent: number;
  remaining_vnd: number;
  status: string;
  player_checked_in: boolean;
  player_checkin_at: string | null;
  early_closed: boolean;
  platform_fixed_fee?: number;
  purchases: PurchaseLite[];
};

type LookupResult = {
  player: {
    id: string;
    display_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  deals: DealLite[];
  message?: string;
};

function maskPhone(p: string | null) {
  if (!p) return "—";
  const s = p.replace(/\D/g, "");
  if (s.length < 6) return p;
  return s.slice(0, 3) + "***" + s.slice(-3);
}

function parseScanned(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/vinpoker:\/\/user\/([0-9a-f-]+)/i);
  if (m && UUID_RE.test(m[1])) return m[1].toLowerCase();
  if (UUID_RE.test(s)) return s.toLowerCase();
  return null;
}

export default function CashierCounter() {
  const { t } = useTranslation();
  const [manualInput, setManualInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  // Scanner buffer
  const bufRef = useRef<{ chars: string; lastTs: number; timer: any }>({ chars: "", lastTs: 0, timer: null });

  const lookup = useCallback(async (rawIdOrText: string) => {
    const uuid = parseScanned(rawIdOrText) ?? (UUID_RE.test(rawIdOrText) ? rawIdOrText.toLowerCase() : null);
    if (!uuid) {
      const term = rawIdOrText.trim();
      if (term.length < 2) { toast.error(t("cashier.toastEnterTerm")); return; }
      setLoading(true);
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone")
        .or(`display_name.ilike.%${term}%,phone.ilike.%${term}%`)
        .limit(5);
      setLoading(false);
      if (!profs || profs.length === 0) { toast.error(t("cashier.toastNotFoundPlayer")); return; }
      if (profs.length > 1) { toast.message(t("cashier.toastMultiResult", { n: profs.length })); return; }
      return lookup(profs[0].user_id);
    }
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("cashier-lookup-player", {
      body: { user_id: uuid },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    setResult(data as LookupResult);
    if (!(data as LookupResult).player) toast.error(t("cashier.toastNotFoundPlayer"));
  }, [t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as any).isContentEditable)) {
        return;
      }
      const now = Date.now();
      const buf = bufRef.current;
      if (e.key === "Enter") {
        if (buf.chars.length >= 8) {
          const text = buf.chars;
          buf.chars = "";
          lookup(text);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (now - buf.lastTs > 80) buf.chars = "";
      buf.chars += e.key;
      buf.lastTs = now;
      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(() => { buf.chars = ""; }, 600);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lookup]);

  const onCheckIn = async (deal_id: string) => {
    setCheckingIn(deal_id);
    const { data, error } = await supabase.functions.invoke("player-check-in", { body: { deal_id } });
    setCheckingIn(null);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(t("cashier.toastCheckedIn"));
    if (result?.player) lookup(result.player.id);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border-primary/30 bg-gradient-to-br from-primary/5 to-card">
        <div className="flex items-center gap-2 mb-3">
          <ScanLine className="w-4 h-4 text-primary" />
          <div className="font-semibold">{t("cashier.title")}</div>
          <Badge variant="outline" className="ml-auto text-[10px]">{t("cashier.scanHint")}</Badge>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder={t("cashier.searchPh")}
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && manualInput.trim()) lookup(manualInput.trim()); }}
          />
          <Button onClick={() => manualInput.trim() && lookup(manualInput.trim())} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="ml-1.5">{t("cashier.search")}</span>
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">{t("cashier.usbHint")}</p>
      </Card>

      {loading && <Skeleton className="h-40 rounded-xl" />}

      {result && !loading && (
        <>
          {result.player ? (
            <>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {result.player.avatar_url ? (
                      <img src={result.player.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : <User className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">{result.player.display_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {maskPhone(result.player.phone)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => result.player && lookup(result.player.id)}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> {t("cashier.refresh")}
                  </Button>
                </div>
              </Card>

              {result.deals.length === 0 ? (
                <div className="text-center py-10 rounded-xl border border-dashed text-sm text-muted-foreground">
                  {t("cashier.noActiveDeals")}
                </div>
              ) : (
                result.deals.map((d) => {
                  const playerSelfPay = Math.max(0, d.buy_in_vnd - d.sum_funded_vnd);
                  const fixedFee = Number(d.platform_fixed_fee ?? 49000);
                  const totalCollect = playerSelfPay + fixedFee;
                  const canCheckin = d.status === "funded" && !d.player_checked_in;
                  return (
                    <Card key={d.deal_id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{d.title}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">#{d.deal_id.slice(0, 8)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                          {d.player_checked_in ? (
                            <Badge className="bg-success/15 text-success border border-success/40 text-[10px]">{t("cashier.checkedIn")}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">{t("cashier.notCheckedIn")}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <Stat label={t("cashier.buyInLabel")} value={formatVND(d.buy_in_vnd)} />
                        <Stat label={t("cashier.filledLabel")} value={`${d.filled_percent}/${d.sold_percent}%`} />
                        <Stat label={t("cashier.fundedLabel")} value={formatVND(d.sum_funded_vnd)} />
                      </div>

                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                          {t("cashier.payoutPanel")}
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("cashier.buyInRow")}</span>
                          <span className="font-mono">{formatVND(d.buy_in_vnd)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("cashier.backerFundedRow")}</span>
                          <span className="font-mono text-success">− {formatVND(d.sum_funded_vnd)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("cashier.playerOwes")}</span>
                          <span className="font-mono">{formatVND(playerSelfPay)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("cashier.platformFixedFee")}</span>
                          <span className="font-mono">+ {formatVND(fixedFee)}</span>
                        </div>
                        <div className="border-t border-primary/30 pt-2 flex items-center justify-between">
                          <span className="font-semibold">{t("cashier.totalCollect")}</span>
                          <span className="font-mono font-bold text-lg text-primary">{formatVND(totalCollect)}</span>
                        </div>
                        {canCheckin ? (
                          <Button
                            className="w-full bg-success hover:bg-success/90 text-success-foreground"
                            disabled={checkingIn === d.deal_id}
                            onClick={() => onCheckIn(d.deal_id)}
                          >
                            {checkingIn === d.deal_id ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 mr-1.5" />
                            )}
                            {t("cashier.confirmCheckIn")}
                          </Button>
                        ) : d.status !== "funded" ? (
                          <div className="text-[11px] text-muted-foreground italic text-center">
                            {t("cashier.needFunded")}
                          </div>
                        ) : d.player_checkin_at ? (
                          <div className="text-[11px] text-success text-center">
                            {t("cashier.checkedInAt", { t: formatDateTime(d.player_checkin_at) })}
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <div className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">
                          {t("cashier.backers")}
                        </div>
                        {d.purchases.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic">{t("cashier.noBackers")}</div>
                        ) : (
                          <div className="space-y-1">
                            {d.purchases.map((p) => (
                              <div key={p.id} className="flex items-center justify-between text-xs rounded bg-muted/40 px-2 py-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate font-medium">{p.backer_name}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span>{p.percent}%</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="font-mono">{formatVND(p.amount_vnd)}</span>
                                </div>
                                {p.status === "funded" ? (
                                  <Badge className="bg-success/15 text-success border-success/40 text-[10px]">{t("cashier.funded")}</Badge>
                                ) : (
                                  <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">{t("cashier.waitingTransfer")}</Badge>
                                )}
                              </div>
                            ))}
                            {d.remaining_percent > 0 && (
                              <div className="text-[11px] text-muted-foreground italic px-2">
                                {t("cashier.remainingSlot", { n: d.remaining_percent })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </>
          ) : (
            <div className="text-center py-10 rounded-xl border border-dashed text-sm text-muted-foreground">
              {result.message ?? t("cashier.notFoundShort")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold mt-0.5">{value}</div>
    </div>
  );
}
