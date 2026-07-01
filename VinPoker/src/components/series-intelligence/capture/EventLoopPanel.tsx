import { useState } from "react";
import { TrendingUp, ClipboardList, Flag, Pencil, Megaphone, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatVND, formatShortDate } from "@/lib/format";
import { findScoredDecision, pickScoringSnapshot, scoreOutcome, registrationFunnel } from "@/lib/series-intelligence/captureScoring";
import { HORIZON_LABEL, COMMITMENT_LABEL, STAGE_ORDER, type CampaignLog, type DecisionLog } from "@/lib/series-intelligence/captureTypes";
import { shortHash } from "@/lib/series-intelligence/hashPlayerRef";
import type { UseSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";
import { DecisionTimeline } from "./DecisionTimeline";
import { OutcomeScorecard } from "./OutcomeScorecard";
import { ForecastDialog } from "./dialogs/ForecastDialog";
import { DecisionDialog } from "./dialogs/DecisionDialog";
import { CampaignDialog } from "./dialogs/CampaignDialog";
import { RegistrationDialog } from "./dialogs/RegistrationDialog";

type DialogKind = null | "forecast" | "decision" | "result" | "campaign" | "registration";

/** Big guided action for the "Giải này bạn muốn ghi gì?" question. */
function ActionButton({ icon: Icon, title, hint, onClick }: { icon: typeof TrendingUp; title: string; hint: string; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-auto justify-start gap-2 py-2.5" onClick={onClick}>
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <div className="text-left">
        <div className="text-sm font-medium leading-tight">{title}</div>
        <div className="text-[10px] font-normal text-muted-foreground">{hint}</div>
      </div>
    </Button>
  );
}

/**
 * Wizard hub for one event: a plain "what do you want to record?" question with big buttons, then the timeline /
 * scorecard / recorded lists appear only once there is data. Owns the create/edit dialogs.
 */
export function EventLoopPanel({ eventId, hook }: { eventId: string; hook: UseSeriesCapture }) {
  const snaps = hook.snapshots.filter((s) => s.event_id === eventId);
  const decs = hook.decisions.filter((d) => d.event_id === eventId);
  const camps = hook.campaigns.filter((c) => c.event_linked === eventId);
  const regs = hook.registrations.filter((r) => r.event_id === eventId);

  const scored = findScoredDecision(decs);
  const scoringSnap = pickScoringSnapshot(snaps, scored);
  const hasScore = scoreOutcome(scoringSnap, scored).hasActuals;
  const existingPost = decs.find((d) => d.decision_horizon === "post") ?? null;
  const funnel = registrationFunnel(regs);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [editingDecision, setEditingDecision] = useState<DecisionLog | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<CampaignLog | null>(null);

  const close = () => {
    setDialog(null);
    setEditingDecision(null);
    setEditingCampaign(null);
  };
  const nothingYet = snaps.length + decs.length + camps.length + regs.length === 0;

  return (
    <div className="space-y-4">
      {/* how-to */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Cách dùng:</strong> Trước giải → ghi <em>dự đoán</em> + <em>quyết định</em>. Sau
        giải → <em>nhập kết quả</em>. Hệ thống tự đối chiếu dự đoán với thực tế.
      </div>

      {/* the question + big buttons */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="mb-2 text-sm font-medium">Giải này bạn muốn ghi gì?</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionButton icon={TrendingUp} title="Ghi dự đoán" hint="trước giải · bao nhiêu khách" onClick={() => { setEditingDecision(null); setDialog("forecast"); }} />
          <ActionButton icon={ClipboardList} title="Ghi quyết định" hint="giữ/hạ GTD, đẩy marketing…" onClick={() => { setEditingDecision(null); setDialog("decision"); }} />
          <ActionButton icon={Flag} title="Nhập kết quả sau giải" hint="số thực tế → chấm dự đoán" onClick={() => { setEditingDecision(existingPost); setDialog("result"); }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setEditingCampaign(null); setDialog("campaign"); }}>
            <Megaphone className="h-3.5 w-3.5" /> + Marketing
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setDialog("registration")}>
            <Users2 className="h-3.5 w-3.5" /> + Đăng ký
          </Button>
        </div>
      </div>

      {/* timeline — only when there is activity */}
      {snaps.length + decs.length > 0 && <DecisionTimeline snapshots={snaps} decisions={decs} />}

      {/* scorecard — only once actuals exist */}
      {hasScore && <OutcomeScorecard snapshot={scoringSnap} scored={scored} />}

      {nothingYet && <p className="text-xs text-muted-foreground">Giải này chưa có gì được ghi. Bấm một nút ở trên để bắt đầu.</p>}

      {/* recorded lists — only non-empty */}
      {decs.length > 0 && (
        <RecordedBlock title="Quyết định đã ghi" count={decs.length}>
          {decs.map((d) => (
            <li key={d.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant={d.decision_horizon === "post" ? "secondary" : "outline"} className="text-[10px]">{HORIZON_LABEL[d.decision_horizon] ?? d.decision_horizon}</Badge>
                {d.owner_decision && <span className="font-medium">{d.owner_decision}</span>}
                {d.public_action && <span className="text-muted-foreground">· {d.public_action}</span>}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  {formatShortDate(d.created_at)}
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Sửa" onClick={() => { setEditingDecision(d); setDialog(d.decision_horizon === "post" ? "result" : "decision"); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </span>
              </div>
              {d.decision_reason && <div className="text-[11px] text-muted-foreground">{d.decision_reason}</div>}
              {d.decision_horizon === "post" && d.actual_entries != null && (
                <div className="mt-1 text-[10px] text-primary/90">
                  Thực tế: {d.actual_entries} người{d.actual_prize_pool != null && ` · pool ${formatVND(d.actual_prize_pool)}`}
                  {d.actual_overlay_amount != null && ` · bù ${formatVND(d.actual_overlay_amount)}`}
                </div>
              )}
            </li>
          ))}
        </RecordedBlock>
      )}

      {snaps.length > 0 && (
        <RecordedBlock title="Dự đoán đã ghi" count={snaps.length}>
          {snaps.map((s) => (
            <li key={s.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline" className="text-[10px]">{HORIZON_LABEL[s.horizon] ?? s.horizon}</Badge>
                <span className="font-mono">
                  {s.forecast_low ?? "—"} · <span className="font-semibold text-primary">{s.forecast_base ?? "—"}</span> · {s.forecast_high ?? "—"} người
                </span>
                {s.candidate_gtd != null && <span className="text-muted-foreground">GTD {formatVND(s.candidate_gtd)}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground">{formatShortDate(s.created_at)}</span>
              </div>
              {s.notes && <div className="mt-0.5 text-[11px] text-muted-foreground">{s.notes}</div>}
            </li>
          ))}
        </RecordedBlock>
      )}

      {camps.length > 0 && (
        <RecordedBlock title="Marketing" count={camps.length}>
          {camps.map((c) => (
            <li key={c.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {c.channel && <span className="font-medium">{c.channel}</span>}
                {c.spend != null && <span className="font-semibold text-primary">{formatVND(c.spend)}</span>}
                {c.target_segment && <span className="text-muted-foreground">· {c.target_segment}</span>}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  {formatShortDate(c.created_at)}
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Sửa" onClick={() => { setEditingCampaign(c); setDialog("campaign"); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </RecordedBlock>
      )}

      {regs.length > 0 && (
        <RecordedBlock title="Đăng ký" count={funnel.total}>
          <li className="flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
            <Badge variant="secondary">{funnel.total} lượt</Badge>
            <Badge variant="secondary">{funnel.unique} người</Badge>
            <Badge variant="secondary">{funnel.reentries} re-entry</Badge>
            {STAGE_ORDER.filter((s) => funnel.byStage[s]).map((s) => (
              <Badge key={s} variant="outline" className="text-[10px]">{COMMITMENT_LABEL[s]}: {funnel.byStage[s]}</Badge>
            ))}
          </li>
          {regs.slice(0, 8).map((r) => (
            <li key={r.id} className="px-1 text-[10px] text-muted-foreground">
              <span className="font-mono">{shortHash(r.player_ref_hash)}</span>
              {r.commitment_stage && ` · ${COMMITMENT_LABEL[r.commitment_stage] ?? r.commitment_stage}`}
              {r.is_reentry && " · re-entry"}
            </li>
          ))}
        </RecordedBlock>
      )}

      {/* dialogs */}
      <ForecastDialog open={dialog === "forecast"} onOpenChange={(v) => !v && close()} eventId={eventId} saving={hook.saving} insertForecast={hook.insertForecast} />
      <DecisionDialog
        open={dialog === "decision" || dialog === "result"}
        onOpenChange={(v) => !v && close()}
        eventId={eventId}
        snapshots={snaps}
        saving={hook.saving}
        insertDecision={hook.insertDecision}
        updateDecision={hook.updateDecision}
        editing={editingDecision}
        resultMode={dialog === "result"}
      />
      <CampaignDialog open={dialog === "campaign"} onOpenChange={(v) => !v && close()} eventId={eventId} saving={hook.saving} insertCampaign={hook.insertCampaign} updateCampaign={hook.updateCampaign} editing={editingCampaign} />
      <RegistrationDialog open={dialog === "registration"} onOpenChange={(v) => !v && close()} eventId={eventId} saving={hook.saving} insertRegistration={hook.insertRegistration} />
    </div>
  );
}

function RecordedBlock({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title} <span className="text-muted-foreground/60">({count})</span>
      </h4>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}
