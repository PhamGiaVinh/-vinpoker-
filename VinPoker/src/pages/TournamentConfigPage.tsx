import { useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import {
  useTournaments,
  useCreateTournament,
  useUpdateTournament,
  useDeleteTournament,
} from "@/hooks/useTournaments";
import { useActiveTables } from "@/hooks/useDealerSwing";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TournamentWithTables } from "@/types/tournament";

export default function TournamentConfigPage() {
  const { user, loading: authLoading, isAdmin, role } = useAuth();
  const { clubId } = useParams<{ clubId: string }>();
  const clubIdStr = clubId ?? "";

  const { data: tournaments, isLoading: toursLoading } = useTournaments(clubIdStr);
  const { data: allTables } = useActiveTables(clubIdStr ? [clubIdStr] : []);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState<TournamentWithTables | null>(null);

  if (authLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const canManageSwing =
    isAdmin ||
    role === "dealer_control" ||
    role === "club_admin";

  if (!canManageSwing) {
    return (
      <div className="p-6 text-muted-foreground">
        Bạn không có quyền quản lý swing configuration.
      </div>
    );
  }

  if (!clubId) {
    return (
      <div className="p-6 text-muted-foreground">
        Chọn CLB từ URL để quản lý tournament.
      </div>
    );
  }

  if (toursLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Đang tải...
      </div>
    );
  }

  // Tables chưa được assign vào tournament nào
  const assignedTableIds = new Set(
    tournaments?.flatMap((t) => t.tournament_tables.map((tt) => tt.table_id)) ?? []
  );
  const unassignedTables = allTables?.filter((t) => !assignedTableIds.has(t.id)) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cấu hình Tournament</h1>
          <p className="text-muted-foreground">
            Quản lý swing duration theo từng giải đấu
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>+ Tạo Tournament</Button>
      </div>

      {/* Unassigned Tables Warning */}
      {unassignedTables.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-yellow-500">
              ⚠️ Bàn chưa được gán
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unassignedTables.map((table) => (
                <Badge key={table.id} variant="outline">
                  {table.table_name ?? table.name ?? table.id.slice(0, 8)}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Các bàn này sẽ dùng swing duration mặc định của CLB
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tournament List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tournaments?.map((tournament) => (
          <TournamentCard
            key={tournament.id}
            tournament={tournament}
            onEdit={() => setEditingTournament(tournament)}
          />
        ))}
        {(!tournaments || tournaments.length === 0) && (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center text-muted-foreground">
              Chưa có tournament nào. Bấm &ldquo;Tạo Tournament&rdquo; để bắt đầu.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <TournamentDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clubId={clubIdStr}
        allTables={allTables ?? []}
        assignedTableIds={assignedTableIds}
      />

      {/* Edit Dialog */}
      {editingTournament && (
        <TournamentDialog
          open={!!editingTournament}
          onOpenChange={(open) => !open && setEditingTournament(null)}
          clubId={clubIdStr}
          tournament={editingTournament}
          allTables={allTables ?? []}
          assignedTableIds={assignedTableIds}
        />
      )}
    </div>
  );
}

// ─── Tournament Card ─────────────────────────────────────────────────────────

function TournamentCard({
  tournament,
  onEdit,
}: {
  tournament: TournamentWithTables;
  onEdit: () => void;
}) {
  const deleteMutation = useDeleteTournament();

  const handleDelete = async () => {
    if (!confirm(`Xóa tournament "${tournament.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({
        id: tournament.id,
        club_id: tournament.club_id,
      });
      toast.success("Đã xóa tournament");
    } catch {
      toast.error("Lỗi khi xóa tournament");
    }
  };

  const statusColors: Record<string, string> = {
    active: "bg-green-500/20 text-green-400",
    completed: "bg-zinc-500/20 text-zinc-400",
    cancelled: "bg-red-500/20 text-red-400",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{tournament.name}</CardTitle>
            {tournament.description && (
              <CardDescription>{tournament.description}</CardDescription>
            )}
          </div>
          <Badge className={statusColors[tournament.status] ?? ""}>
            {tournament.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 bg-muted rounded">
            <div className="text-2xl font-bold text-primary">
              {tournament.swing_duration_minutes}
            </div>
            <div className="text-xs text-muted-foreground">phút/swing</div>
          </div>
          <div className="p-2 bg-muted rounded">
            <div className="text-lg font-semibold text-yellow-500">
              {tournament.warn_at_minutes}
            </div>
            <div className="text-xs text-muted-foreground">warn</div>
          </div>
          <div className="p-2 bg-muted rounded">
            <div className="text-lg font-semibold text-red-500">
              {tournament.crit_at_minutes}
            </div>
            <div className="text-xs text-muted-foreground">crit</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Bàn ({tournament.tournament_tables.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {tournament.tournament_tables.map((tt) => (
              <Badge key={tt.table_id} variant="secondary" className="text-xs">
                {tt.game_tables?.name ?? tt.table_id.slice(0, 8)}
              </Badge>
            ))}
            {tournament.tournament_tables.length === 0 && (
              <span className="text-xs text-muted-foreground">Chưa có bàn nào</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onEdit}
          >
            Sửa
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-500 hover:text-red-400"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            Xóa
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tournament Dialog (Create / Edit) ───────────────────────────────────────

function TournamentDialog({
  open,
  onOpenChange,
  clubId,
  tournament,
  allTables,
  assignedTableIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  tournament?: TournamentWithTables;
  allTables: { id: string; table_name?: string; name?: string }[];
  assignedTableIds: Set<string>;
}) {
  const isEditing = !!tournament;
  const createMutation = useCreateTournament();
  const updateMutation = useUpdateTournament();

  const [name, setName] = useState(tournament?.name ?? "");
  const [description, setDescription] = useState(tournament?.description ?? "");
  const [swingDuration, setSwingDuration] = useState(
    tournament?.swing_duration_minutes ?? 45
  );
  const [warnAt, setWarnAt] = useState(tournament?.warn_at_minutes ?? 5);
  const [critAt, setCritAt] = useState(tournament?.crit_at_minutes ?? 2);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(
    tournament?.tournament_tables.map((tt) => tt.table_id) ?? []
  );

  const availableTables = allTables.filter(
    (t) => !assignedTableIds.has(t.id) || selectedTableIds.includes(t.id)
  );

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Vui lòng nhập tên tournament");
      return;
    }
    if (swingDuration < 5) {
      toast.error("Swing duration tối thiểu là 5 phút");
      return;
    }
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({
          id: tournament!.id,
          club_id: clubId,
          name,
          description: description || undefined,
          swing_duration_minutes: swingDuration,
          warn_at_minutes: warnAt,
          crit_at_minutes: critAt,
          table_ids: selectedTableIds,
        });
        toast.success("Đã cập nhật tournament");
      } else {
        await createMutation.mutateAsync({
          club_id: clubId,
          name,
          description: description || undefined,
          swing_duration_minutes: swingDuration,
          warn_at_minutes: warnAt,
          crit_at_minutes: critAt,
          table_ids: selectedTableIds,
        });
        toast.success("Đã tạo tournament");
      }
      onOpenChange(false);
    } catch {
      toast.error(isEditing ? "Lỗi khi cập nhật" : "Lỗi khi tạo");
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId]
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Sửa Tournament" : "Tạo Tournament"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Tên tournament</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Main Event, Turbo, Satellite..."
            />
          </div>

          <div>
            <label className="text-sm font-medium">Mô tả (tùy chọn)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú..."
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">Swing (phút)</label>
              <Input
                type="number"
                min={5}
                max={120}
                value={swingDuration}
                onChange={(e) => setSwingDuration(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Warn (phút)</label>
              <Input
                type="number"
                min={1}
                max={30}
                value={warnAt}
                onChange={(e) => setWarnAt(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Crit (phút)</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={critAt}
                onChange={(e) => setCritAt(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">
              Chọn bàn ({selectedTableIds.length} bàn)
            </label>
            <div className="mt-2 max-h-48 overflow-y-auto border rounded p-2 space-y-1">
              {availableTables.map((table) => (
                <label
                  key={table.id}
                  className="flex items-center gap-2 p-1 hover:bg-muted rounded cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTableIds.includes(table.id)}
                    onCheckedChange={() => toggleTable(table.id)}
                  />
                  <span className="text-sm">
                    {table.table_name ?? table.name ?? table.id.slice(0, 8)}
                  </span>
                </label>
              ))}
              {availableTables.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Tất cả bàn đã được gán vào tournament khác
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Hủy
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : isEditing ? "Cập nhật" : "Tạo"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
