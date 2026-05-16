import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Sparkles, ExternalLink, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type Status = "pending" | "approved" | "rejected";

interface Row {
  player_id: string;
  itm_rate: number;
  roi_percentage: number;
  tournaments_played: number;
  tournaments_cashed: number;
  backing_description: string | null;
  backing_percentage_available: number | null;
  backing_status: Status | "off";
  backing_review_note: string | null;
  backing_reviewed_at: string | null;
  updated_at: string;
  display_name?: string;
  region?: string;
}

export const BackingReviewQueue = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: stats } = await supabase
      .from("player_stats")
      .select("*")
      .in("backing_status", ["pending", "approved", "rejected"])
      .order("updated_at", { ascending: false });
    const ids = (stats ?? []).map((s: any) => s.player_id);
    let profMap = new Map<string, any>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id,display_name,region")
        .in("user_id", ids);
      profMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
    }
    setRows(
      (stats ?? []).map((s: any) => ({
        ...s,
        display_name: profMap.get(s.player_id)?.display_name ?? "Player",
        region: profMap.get(s.player_id)?.region ?? null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-backing-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "player_stats" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const approve = async (player_id: string) => {
    const { error } = await supabase
      .from("player_stats")
      .update({ backing_status: "approved", backing_review_note: null })
      .eq("player_id", player_id);
    if (error) toast.error(error.message);
    else toast.success("Đã duyệt hồ sơ");
  };

  const reject = async (player_id: string, note: string) => {
    const { error } = await supabase
      .from("player_stats")
      .update({ backing_status: "rejected", backing_review_note: note || null })
      .eq("player_id", player_id);
    if (error) toast.error(error.message);
    else toast.success("Đã từ chối");
  };

  const revoke = async (player_id: string) => {
    const { error } = await supabase
      .from("player_stats")
      .update({ backing_status: "pending", backing_review_note: null })
      .eq("player_id", player_id);
    if (error) toast.error(error.message);
    else toast.success("Đã đưa lại hàng chờ");
  };

  const pending = rows.filter((r) => r.backing_status === "pending");
  const approved = rows.filter((r) => r.backing_status === "approved");
  const rejected = rows.filter((r) => r.backing_status === "rejected");

  if (loading) return <p className="text-sm text-muted-foreground">Đang tải...</p>;

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Chờ duyệt ({pending.length})</TabsTrigger>
        <TabsTrigger value="approved">Đã duyệt ({approved.length})</TabsTrigger>
        <TabsTrigger value="rejected">Đã từ chối ({rejected.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="space-y-3 mt-3">
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có hồ sơ chờ duyệt.</p>
        ) : pending.map((r) => (
          <RowCard key={r.player_id} row={r} actions={
            <>
              <RejectDialog onConfirm={(note) => reject(r.player_id, note)} />
              <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => approve(r.player_id)}>
                <Check className="w-4 h-4 mr-1" /> Duyệt
              </Button>
            </>
          } />
        ))}
      </TabsContent>
      <TabsContent value="approved" className="space-y-3 mt-3">
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có hồ sơ nào được duyệt.</p>
        ) : approved.map((r) => (
          <RowCard key={r.player_id} row={r} actions={
            <Button size="sm" variant="outline" onClick={() => revoke(r.player_id)}>
              <RotateCcw className="w-4 h-4 mr-1" /> Thu hồi (đưa lại chờ)
            </Button>
          } />
        ))}
      </TabsContent>
      <TabsContent value="rejected" className="space-y-3 mt-3">
        {rejected.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có hồ sơ bị từ chối.</p>
        ) : rejected.map((r) => (
          <RowCard key={r.player_id} row={r} actions={
            <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => approve(r.player_id)}>
              <Check className="w-4 h-4 mr-1" /> Duyệt lại
            </Button>
          } />
        ))}
      </TabsContent>
    </Tabs>
  );
};

const RowCard = ({ row, actions }: { row: Row; actions: React.ReactNode }) => {
  const roiPositive = row.roi_percentage >= 0;
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="font-semibold truncate">{row.display_name}</span>
            {row.region && <span className="text-xs text-muted-foreground">· {row.region}</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {row.tournaments_played} giải · ITM {row.itm_rate}% ·
            <span className={roiPositive ? "text-green-500" : "text-red-500"}> ROI {roiPositive ? "+" : ""}{row.roi_percentage}%</span>
            · Bán {row.backing_percentage_available ?? 20}%
          </div>
          {row.backing_description && (
            <p className="text-xs italic text-muted-foreground border-l-2 border-primary/40 pl-2 mt-2">
              "{row.backing_description}"
            </p>
          )}
          {row.backing_review_note && row.backing_status === "rejected" && (
            <Badge className="mt-2 bg-red-500/20 text-red-500 border-red-500/40">
              Lý do từ chối: {row.backing_review_note}
            </Badge>
          )}
        </div>
        <Link to={`/player/${row.player_id}`} target="_blank" className="text-xs text-primary flex items-center gap-1 shrink-0">
          Xem profile <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      <div className="flex justify-end gap-2 pt-1">{actions}</div>
    </Card>
  );
};

const RejectDialog = ({ onConfirm }: { onConfirm: (note: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10">
          <X className="w-4 h-4 mr-1" /> Từ chối
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Từ chối hồ sơ Backing</DialogTitle>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Lý do (sẽ được hiển thị cho player để họ chỉnh sửa)..."
          rows={4}
          maxLength={300}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Hủy</Button>
          <Button
            className="bg-destructive text-destructive-foreground"
            onClick={() => { onConfirm(note); setOpen(false); setNote(""); }}
          >
            Xác nhận từ chối
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
