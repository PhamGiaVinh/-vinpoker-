import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TvChrome } from "@/components/tv/TvChrome";
import { useLiveClock } from "@/hooks/useLiveClock";
import { rpcGetTvDisplayState, rpcTvPairBegin } from "@/lib/tv/displayRpc";
import { parseDisplayStatePayload } from "@/lib/tv/mapDisplayState";
import { getStoredDisplayToken, storeDisplayToken } from "@/lib/tv/displayToken";
import { formatClock } from "@/lib/tv/format";

const CLAIM_POLL_MS = 3_000;
const BEGIN_RETRY_MS = 5_000;

interface PendingPair {
  pairCode: string;
  displayToken: string;
  expiresAtMs: number;
}

/**
 * /tv/pair — anonymous pairing screen (PR C2).
 * Shows a giant 6-digit code from tv_pair_begin and polls
 * get_tv_display_state every 3s until the dashboard claims it, then stores
 * the display token and switches to /display/:token.
 */
const TvPair = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingPair | null>(null);
  const [beginError, setBeginError] = useState(false);
  const beginningRef = useRef(false);
  const nowMs = useLiveClock();

  // Already-paired device → straight to its display.
  useEffect(() => {
    const stored = getStoredDisplayToken();
    if (stored) navigate(`/display/${stored}`, { replace: true });
  }, [navigate]);

  const begin = useCallback(async () => {
    if (beginningRef.current) return;
    beginningRef.current = true;
    try {
      const { data, error } = await rpcTvPairBegin();
      if (error || !data || data.error || !data.pair_code || !data.display_token) {
        setBeginError(true);
        setPending(null);
        return;
      }
      setBeginError(false);
      setPending({
        pairCode: data.pair_code,
        displayToken: data.display_token,
        expiresAtMs: data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 600_000,
      });
    } finally {
      beginningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (getStoredDisplayToken()) return; // redirecting
    void begin();
  }, [begin]);

  // Retry code generation while it fails (interval keeps retrying even when
  // beginError never transitions because every attempt fails).
  useEffect(() => {
    if (!beginError) return;
    const id = window.setInterval(() => void begin(), BEGIN_RETRY_MS);
    return () => window.clearInterval(id);
  }, [beginError, begin]);

  // Poll for the claim; regenerate on expiry/invalid.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      const { data, error } = await rpcGetTvDisplayState(pending.displayToken);
      if (cancelled || error) return; // transient errors: just wait for next tick
      const payload = parseDisplayStatePayload(data);
      if (payload.status === "paired") {
        storeDisplayToken(pending.displayToken);
        navigate(`/display/${pending.displayToken}`, { replace: true });
      } else if (payload.status !== "unpaired") {
        // expired | invalid | revoked → new code
        setPending(null);
        void begin();
      }
    }, CLAIM_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pending, navigate, begin]);

  // Proactive regenerate when the countdown runs out.
  const remainingMs = pending ? pending.expiresAtMs - nowMs : null;
  const codeExpired = pending != null && remainingMs != null && remainingMs <= 0;
  useEffect(() => {
    if (!codeExpired) return;
    setPending(null);
    void begin();
  }, [codeExpired, begin]);

  return (
    <TvChrome>
      <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-[4vmin] px-[6vmin] text-center">
        <div className="text-[2.2vmin] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          VinPoker TV
        </div>
        <h1 className="text-[4.5vmin] font-bold text-foreground">{t("tv.pairTitle")}</h1>

        {pending ? (
          <>
            <div className="flex gap-[1.6vmin]" data-testid="pair-code">
              {pending.pairCode.split("").map((digit, i) => (
                <span
                  key={i}
                  className="flex h-[16vmin] w-[11vmin] items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-[9vmin] font-bold tabular-nums text-primary [text-shadow:0_0_3vmin_hsl(var(--primary)/0.5)]"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="max-w-[80vmin] text-[2.4vmin] leading-relaxed text-muted-foreground">
              {t("tv.pairInstruction")}
            </p>
            <div className="flex items-center gap-[2vmin] text-[2vmin] text-muted-foreground">
              <span className="inline-block h-[1.2vmin] w-[1.2vmin] animate-pulse rounded-full bg-primary/80" />
              {t("tv.pairWaiting")}
              {remainingMs != null && remainingMs > 0 ? (
                <span className="tabular-nums">
                  · {t("tv.pairExpires")} {formatClock(Math.ceil(remainingMs / 1000))}
                </span>
              ) : null}
            </div>
          </>
        ) : beginError ? (
          <p className="text-[2.6vmin] text-amber-400">{t("tv.pairError")}</p>
        ) : (
          <p className="text-[2.6vmin] text-muted-foreground">{t("tv.loading")}</p>
        )}
      </div>
    </TvChrome>
  );
};

export default TvPair;
