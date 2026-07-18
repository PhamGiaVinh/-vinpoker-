import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { OpsBottomNav } from "./OpsBottomNav";
import "./ops-ios.css";

/**
 * OpsShell — native-iOS shell for mobileOpsV2 `/ops/*`. Slim frosted nav bar + large-title pages
 * (each page renders its own big title) + frosted tab bar. Chrome riêng, KHÔNG dùng Layout / /dealer/*.
 * Gate: flag `mobileOpsV2` + admin/owner preview → "chưa bật" notice. docs/design/ios-floor-ux-spec.md.
 */
export default function OpsShell() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { loading: scopeLoading, hasOpsAccess, hasOwnerAccess } = useOperatorClubs();
  const flagOn = FEATURES.mobileOpsV2;
  const allowPreview = hasOwnerAccess;

  if (authLoading || scopeLoading) return <RouteLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!hasOpsAccess) {
    return (
      <div className="ops-root grid min-h-screen place-items-center bg-[#030604] px-6 text-center">
        <div className="max-w-xs">
          <div className="text-[17px] font-semibold text-[#f2ece6]">Bạn chưa có quyền Vận hành</div>
          <p className="mt-1 text-[15px] text-[#9b8e97]">Nhờ chủ CLB phân quyền Floor, Thu ngân hoặc Tracker cho tài khoản này.</p>
        </div>
      </div>
    );
  }

  if (!flagOn && !allowPreview) {
    return (
      <div className="ops-root min-h-screen grid place-items-center bg-[#030604] px-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-[18px] ios-card text-[#00ff88] text-2xl">✦</div>
          <div className="text-[17px] font-semibold text-[#f2ece6]">Vận hành (bản mobile) chưa bật</div>
          <p className="mt-1 text-[15px] text-[#9b8e97]">
            Bản thử nghiệm iPhone đang chờ duyệt. Dùng bản máy tính ở mục VẬN HÀNH.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-root min-h-screen flex flex-col bg-[#030604] text-[#f2ece6]">
      {/* Slim frosted iOS nav bar */}
      <header className="sticky top-0 z-40 ios-blur bg-[#030604]/78 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto flex h-11 w-full max-w-md items-center justify-between px-2.5">
          <button
            onClick={() => navigate("/")}
            className="ios-press-sm -ml-1 flex items-center gap-0.5 rounded-full py-1 pl-1 pr-2 text-[15px] text-[#00ff88]"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
            App chính
          </button>
          {/* Chip "DỮ LIỆU MẪU" toàn cục đã GỠ: /ops nay có trang dữ liệu thật + GHI thật
              (cockpit bust/chip/move, Bàn). Chip chuyển về TỪNG trang còn mock (MockChip). */}
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-1">
        <Outlet />
      </main>

      <OpsBottomNav />
    </div>
  );
}
