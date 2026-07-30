import { LockKeyhole, UserRound } from "lucide-react";
import type { TrackerRosterSeatV2 } from "@/lib/tracker-unified-ops/contracts";

const CHIP_FORMATTER = new Intl.NumberFormat("vi-VN");

export function TrackerReadOnlyRoster({
  roster,
}: {
  roster: readonly TrackerRosterSeatV2[];
}) {
  const seats = Array.from({ length: 9 }, (_, index) => index + 1);

  return (
    <section
      aria-label="Roster chỉ đọc từ Floor"
      className="overflow-hidden rounded-[26px] border border-white/10 bg-[#100d12]/90"
      data-testid="tracker-readonly-roster"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d7b66f]">
            Roster từ Floor
          </p>
          <p className="mt-1 text-sm text-[#a99fa6]">
            Tracker chỉ đọc, không xếp ghế hoặc sửa stack.
          </p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs text-[#c7bcc3]">
          <LockKeyhole className="h-3.5 w-3.5" />
          Chỉ đọc
        </span>
      </div>

      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2">
        {seats.map((seatNumber) => {
          const seat = roster.find((item) => item.seat_number === seatNumber);
          return (
            <div
              key={seatNumber}
              className="min-h-[74px] bg-[#100d12] px-3.5 py-3"
            >
              {seat ? (
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[#d7b66f]/35 bg-[#2a2026] text-sm font-bold text-[#f2d899]">
                    {seat.avatar_url ? (
                      <img
                        src={seat.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      seat.display_name.slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-[#d7b66f]/12 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#d7b66f]">
                        GHẾ {seatNumber}
                      </span>
                      <span className="truncate text-sm font-semibold text-[#f4eee5]">
                        {seat.display_name}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-emerald-300">
                      {CHIP_FORMATTER.format(seat.seat_stack)} chip
                      <span className="ml-2 text-[#8f848b]">
                        Entry #{seat.entry_number}
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center gap-3 text-[#716970]">
                  <div className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/10">
                    <UserRound className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-mono text-[10px] font-bold">GHẾ {seatNumber}</span>
                    <p className="mt-0.5 text-xs">Trống</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
