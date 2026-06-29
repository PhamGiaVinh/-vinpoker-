import { FEATURES } from "@/lib/featureFlags";
import { PrizeStructurePanel } from "./PrizeStructurePanel";
import { PayoutEnginePanel } from "./PayoutEnginePanel";

// Flag gate for the Prizes tab. When `payoutEngine` is OFF (default) the existing manual
// PrizeStructurePanel renders UNCHANGED; when ON, the Engine 3-neo operator panel (preview /
// close-and-generate official / guarded manual edit) takes over. Backend (PR-2a) + Edge (PR-2b)
// are live; this only surfaces them in the UI once the flag is flipped after UAT.
export function PrizesTab({ tournamentId }: { tournamentId: string }) {
  return FEATURES.payoutEngine
    ? <PayoutEnginePanel tournamentId={tournamentId} />
    : <PrizeStructurePanel tournamentId={tournamentId} />;
}
