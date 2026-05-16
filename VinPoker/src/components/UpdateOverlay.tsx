import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Branded full-screen overlay shown while a new version is being applied
 * (SW skipWaiting + cache clear + reload). Listens for the global custom
 * event "vinpoker:applying-update" so any code path that triggers an
 * update reload can surface the same UI.
 */
export const UpdateOverlay = () => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onApply = () => setShow(true);
    window.addEventListener("vinpoker:applying-update", onApply);
    return () => window.removeEventListener("vinpoker:applying-update", onApply);
  }, []);

  if (!show) return null;

  return (
    <div
      data-silent="true"
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[2147483647] flex items-center justify-center backdrop-blur-sm animate-fade-in"
      style={{ background: "#0a0a0a" }}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full blur-2xl animate-pulse"
            style={{ background: "rgba(59, 130, 246, 0.45)" }}
          />
          <svg
            viewBox="0 0 102 124"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="VinBacker"
            className="relative w-24 h-auto animate-pulse"
            style={{ filter: "drop-shadow(0 0 24px rgba(59, 130, 246, 0.6))" }}
          >
            <path fill="#4df18a" d="m 49.025948,2.4597982 c -4.45721,0.955249 -8.62858,2.4192381 -11.97963,3.3434651 H 19.656165 c -3.84884,0 -6.94738,3.8731711 -6.94738,8.6842247 v 2.326473 z m 21.018872,3.3434651 7.33547,18.3947427 12.096936,0.02325 v -9.733773 c 0,-4.8110536 -3.09854,-8.6842247 -6.94738,-8.6842247 z M 81.133032,27.414864 79.9915,30.744893 89.477226,54.531555 V 27.430884 Z M 12.708785,69.274841 v 40.044589 c 0,4.81105 3.09854,8.6837 6.94738,8.6837 h 12.485026 z m 76.768441,37.717599 -36.145598,14.66422 c 4.23379,-1.26418 7.690717,-2.425 11.729517,-3.40806 l 17.468701,-0.24547 c 3.84845,-0.0541 6.94738,-3.87265 6.94738,-8.6837 z" />
            <path fill="#4df18a" d="m 8.4447859,24.064211 40.3438321,0.07809 -0.0063,3.209886 -13.405979,-0.02594 21.787513,59.582596 0.251757,4.85e-4 20.381555,-59.500982 -13.657739,-0.02643 0.0063,-3.209884 25.330224,0.04903 4.565748,0.0088 -0.0063,3.209883 -4.559706,-0.0088 1.6e-5,-3.238799 -12.13717,-0.05898 2.646369,6.630477 -27.335383,79.738617 -1.69935,-0.003 -31.18267,-83.203072 -11.3290038,-0.02192 z" />
          </svg>
        </div>
        <div className="text-white font-semibold text-base">
          {t("update.applying", "Đang cập nhật phiên bản mới...")}
        </div>
        <div className="text-white/60 text-xs">
          {t("update.pleaseWait", "Vui lòng chờ trong giây lát")}
        </div>
      </div>
    </div>
  );
};
