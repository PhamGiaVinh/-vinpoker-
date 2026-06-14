import { useMemo, useState } from "react";
import { CalendarRange, Sparkles, Send, Info, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useShiftPlanner } from "@/hooks/useShiftPlanner";
import ShiftSummaryCards from "./shift-planner/ShiftSummaryCards";
import CoverageMiniStrip from "./shift-planner/CoverageMiniStrip";
import DailyShiftTable from "./shift-planner/DailyShiftTable";
import SuggestionPanel from "./shift-planner/SuggestionPanel";
import StaffRequestPanel from "./shift-planner/StaffRequestPanel";
import WeeklyShiftMatrix from "./shift-planner/WeeklyShiftMatrix";

type ClubRow = { id: string; name: string };

function todayInVN(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export default function ShiftPlannerTab({ clubIds }: { clubIds: string[]; clubs: ClubRow[] }) {
  const [workDate, setWorkDate] = useState<string>(todayInVN());
  // Phase 1 runs on the in-memory demo scenario (no DB). Switch to "live" only
  // after the additive migration is applied and the owner approves (Phase 2).
  const { data, loading, source, regenerate } = useShiftPlanner({ clubIds, workDate, mode: "mock" });

  const dateLabel = useMemo(
    () =>
      new Date(`${workDate}T00:00:00+07:00`).toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      }),
    [workDate]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-primary" /> Xếp lịch dealer
          </h2>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span>Lên lịch dealer theo ngày/tuần với giờ vào ca linh hoạt (08–16, 11–19, 16–00, 18–02…).</span>
            {source === "mock" && (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                Dữ liệu demo
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value || todayInVN())}
            className="h-9 w-[150px]"
          />
          <Button variant="outline" size="sm" className="h-9" onClick={() => { regenerate(); toast.success("Đã tạo lại bản nháp"); }}>
            <Sparkles className="w-4 h-4 mr-1.5" /> Tạo nháp AI
          </Button>
          <Button
            size="sm"
            className="h-9"
            disabled
            title="Publish + chấm công sẽ mở khi áp dụng DB (Phase 2, cần owner duyệt)"
          >
            <Send className="w-4 h-4 mr-1.5" /> Publish lịch
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <>
          <div className="text-xs text-muted-foreground -mt-1">{dateLabel}</div>

          <ShiftSummaryCards templates={data.templates} availability={data.availability} draft={data.draft} />

          <Tabs defaultValue="daily">
            <TabsList>
              <TabsTrigger value="daily">Theo ngày</TabsTrigger>
              <TabsTrigger value="weekly">Theo tuần</TabsTrigger>
              <TabsTrigger value="requests">Yêu cầu</TabsTrigger>
            </TabsList>

            {/* Daily */}
            <TabsContent value="daily" className="mt-3">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                <div className="space-y-4 min-w-0">
                  <Card className="p-4">
                    <div className="text-sm font-semibold mb-3">Coverage theo giờ</div>
                    <CoverageMiniStrip coverage={data.draft.coverage} />
                  </Card>
                  <Card className="p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <div className="text-sm font-semibold">Danh sách ca hôm nay</div>
                      <span className="text-[11px] text-muted-foreground">Nhóm theo giờ vào ca</span>
                    </div>
                    <div className="p-3">
                      <DailyShiftTable
                        templates={data.templates}
                        assignments={data.draft.assignments}
                        dealers={data.dealers}
                      />
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="p-4">
                    <div className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-amber-400" /> Gợi ý & cảnh báo
                    </div>
                    <SuggestionPanel draft={data.draft} />
                  </Card>
                  <Card className="p-4">
                    <div className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                      <ListChecks className="w-4 h-4 text-primary" /> Xin ca & nghỉ phép
                    </div>
                    <StaffRequestPanel
                      availability={data.availability}
                      templates={data.templates}
                      dealers={data.dealers}
                    />
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Weekly */}
            <TabsContent value="weekly" className="mt-3">
              <Card className="p-4">
                <WeeklyShiftMatrix
                  workDate={workDate}
                  dealers={data.dealers}
                  assignments={data.draft.assignments}
                  availability={data.availability}
                />
              </Card>
            </TabsContent>

            {/* Requests */}
            <TabsContent value="requests" className="mt-3">
              <Card className="p-4 max-w-2xl">
                <StaffRequestPanel
                  availability={data.availability}
                  templates={data.templates}
                  dealers={data.dealers}
                />
              </Card>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground">
            <strong>Quy tắc:</strong> mỗi dealer tối đa 1 ca/ngày, giờ vào/ra linh hoạt. Số liệu hiển thị là
            bản nháp đề xuất — chưa ghi vào hệ thống chấm công cho đến khi Publish (Phase 2).
          </p>
        </>
      )}
    </div>
  );
}
