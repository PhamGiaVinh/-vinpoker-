import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BankrollEntry, GameType } from "@/lib/bankrollMath";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  editing: BankrollEntry | null;
  onSaved: () => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function SessionFormDialog({ open, onOpenChange, userId, editing, onSaved }: Props) {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<GameType>("tournament");
  const [buyin, setBuyin] = useState("");
  const [rake, setRake] = useState("");
  const [prize, setPrize] = useState("");
  const [entries, setEntries] = useState("1");
  const [stakes, setStakes] = useState("");
  const [hours, setHours] = useState("");
  const [pl, setPl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDate(editing.entry_date);
      setType(editing.game_type);
      setBuyin(editing.buyin?.toString() ?? "");
      setRake(editing.rake?.toString() ?? "");
      setPrize(editing.prize_won?.toString() ?? "");
      setEntries(editing.entries?.toString() ?? "1");
      setStakes(editing.stakes ?? "");
      setHours(editing.hours?.toString() ?? "");
      setPl(editing.profit_loss?.toString() ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setDate(todayStr());
      setType("tournament");
      setBuyin(""); setRake(""); setPrize(""); setEntries("1");
      setStakes(""); setHours(""); setPl(""); setNotes("");
    }
  }, [open, editing]);

  const num = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    setSaving(true);
    const payload = {
      user_id: userId,
      entry_date: date,
      game_type: type,
      buyin: type === "tournament" ? num(buyin) : null,
      rake: type === "tournament" ? num(rake) : null,
      prize_won: type === "tournament" ? num(prize) : null,
      entries: type === "tournament" ? (num(entries) ?? 1) : null,
      stakes: type === "cash" ? stakes || null : null,
      hours: type === "cash" ? num(hours) : null,
      profit_loss: type === "cash" ? num(pl) : null,
      notes: notes || null,
    };
    const q = editing
      ? supabase.from("bankroll_entries").update(payload).eq("id", editing.id)
      : supabase.from("bankroll_entries").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? t("bankroll.form.updated") : t("bankroll.form.added"));
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] sm:w-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("bankroll.form.editTitle") : t("bankroll.form.addTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Cash game option tạm ẩn - giữ code để dùng lại sau */}

          <div>
            <Label htmlFor="date">{t("bankroll.form.date")}</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {type === "tournament" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("bankroll.form.buyin")}</Label>
                <Input type="number" inputMode="decimal" value={buyin} onChange={(e) => setBuyin(e.target.value)} />
              </div>
              <div>
                <Label>{t("bankroll.form.rake")}</Label>
                <Input type="number" inputMode="decimal" value={rake} onChange={(e) => setRake(e.target.value)} />
              </div>
              <div>
                <Label>{t("bankroll.form.prize")}</Label>
                <Input type="number" inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value)} />
              </div>
              <div>
                <Label>{t("bankroll.form.entries")}</Label>
                <Input type="number" inputMode="numeric" value={entries} onChange={(e) => setEntries(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{t("bankroll.form.stakes")}</Label>
                <Input value={stakes} onChange={(e) => setStakes(e.target.value)} placeholder="1/2" />
              </div>
              <div>
                <Label>{t("bankroll.form.hours")}</Label>
                <Input type="number" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div>
                <Label>{t("bankroll.form.pl")}</Label>
                <Input type="number" inputMode="decimal" value={pl} onChange={(e) => setPl(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <Label>{t("bankroll.form.notes")}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("bankroll.form.cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("bankroll.form.saving") : t("bankroll.form.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
