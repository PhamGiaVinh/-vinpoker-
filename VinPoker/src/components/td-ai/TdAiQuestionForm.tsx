import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { TdSituation, TdStreet } from "@/lib/tdai/types";

const STREETS: TdStreet[] = ["preflop", "flop", "turn", "river", "showdown", "other"];

/** Situation form. Submits a TdSituation; description is required. */
export function TdAiQuestionForm({
  tournamentId,
  onSubmit,
}: {
  tournamentId?: string;
  onSubmit: (s: TdSituation) => void;
}) {
  const { t } = useTranslation();
  const [tableLabel, setTableLabel] = useState("");
  const [street, setStreet] = useState<TdStreet | "">("");
  const [playersInvolved, setPlayersInvolved] = useState("");
  const [actionSequence, setActionSequence] = useState("");
  const [description, setDescription] = useState("");
  const [houseRuleNote, setHouseRuleNote] = useState("");

  const canSubmit = description.trim().length >= 3;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      tournamentId,
      tableLabel: tableLabel.trim() || undefined,
      street: street || undefined,
      playersInvolved: playersInvolved.trim() || undefined,
      actionSequence: actionSequence.trim() || undefined,
      description: description.trim(),
      houseRuleNote: houseRuleNote.trim() || undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("tdAi.form.table")}</Label>
          <Input value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} placeholder={t("tdAi.form.tablePlaceholder")} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("tdAi.form.street")}</Label>
          <Select value={street} onValueChange={(v) => setStreet(v as TdStreet)}>
            <SelectTrigger><SelectValue placeholder={t("tdAi.form.streetPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {STREETS.map((s) => (
                <SelectItem key={s} value={s}>{t(`tdAi.street.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">{t("tdAi.form.players")}</Label>
        <Input value={playersInvolved} onChange={(e) => setPlayersInvolved(e.target.value)} placeholder={t("tdAi.form.playersPlaceholder")} />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">{t("tdAi.form.actionSequence")}</Label>
        <Input value={actionSequence} onChange={(e) => setActionSequence(e.target.value)} placeholder={t("tdAi.form.actionSequencePlaceholder")} />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">{t("tdAi.form.description")} <span className="text-destructive">*</span></Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("tdAi.form.descriptionPlaceholder")}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">{t("tdAi.form.houseRule")}</Label>
        <Input value={houseRuleNote} onChange={(e) => setHouseRuleNote(e.target.value)} placeholder={t("tdAi.form.houseRulePlaceholder")} />
      </div>

      <Button onClick={submit} disabled={!canSubmit} className="w-full">
        <Search className="mr-1 h-4 w-4" /> {t("tdAi.form.lookup")}
      </Button>
    </div>
  );
}
