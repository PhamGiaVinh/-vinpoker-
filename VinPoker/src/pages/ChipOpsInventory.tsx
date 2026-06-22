import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";
import { ChipOpsManager } from "@/components/chip-ops/ChipOpsManager";

const ChipOpsInventory = () => {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 font-display text-xl text-foreground">Chip Ops</h1>
      <ChipOpsManager />
    </div>
  );
};

// Flag-gated default export (mirrors DealerInsuranceProfiles). While chipOps is OFF the route
// redirects, so the screen never mounts until the feature is enabled.
export default FEATURES.chipOps ? ChipOpsInventory : (() => <Navigate to="/club/admin" replace />);
