import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RotateCcw, Trash2, Pencil } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DEFAULT_EV_DATA,
  EVAction,
  STREETS,
  Street,
  loadEV,
  saveEV,
  resetEV,
} from "@/lib/gto/evData";

export default function EVAnalysisPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<Record<Street, EVAction[]>>(() => DEFAULT_EV_DATA);
  const [street, setStreet] = useState<Street>("preflop");
  const [editing, setEditing] = useState<{ idx: number | null } | null>(null);
  const [form, setForm] = useState<EVAction>({ action: "", ev: 0, freq: 0 });

  useEffect(() => {
    setData(loadEV());
  }, []);

  const rows = data[street] ?? [];
  const totalFreq = useMemo(() => rows.reduce((s, r) => s + (r.freq || 0), 0), [rows]);

  const persist = (next: Record<Street, EVAction[]>) => {
    setData(next);
    saveEV(next);
  };

  const openAdd = () => {
    setForm({ action: "", ev: 0, freq: 0 });
    setEditing({ idx: null });
  };
  const openEdit = (idx: number) => {
    setForm({ ...rows[idx] });
    setEditing({ idx });
  };
  const handleSave = () => {
    if (!form.action.trim()) return;
    const next = { ...data, [street]: [...rows] };
    if (editing?.idx == null) next[street] = [...rows, form];
    else next[street] = rows.map((r, i) => (i === editing.idx ? form : r));
    persist(next);
    setEditing(null);
  };
  const handleDelete = (idx: number) => {
    const next = { ...data, [street]: rows.filter((_, i) => i !== idx) };
    persist(next);
  };
  const handleReset = () => {
    resetEV();
    setData(structuredClone(DEFAULT_EV_DATA));
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold">{t("gto.ev.title")}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4" />
            {t("gto.ev.reset")}
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4" />
            {t("gto.ev.addAction")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STREETS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={street === s ? "default" : "secondary"}
            onClick={() => setStreet(s)}
          >
            {t(`gto.ev.street.${s}`)}
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("gto.ev.col.action")}</TableHead>
            <TableHead className="text-right">{t("gto.ev.col.ev")}</TableHead>
            <TableHead className="text-right">{t("gto.ev.col.freq")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                {t("gto.ev.empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={`${r.action}-${i}`}>
                <TableCell className="font-medium">{r.action}</TableCell>
                <TableCell
                  className={`text-right font-semibold ${
                    r.ev >= 0 ? "text-primary" : "text-destructive"
                  }`}
                >
                  {r.ev >= 0 ? "+" : ""}
                  {r.ev.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">{r.freq}%</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(i)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(i)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalFreq !== 100 && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("gto.ev.freqWarn", { total: totalFreq })}
        </p>
      )}

      {rows.length > 0 && (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <XAxis dataKey="action" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="ev">
                {rows.map((r, i) => (
                  <Cell
                    key={i}
                    fill={r.ev >= 0 ? "hsl(var(--primary))" : "hsl(var(--destructive))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.idx == null ? t("gto.ev.addAction") : t("gto.ev.editAction")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t("gto.ev.col.action")}
              </label>
              <Input
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                placeholder="Raise 3x / Call / Fold / All-In"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">
                  {t("gto.ev.col.ev")}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.ev}
                  onChange={(e) => setForm({ ...form, ev: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  {t("gto.ev.col.freq")}
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.freq}
                  onChange={(e) => setForm({ ...form, freq: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!form.action.trim()}>
              {t("gto.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
