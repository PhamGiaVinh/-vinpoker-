import { Table2, Rows3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DealerSwingTableViews({
  mapContent,
  allocationContent,
}: {
  mapContent: React.ReactNode;
  allocationContent: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="map" className="space-y-2">
      <div className="overflow-x-auto pb-px">
        <TabsList className="font-table-allocation h-auto min-h-11 w-max min-w-full justify-start bg-muted/60 p-1 sm:min-h-10 sm:min-w-0">
          <TabsTrigger value="map" className="min-h-11 gap-1.5 px-2.5 text-xs sm:min-h-10">
            <Table2 className="h-3.5 w-3.5" aria-hidden="true" />Bản đồ chiến trường
          </TabsTrigger>
          <TabsTrigger value="allocation" className="min-h-11 gap-1.5 px-2.5 text-xs sm:min-h-10">
            <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />Bảng theo bàn
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="map" className="m-0">{mapContent}</TabsContent>
      <TabsContent value="allocation" className="m-0">{allocationContent}</TabsContent>
    </Tabs>
  );
}
