import { useSearchParams } from "react-router-dom";
import { VerifiedMarketJejuContent } from "./VerifiedMarketJejuContent";

export default function VerifiedMarketDevPreview() {
  const [params] = useSearchParams();
  return (
    <div className="min-h-screen bg-background px-3 py-5 text-foreground sm:px-6 lg:px-8" data-dev-series-market>
      <div className="mx-auto max-w-[1500px]">
        <VerifiedMarketJejuContent forceIntegrityError={params.get("integrity") === "invalid"} />
      </div>
    </div>
  );
}
