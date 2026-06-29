import { isPayoutEngineEnabledForClub } from "@/lib/featureFlags";
import { PrizeStructurePanel } from "./PrizeStructurePanel";
import { PayoutEnginePanel } from "./PayoutEnginePanel";

// Per-club gate for the Prizes tab. `FEATURES.payoutEngine` is the GLOBAL master switch; the
// Engine 3-neo operator panel (preview / close-and-generate official / guarded manual edit) only
// renders for a club that is ALSO allow-listed (see isPayoutEngineEnabledForClub) — every other
// club keeps the existing manual PrizeStructurePanel UNCHANGED. This lets the engine go live for
// ONE club first. Backend (PR-2a) + Edge (PR-2b) are live; nothing here flips a flag.
export function PrizesTab({ tournamentId, clubId }: { tournamentId: string; clubId?: string | null }) {
  return isPayoutEngineEnabledForClub(clubId)
    ? <PayoutEnginePanel tournamentId={tournamentId} />
    : <PrizeStructurePanel tournamentId={tournamentId} />;
}
