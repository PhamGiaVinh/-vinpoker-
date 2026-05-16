import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Radio, Save } from "lucide-react";

type LiveStatus = "registering" | "playing" | "finished";

interface Props {
  tournament: {
    id: string;
    current_players?: number | null;
    current_level?: number | null;
    current_blinds?: string | null;
    live_status?: LiveStatus | null;
  };
  onSaved?: () => void;
}

export const LiveStateEditor = ({ tournament, onSaved }: Props) => {
  const [f, setF] = useState({
    current_players: tournament.current_players ?? 0,
    current_level: tournament.current_level ?? 1,
    current_blinds: tournament.current_blinds ?? "",
    live_status: (tournament.live_status ?? "registering") as LiveStatus,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("tournaments").update({
      current_players: Number(f.current_players),
      current_level: Number(f.current_level),
      current_blinds: f.current_blinds,
      live_status: f.live_status,
    }).eq("id", tournament.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Live state updated"); onSaved?.(); }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-neon">
        <Radio className="w-3.5 h-3.5" /> Live state
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] uppercase">Players</Label>
          <Input type="number" value={f.current_players} onChange={e => setF({ ...f, current_players: +e.target.value })} className="h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase">Level</Label>
          <Input type="number" value={f.current_level} onChange={e => setF({ ...f, current_level: +e.target.value })} className="h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase">Blind</Label>
          <Input value={f.current_blinds} onChange={e => setF({ ...f, current_blinds: e.target.value })} placeholder="500/1000" className="h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase">Status</Label>
          <Select value={f.live_status} onValueChange={v => setF({ ...f, live_status: v as LiveStatus })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="registering">Registering</SelectItem>
              <SelectItem value="playing">Playing</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button size="sm" onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
        <Save className="w-3.5 h-3.5 mr-1" />{saving ? "Saving..." : "Update live"}
      </Button>
    </div>
  );
};
