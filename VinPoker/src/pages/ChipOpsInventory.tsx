import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";
import { IssuedChipInventoryPanel } from "@/components/chip-ops/IssuedChipInventoryPanel";

const ChipOpsInventory = () => {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 font-display text-xl text-foreground">Chip Ops — Tồn kho chip</h1>
      <IssuedChipInventoryPanel />
    </div>
  );
};

// Flag-gated default export (mirrors DealerInsuranceProfiles): while chipOps is OFF the route
// redirects, so the screen never mounts in production until the migrations are applied.
export default FEATURES.chipOps ? ChipOpsInventory : (() => <Navigate to="/club/admin" replace />);
