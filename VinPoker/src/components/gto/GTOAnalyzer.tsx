import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import GTOOpenRangeView from "./GTOOpenRangeView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function GTOAnalyzer() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [showBuilder, setShowBuilder] = useState(false);

  return (
    <Tabs defaultValue="gto" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="gto">{t("gto.open.mode.gto")}</TabsTrigger>
          {showBuilder && (
            <TabsTrigger value="builder">{t("gto.open.mode.builder")}</TabsTrigger>
          )}
        </TabsList>
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowBuilder((v) => !v)}
            title={showBuilder ? "Ẩn Build range" : "Hiện Build range"}
            className="h-8 px-2"
          >
            {showBuilder ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        )}
      </div>

      <TabsContent value="gto">
        <GTOOpenRangeView />
      </TabsContent>

      {showBuilder && (
        <TabsContent value="builder">
          {!user ? (
            <Card className="p-6 text-sm text-muted-foreground">{t("gto.loginRequired")}</Card>
          ) : (
            <GTOOpenRangeView personalMode />
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}
