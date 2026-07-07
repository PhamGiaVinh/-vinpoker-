// trackerSeatSetup — pre-hand "Set up table roster". A TRACKER/FLOOR operator sets each
// seat's NAME + CHIP + optional AVATAR, and adds a walk-in to an empty seat. ALL writes
// go through the ONE atomic RPC `set_tracker_table_roster_seat` (via hook.handleSetRosterSeat)
// which guards tracker/floor/owner/super_admin and writes seat + tournament_chip_counts in
// one transaction — no client dual-write. Avatar image is uploaded to the tournament-photos
// bucket first (compress → getPublicUrl), then its URL is passed to the RPC.
//
// Hosted in SetupHandPanel's `chipEditor` slot (mounts only !handStarted && !orphanHand),
// so "pre-hand only" is structural. Flag OFF → this panel never mounts (host renders the
// old ChipQuickEditPanel), byte-identical.
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, UserPlus, ImagePlus, Check, X } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import { formatStack } from "./format";

export type RosterSeat = {
  player_id: string;
  seat_number: number;
  display_name: string;
  current_stack: number;
  avatar_url?: string | null;
};

interface SeatSetupPanelProps {
  tournamentId: string;
  tableId: string;
  players: RosterSeat[];
  /** Physical seat capacity → drives the "add to empty seat N" affordances. */
  maxSeats: number;
  /** tournament_seats.avatar_url exists (migration applied). False → avatar disabled. */
  avatarSupported: boolean;
  disabled?: boolean;
  /** The one atomic RPC write (name + chip + optional avatar). */
  onSetSeat: (args: {
    seatNumber: number;
    playerName: string;
    chipCount: number;
    existingPlayerId?: string | null;
    touchAvatar?: boolean;
    avatarUrl?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * B1 mid-hand mode. When true a hand is in progress: chips + add + delete are locked
   * (a mid-hand chip write can't survive the start_hand snapshot), but NAME + AVATAR
   * stay editable via the display-only RPC below so a typo doesn't force a void.
   */
  handInProgress?: boolean;
  /** Display-only write (name + optional avatar), used when handInProgress. */
  onSetSeatDisplay?: (args: {
    seatNumber: number;
    playerName: string;
    touchAvatar?: boolean;
    avatarUrl?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
}

type Draft = { name: string; chip: number };

export function SeatSetupPanel({
  tournamentId,
  tableId,
  players,
  maxSeats,
  avatarSupported,
  disabled,
  onSetSeat,
  handInProgress,
  onSetSeatDisplay,
}: SeatSetupPanelProps) {
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", chip: 0 });
  const [saving, setSaving] = useState(false);
  const [uploadingSeat, setUploadingSeat] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarTargetRef = useRef<RosterSeat | null>(null);

  const bySeat = useMemo(() => new Map(players.map((p) => [p.seat_number, p])), [players]);
  const emptySeats = useMemo(
    () => Array.from({ length: Math.max(0, maxSeats) }, (_, i) => i + 1).filter((n) => !bySeat.has(n)),
    [maxSeats, bySeat]
  );

  const openEdit = (p: RosterSeat) => {
    setOpenSeat(p.seat_number);
    setDraft({ name: p.display_name, chip: p.current_stack });
  };
  const openAdd = (seatNumber: number) => {
    setOpenSeat(seatNumber);
    setDraft({ name: "", chip: 0 });
  };
  const cancel = () => setOpenSeat(null);

  const save = async (seatNumber: number, existing?: RosterSeat) => {
    const name = draft.name.trim();
    if (name.length < 1 || name.length > 40) {
      toast.error("Tên phải 1–40 ký tự");
      return;
    }
    // Mid-hand: chips are locked → route to the display-only RPC (name, keep chip).
    if (handInProgress) {
      if (!onSetSeatDisplay) return;
      setSaving(true);
      try {
        const res = await onSetSeatDisplay({ seatNumber, playerName: name });
        if (res.ok) {
          toast.success(`Đã sửa tên ghế ${seatNumber} · ${name}`);
          setOpenSeat(null);
        }
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!Number.isFinite(draft.chip) || draft.chip < 0) {
      toast.error("Số chip không hợp lệ");
      return;
    }
    setSaving(true);
    try {
      const res = await onSetSeat({
        seatNumber,
        playerName: name,
        chipCount: Math.floor(draft.chip),
        existingPlayerId: existing?.player_id ?? null,
      });
      if (res.ok) {
        toast.success(`Đã lưu ghế ${seatNumber} · ${name}`);
        setOpenSeat(null);
      }
      // errors already toasted by the hook (incl. actor_not_authorized / hand_in_progress).
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = (seat: RosterSeat) => {
    if (!avatarSupported) return;
    avatarTargetRef.current = seat;
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    const seat = avatarTargetRef.current;
    if (!raw || !seat) return;
    setUploadingSeat(seat.seat_number);
    try {
      // Compress (canvas re-encode also strips EXIF) → upload to the tournament-photos
      // seat-avatars path (RLS: floor/media/owner + tracker via the new policy).
      const file = await compressImage(raw, { maxEdge: 800, quality: 0.85 });
      const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const path = `${tournamentId}/seat-avatars/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("tournament-photos")
        .upload(path, file, { contentType: file.type, cacheControl: "3600" });
      if (upErr) {
        toast.error(upErr.message || "Không tải được ảnh (cần quyền tracker/floor)");
        return;
      }
      const { data: pub } = supabase.storage.from("tournament-photos").getPublicUrl(path);
      const res =
        handInProgress && onSetSeatDisplay
          ? await onSetSeatDisplay({
              seatNumber: seat.seat_number,
              playerName: seat.display_name,
              touchAvatar: true,
              avatarUrl: pub.publicUrl,
            })
          : await onSetSeat({
              seatNumber: seat.seat_number,
              playerName: seat.display_name,
              chipCount: seat.current_stack,
              existingPlayerId: seat.player_id,
              touchAvatar: true,
              avatarUrl: pub.publicUrl,
            });
      if (res.ok) toast.success(`Đã cập nhật ảnh ghế ${seat.seat_number}`);
    } catch (err: any) {
      toast.error(err?.message || "Lỗi tải ảnh");
    } finally {
      setUploadingSeat(null);
      avatarTargetRef.current = null;
    }
  };

  const clearAvatar = async (seat: RosterSeat) => {
    const res =
      handInProgress && onSetSeatDisplay
        ? await onSetSeatDisplay({
            seatNumber: seat.seat_number,
            playerName: seat.display_name,
            touchAvatar: true,
            avatarUrl: null,
          })
        : await onSetSeat({
            seatNumber: seat.seat_number,
            playerName: seat.display_name,
            chipCount: seat.current_stack,
            existingPlayerId: seat.player_id,
            touchAvatar: true,
            avatarUrl: null,
          });
    if (res.ok) toast.success("Đã xoá ảnh");
  };

  const editForm = (seatNumber: number, existing?: RosterSeat) => (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-border/20 px-2 py-2">
      <Input
        aria-label="Tên người chơi"
        className="h-9 w-36 text-sm"
        placeholder="Tên"
        maxLength={40}
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />
      <Input
        aria-label="Số chip"
        type="number"
        min={0}
        disabled={handInProgress}
        title={handInProgress ? "Đang có ván — chỉ sửa được tên/ảnh" : undefined}
        className="h-9 w-28 font-mono text-sm disabled:opacity-40"
        placeholder="Chip"
        value={draft.chip}
        onChange={(e) => setDraft((d) => ({ ...d, chip: Number(e.target.value) }))}
      />
      <Button size="sm" className="h-9" disabled={saving || disabled} onClick={() => save(seatNumber, existing)}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
      <button type="button" onClick={cancel} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-1.5 rounded-xl border border-border/50 bg-card/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <UserPlus className="h-3.5 w-3.5" />
        {handInProgress ? "Sửa tên · ảnh — đang có ván" : "Setup bàn (tên · chip · ảnh) — trước khi bắt đầu"}
      </div>
      {handInProgress && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          Đang có ván — chỉ sửa được tên/ảnh. Sửa chip sau khi kết thúc ván.
        </div>
      )}
      {!avatarSupported && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          Ảnh avatar: tính năng chưa được áp dụng trên máy chủ — tên + chip vẫn dùng được.
        </div>
      )}

      <div className="space-y-1">
        {players.map((p) => {
          const isOpen = openSeat === p.seat_number;
          const uploading = uploadingSeat === p.seat_number;
          return (
            <div key={p.player_id} className="rounded-lg border border-border/30 bg-card/60">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                {/* avatar thumbnail */}
                <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border/50 bg-muted text-[9px] font-bold">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    p.display_name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate">
                  Ghế {p.seat_number} · {p.display_name}
                </span>
                <span className="font-mono text-muted-foreground">{formatStack(p.current_stack)}</span>
                {/* avatar upload/clear */}
                <button
                  type="button"
                  aria-label={`Ảnh ghế ${p.seat_number}`}
                  title={avatarSupported ? "Tải ảnh" : "Chưa áp dụng"}
                  disabled={disabled || !avatarSupported || uploading}
                  onClick={() => pickAvatar(p)}
                  className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                </button>
                {p.avatar_url && avatarSupported && (
                  <button
                    type="button"
                    aria-label={`Xoá ảnh ghế ${p.seat_number}`}
                    disabled={disabled}
                    onClick={() => clearAvatar(p)}
                    className="rounded p-1.5 text-muted-foreground hover:text-rose-300 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => openEdit(p)}>
                  Sửa
                </Button>
              </div>
              {isOpen && editForm(p.seat_number, p)}
            </div>
          );
        })}
      </div>

      {!handInProgress && emptySeats.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {emptySeats.map((n) => {
            const isOpen = openSeat === n;
            return (
              <div key={`empty-${n}`} className="rounded-lg border border-dashed border-border/40 bg-card/40">
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1">Ghế {n} · trống</span>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => openAdd(n)}>
                    <UserPlus className="mr-1 h-3 w-3" /> Thêm người
                  </Button>
                </div>
                {isOpen && editForm(n)}
              </div>
            );
          })}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
