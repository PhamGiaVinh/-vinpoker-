import { BellRing } from "lucide-react";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";

export default function OpsAlertsHub() {
  const capabilities = useOpsCapabilities();
  return (
    <section className="mx-auto max-w-3xl py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Control Deck</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">Cảnh báo</h1>
      <div className="mt-6 rounded-3xl border border-white/9 bg-[#07100c] p-6">
        <BellRing className="h-7 w-7 text-amber-300" />
        <h2 className="mt-4 font-semibold text-white">Chưa có nguồn cảnh báo Ops V3 được nối</h2>
        <p className="mt-2 text-sm leading-6 text-[#91a49b]">
          Màn này chỉ tổng hợp từ {capabilities.availableModules.length} module bạn có quyền. Không module data hook nào được mount tại đây.
        </p>
      </div>
    </section>
  );
}
