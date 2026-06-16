import { useMemo, useState } from "react";
import { CalendarRange, Sparkles, Send, Info, ListChecks, SlidersHorizontal, Save, Loader2, MessageCircle, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildSaveRunPayload, buildSchedulePng } from "@/lib/shiftPlanner";
import { buildShiftGroups } from "./shift-planner/ShiftPlanner.utils";
import { AddShiftDialog } from "./shift-planner/AddShiftDialog";
import type { DraftAssignment } from "@/types/shiftPlanner";
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
import ShiftTemplateEditor from "./shift-planner/ShiftTemplateEditor";

type ClubRow = { id: string; name: string };

function todayInVN(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export default function ShiftPlannerTab({
  clubIds,
  mode = "mock",
}: {
  clubIds: string[];
  clubs: ClubRow[];
  mode?: "mock" | "live";
}) {
  const [workDate, setWorkDate] = useState<string>(todayInVN());
  const [editorOpen, setEditorOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Manual edits layered over the auto-draft (null = use the auto-draft as-is).
  // Cleared on date change / regenerate so the AI draft is the fresh baseline.
  const [overrides, setOverrides] = useState<DraftAssignment[] | null>(null);
  // mode="mock" runs the in-memory demo; mode="live" reads the dealer_shift_* tables
  // (Phase 2, after the migration is applied live).
  const { data, loading, source, regenerate, refetch } = useShiftPlanner({ clubIds, workDate, mode });

  // dealer_shift_* RPCs aren't in the generated types yet → untyped client.
  const rpc = supabase as unknown as {
    rpc: (fn: string, args: object) => Promise<{ data: any; error: { message?: string } | null }>;
  };

  // The draft actually shown / saved = auto-draft + manual edits (add/remove).
  const effectiveDraft = useMemo(
    () => (data ? (overrides ? { ...data.draft, assignments: overrides } : data.draft) : null),
    [data, overrides]
  );
  const effAssignments = effectiveDraft?.assignments ?? [];
  const assignedDealerIds = useMemo(() => new Set(effAssignments.map((a) => a.dealerId)), [effAssignments]);

  const changeDate = (d: string) => { setWorkDate(d || todayInVN()); setSavedRunId(null); setOverrides(null); };
  const handleRegenerate = () => { setOverrides(null); regenerate(); toast.success("Đã tạo lại bản nháp"); };

  const handleAddAssignment = (a: DraftAssignment) =>
    setOverrides((prev) => [...(prev ?? data?.draft.assignments ?? []), a]);
  const handleRemoveAssignment = (templateId: string, dealerId: string) =>
    setOverrides((prev) =>
      (prev ?? data?.draft.assignments ?? []).filter((x) => !(x.templateId === templateId && x.dealerId === dealerId))
    );

  // Persist the current (edited) draft via save_shift_run (returns the new run id).
  const persistDraft = async (): Promise<string | null> => {
    if (!data || !effectiveDraft || clubIds.length === 0) return null;
    const { data: res, error } = await rpc.rpc("save_shift_run", buildSaveRunPayload(clubIds[0], workDate, effectiveDraft));
    if (error) {
      if (String(error.message ?? "").includes("published_schedule_exists")) {
        toast.error("Lịch ngày này đã được publish — không thể ghi đè.");
      } else {
        toast.error(error.message ?? "Lưu nháp thất bại");
      }
      return null;
    }
    const runId = (res?.run_id as string) ?? null;
    setSavedRunId(runId);
    return runId;
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const runId = await persistDraft();
      if (runId) toast.success(`Đã lưu nháp (${effAssignments.length} ca)`);
    } finally { setBusy(false); }
  };

  const handlePublish = async () => {
    setBusy(true);
    try {
      const runId = await persistDraft();
      if (!runId) return;
      const { error } = await rpc.rpc("publish_shift_run", { p_run_id: runId });
      if (error) { toast.error(error.message ?? "Publish thất bại"); return; }
      toast.success("Đã publish lịch — phát sự kiện cho chấm công");
      refetch();
    } finally { setBusy(false); }
  };

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

  // Render the schedule to a PNG and broadcast it to Telegram (floor chat + DMs)
  // via the send-shift-schedule Edge Function (which holds the bot token).
  const handleSendTelegram = async () => {
    if (!data || clubIds.length === 0) return;
    if (effAssignments.length === 0) { toast.error("Chưa có ca nào để gửi"); return; }
    setBusy(true);
    try {
      const dealersById = new Map(data.dealers.map((d) => [d.id, d]));
      const groups = buildShiftGroups(data.templates, effAssignments).map((g) => ({
        label: g.template.label,
        window: `${g.template.startAt.slice(11, 16)} – ${g.template.endAt.slice(11, 16)}`,
        need: g.template.needCount,
        rows: g.assignments.map((a) => ({
          name: a.dealerName,
          role: a.role,
          skills: dealersById.get(a.dealerId)?.skills ?? [],
        })),
      }));
      const png = await buildSchedulePng({
        title: `Lịch dealer · ${dateLabel}`,
        subtitle: `${effAssignments.length} ca`,
        groups,
      });
      const recipients = effAssignments.map((a) => ({
        dealer_id: a.dealerId,
        shift_label: `${a.templateLabel} (${a.scheduledStartAt.slice(11, 16)}–${a.scheduledEndAt.slice(11, 16)})`,
      }));
      const { data: res, error } = await supabase.functions.invoke("send-shift-schedule", {
        body: {
          club_id: clubIds[0],
          work_date: workDate,
          caption_title: `🗓️ Lịch dealer ngày ${workDate}`,
          image_base64: png,
          recipients,
        },
      });
      if (error) { toast.error(error.message ?? "Gửi Telegram thất bại"); return; }
      const r = res as { group_sent?: boolean; group_configured?: boolean; dm_sent?: number; dm_skipped?: number } | null;
      const groupTxt = r?.group_sent ? "nhóm ✓" : r?.group_configured ? "nhóm lỗi" : "nhóm chưa cấu hình";
      toast.success(`Đã gửi Telegram — ${groupTxt}, DM ${r?.dm_sent ?? 0} người${r?.dm_skipped ? `, bỏ qua ${r.dm_skipped}` : ""}`);
    } catch {
      toast.error("Không tạo được ảnh lịch để gửi");
    } finally { setBusy(false); }
  };

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
              <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                Dữ liệu demo
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={workDate}
            onChange={(e) => changeDate(e.target.value)}
            className="h-9 w-[150px]"
          />
          <Button variant="outline" size="sm" className="h-9" onClick={handleRegenerate}>
            <Sparkles className="w-4 h-4 mr-1.5" /> Tạo nháp AI
          </Button>
          <Button
            variant="outline" size="sm" className="h-9"
            onClick={() => setAddOpen(true)}
            disabled={!data}
            title="Gán thủ công 1 dealer vào 1 khung ca"
          >
            <UserPlus className="w-4 h-4 mr-1.5" /> Thêm ca
          </Button>
          {source === "live" && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => setEditorOpen(true)}>
              <SlidersHorizontal className="w-4 h-4 mr-1.5" /> Quản lý ca
            </Button>
          )}
          {source === "live" ? (
            <>
              <Button
                variant="outline" size="sm" className="h-9"
                onClick={handleSave}
                disabled={busy || !data || effAssignments.length === 0}
              >
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} Lưu nháp
              </Button>
              <Button
                size="sm" className="h-9"
                onClick={handlePublish}
                disabled={busy || !data || effAssignments.length === 0}
                title="Lưu + khoá lịch ngày này; phát sự kiện cho chấm công"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />} Publish lịch
              </Button>
              <Button
                variant="outline" size="sm" className="h-9"
                onClick={handleSendTelegram}
                disabled={busy || !data || effAssignments.length === 0}
                title="Gửi ảnh lịch lên nhóm floor + DM từng dealer"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-1.5" />} Gửi Telegram
              </Button>
              {savedRunId && <span className="text-[11px] text-success self-center">✓ đã lưu nháp</span>}
            </>
          ) : (
            <Button size="sm" className="h-9" disabled title="Publish khả dụng ở chế độ live (Phase 2)">
              <Send className="w-4 h-4 mr-1.5" /> Publish lịch
            </Button>
          )}
        </div>
      </div>

      {loading || !data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <>
          <div className="text-xs text-muted-foreground -mt-1">{dateLabel}</div>

          <ShiftSummaryCards templates={data.templates} availability={data.availability} draft={effectiveDraft ?? data.draft} />

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
                        assignments={effAssignments}
                        dealers={data.dealers}
                        onRemove={handleRemoveAssignment}
                      />
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="p-4">
                    <div className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-warning" /> Gợi ý & cảnh báo
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
                  assignments={effAssignments}
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

      {source === "live" && clubIds[0] && (
        <ShiftTemplateEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          clubId={clubIds[0]}
          refDate={workDate}
          onChanged={refetch}
        />
      )}

      {data && (
        <AddShiftDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          dealers={data.dealers}
          templates={data.templates}
          workDate={workDate}
          tzOffsetMinutes={data.config.tzOffsetMinutes}
          assignedDealerIds={assignedDealerIds}
          onAdd={handleAddAssignment}
        />
      )}
    </div>
  );
}
