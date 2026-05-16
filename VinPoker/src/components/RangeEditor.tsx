import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRangeEditor } from "@/hooks/useRangeEditor";
import { POSITIONS, allHands, type HandAction, type Position, type StackDepth } from "@/lib/gto/rangeTree";
import { makeSpotKey } from "@/lib/gto/precomputed";
import RangeHistoryPanel from "@/components/gto/RangeHistoryPanel";
import { copyRangeToClipboard, pasteRangeFromClipboard } from "@/lib/gto/rangeClipboard";

const SPOT_TYPES = ["OPEN", "VS_3B", "VS_4B", "VS_ALLIN"] as const;
type SpotType = (typeof SPOT_TYPES)[number];

export default function RangeEditor() {
  const { isAdmin, loading } = useAuth();
  const [position, setPosition] = useState<Position>("UTG");
  const [spotType, setSpotType] = useState<SpotType>("OPEN");
  const [depth, setDepth] = useState<StackDepth>(50);
  const spotKey = useMemo(() => makeSpotKey(position, spotType, depth), [position, spotType, depth]);

  const {
    range, dirty, saving, stats,
    setHandFreq, setAllFold, replaceRange, save, reset, exportSnippet,
  } = useRangeEditor(spotKey);

  const [selected, setSelected] = useState<string | null>(null);
  const sel = selected ? range[selected] : null;
  const canEdit = isAdmin;

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Đang tải…</Card>;
  }
  if (!canEdit) {
    return (
      <Card className="p-6 text-sm">
        Chỉ <b>Super Admin</b> mới được chỉnh sửa &amp; lưu range GTO chính thức cho toàn bộ user.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="font-semibold">Spot:</span>

          <select
            className="bg-background border border-border rounded px-2 py-1"
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
          >
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <select
            className="bg-background border border-border rounded px-2 py-1"
            value={spotType}
            onChange={(e) => setSpotType(e.target.value as SpotType)}
          >
            {SPOT_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <Input
            type="number"
            className="w-20"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value) as StackDepth)}
          />
          <span className="text-muted-foreground">bb</span>

          <Badge variant="outline" className="ml-auto font-mono">{spotKey}</Badge>
          {dirty && <Badge variant="destructive">unsaved</Badge>}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span><span className="inline-block w-3 h-3 bg-gto-fold mr-1 align-middle" />Fold {stats.foldPct.toFixed(1)}%</span>
          <span><span className="inline-block w-3 h-3 bg-gto-call mr-1 align-middle" />Call {stats.callPct.toFixed(1)}%</span>
          <span><span className="inline-block w-3 h-3 bg-gto-raise mr-1 align-middle" />Raise {stats.raisePct.toFixed(1)}%</span>
          <span><span className="inline-block w-3 h-3 bg-gto-allin mr-1 align-middle" />Allin {stats.allinPct.toFixed(1)}%</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              try {
                await save();
                toast({ title: "Đã lưu", description: spotKey + " đã sync cho mọi user." });
              } catch (err: any) {
                toast({ title: "Lưu thất bại", description: err?.message ?? String(err), variant: "destructive" });
              }
            }}
            disabled={!dirty || saving}
          >
            {saving ? "Đang lưu…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={async () => {
              try {
                await reset();
                toast({ title: "Đã reset về mặc định", description: spotKey });
              } catch (err: any) {
                toast({ title: "Reset thất bại", description: err?.message ?? String(err), variant: "destructive" });
              }
            }}
          >
            Reset to default
          </Button>
          <Button size="sm" variant="outline" onClick={setAllFold}>Clear all (fold)</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const snippet = exportSnippet();
              try {
                await navigator.clipboard.writeText(snippet);
                toast({ title: "Copied snippet", description: spotKey });
              } catch {
                toast({ title: "Snippet", description: snippet });
              }
            }}
          >
            Export TS
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await copyRangeToClipboard(range, spotKey);
              toast({ title: "Đã copy range", description: `${spotKey} → clipboard` });
            }}
          >
            Copy range
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await pasteRangeFromClipboard();
              if (!r || Object.keys(r).length === 0) {
                toast({ title: "Clipboard rỗng", description: "Hãy Copy 1 range trước.", variant: "destructive" });
                return;
              }
              replaceRange(r);
              toast({ title: "Đã paste range", description: `${spotKey} (chưa lưu — bấm Save)` });
            }}
          >
            Paste range
          </Button>
        </div>
      </Card>

      <Card className="p-2">
        <div className="grid grid-cols-13 gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {allHands().map((hand) => {
            const ha = range[hand];
            const isSel = selected === hand;
            return (
              <button
                key={hand}
                onClick={() => setSelected(hand)}
                className={`relative aspect-square text-[10px] font-mono border ${
                  isSel ? "border-primary border-2" : "border-border/40"
                } overflow-hidden`}
                title={hand}
              >
                <CellBars ha={ha} />
                <span className="relative z-10 text-foreground drop-shadow">{hand}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {sel && selected && (
        <Card className="p-3 space-y-3">
          <div className="font-semibold">Edit {selected}</div>
          {(["allin", "raise", "call", "fold"] as (keyof HandAction)[]).map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-14 text-sm capitalize">{k}</span>
              <Slider
                className="flex-1"
                value={[Math.round(sel[k] * 100)]}
                onValueChange={([v]) => setHandFreq(selected, k, v / 100)}
                min={0} max={100} step={1}
              />
              <span className="w-12 text-right text-sm tabular-nums">
                {(sel[k] * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </Card>
      )}

      <RangeHistoryPanel spotKey={spotKey} />
    </div>
  );
}

function CellBars({ ha }: { ha: HandAction }) {
  const segs = [
    { pct: ha.allin * 100, cls: "bg-gto-allin" },
    { pct: ha.raise * 100, cls: "bg-gto-raise" },
    { pct: ha.call * 100, cls: "bg-gto-call" },
    { pct: ha.fold * 100, cls: "bg-gto-fold" },
  ];
  return (
    <div className="absolute inset-0 flex">
      {segs.map((s, i) => s.pct > 0 && (
        <div key={i} className={s.cls} style={{ width: `${s.pct}%` }} />
      ))}
    </div>
  );
}
