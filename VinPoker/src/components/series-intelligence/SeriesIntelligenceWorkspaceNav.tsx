import { BarChart3, MapPinned } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FEATURES } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

type SeriesIntelligenceWorkspace = "operations" | "market";

export function SeriesIntelligenceWorkspaceNav({
  active,
}: {
  active: SeriesIntelligenceWorkspace;
}) {
  const marketEnabled =
    FEATURES.seriesMarketVerifiedJeju || FEATURES.seriesMarketVietnamSupply;

  return (
    <nav
      aria-label="Khu vực Trí tuệ Series"
      className="min-w-0 overflow-x-auto border-b border-border/70 pb-3"
      data-testid="series-intelligence-workspace-nav"
    >
      <div className="inline-flex min-w-max items-center gap-1 rounded-md bg-muted/25 p-1">
        <Button
          asChild
          size="sm"
          variant={active === "operations" ? "secondary" : "ghost"}
          className={cn("min-h-10 gap-2", active === "operations" && "text-foreground")}
        >
          <Link
            to="/club/admin/series-intelligence"
            aria-current={active === "operations" ? "page" : undefined}
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Vận hành Series
          </Link>
        </Button>

        {marketEnabled && (
          <Button
            asChild
            size="sm"
            variant={active === "market" ? "secondary" : "ghost"}
            className={cn("min-h-10 gap-2", active === "market" && "text-foreground")}
          >
            <Link
              to="/club/admin/market-intelligence"
              aria-current={active === "market" ? "page" : undefined}
            >
              <MapPinned className="h-4 w-4" aria-hidden="true" />
              Dữ liệu thị trường
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
