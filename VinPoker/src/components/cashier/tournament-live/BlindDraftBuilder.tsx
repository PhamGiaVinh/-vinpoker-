import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidBlindDraft, suggestBlindDraft } from "@/lib/blindDraftSuggest";
import type { BlindLevel } from "@/lib/blindPresets";

interface Props {
  startingStack: number;
  levelMinutes: number;
  disabled?: boolean;
  onUse: (levels: BlindLevel[]) => void;
}

/** A local, editable draft. The parent owns the explicit create/save action. */
export function BlindDraftBuilder({ startingStack, levelMinutes, disabled, onUse }: Props) {
  const [hours, setHours] = useState(8);
  const [depth, setDepth] = useState(250);
  const [breakEvery, setBreakEvery] = useState(4);
  const [breakMinutes, setBreakMinutes] = useState(15);
  const [rows, setRows] = useState<BlindLevel[]>([]);
  const [error, setError] = useState("");
  const [replacePending, setReplacePending] = useState(false);

  const generate = () => {
    try {
      setRows(suggestBlindDraft({ startingStack, levelMinutes, targetMinutes: hours * 60,
        startingDepth: depth, breakEvery, breakMinutes }));
      setError("");
      setReplacePending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate a draft.");
    }
  };
  const edit = (index: number, key: keyof Pick<BlindLevel, "small_blind" | "big_blind" | "ante" | "duration_minutes">, value: string) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value === "" ? NaN : Number(value) } : row));
  };

  return <section aria-label="Blind structure draft" className="space-y-3 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold">Blind structure builder</h3>
    <p className="text-xs text-muted-foreground">Editable draft using the setup stack ({startingStack.toLocaleString("en-US")}) and {levelMinutes}-minute levels.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><Label htmlFor="draft-hours">Target hours</Label><Input id="draft-hours" type="number" min={1} max={12} value={hours} onChange={event => setHours(Number(event.target.value))} disabled={disabled} /></div>
      <div><Label htmlFor="draft-depth">Starting depth (BB)</Label><Input id="draft-depth" type="number" min={20} max={500} value={depth} onChange={event => setDepth(Number(event.target.value))} disabled={disabled} /></div>
      <div><Label htmlFor="draft-break-every">Break every (levels)</Label><Input id="draft-break-every" type="number" min={1} max={12} value={breakEvery} onChange={event => setBreakEvery(Number(event.target.value))} disabled={disabled} /></div>
      <div><Label htmlFor="draft-break-minutes">Break minutes</Label><Input id="draft-break-minutes" type="number" min={0} max={60} value={breakMinutes} onChange={event => setBreakMinutes(Number(event.target.value))} disabled={disabled} /></div>
    </div>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => rows.length ? setReplacePending(true) : generate()}>Generate draft</Button>
    {replacePending && <div role="alert" className="space-y-2 text-sm"><p>Replace your edited draft?</p><Button type="button" disabled={disabled} onClick={generate}>Replace draft</Button><Button type="button" variant="ghost" onClick={() => setReplacePending(false)}>Keep edits</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {rows.length > 0 && <>
      <div role="region" aria-label="Editable blind levels" tabIndex={0} className="max-h-72 overflow-auto rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <table className="w-full min-w-[440px] text-xs">
          <caption className="p-2 text-left">{rows.filter(row => !row.is_break).length} playing levels · {rows.reduce((sum, row) => sum + (Number.isFinite(row.duration_minutes) ? row.duration_minutes : 0), 0)} scheduled minutes · BB ante</caption>
          <thead><tr>{["Level", "SB", "BB", "Ante", "Minutes"].map(label => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.level_number} className="border-t border-border">
            <th className="p-2" scope="row">{row.is_break ? "Break" : row.level_number}</th>
            {(["small_blind", "big_blind", "ante", "duration_minutes"] as const).map(key => <td key={key} className="p-1"><Input aria-label={`Row ${index + 1} ${key}`} type="number" min={key === "duration_minutes" ? 1 : 0} className="h-10 min-w-20" value={Number.isFinite(row[key]) ? row[key] : ""} disabled={disabled || (row.is_break && key !== "duration_minutes")} onChange={event => edit(index, key, event.target.value)} /></td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {!isValidBlindDraft(rows) && <p role="alert" className="text-sm text-destructive">Fix invalid blinds or durations before using this draft.</p>}
      <Button type="button" disabled={disabled || !isValidBlindDraft(rows)} onClick={() => onUse(rows.map(row => ({ ...row })))}>Use reviewed draft</Button>
    </>}
    <p className="text-xs text-muted-foreground">Scheduled duration is not a guaranteed finish time. Nothing is saved until you create the tournament.</p>
  </section>;
}
