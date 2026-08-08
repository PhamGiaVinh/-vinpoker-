import type { ComponentType } from "react";
import { Clock3, LayoutGrid, MoreHorizontal, Trophy, UsersRound } from "lucide-react";

export type FloorTournamentSection = "tables" | "players" | "clock" | "payout" | "screens";

export type FloorTournamentSectionDefinition = {
  id: FloorTournamentSection;
  label: string;
  mobileLabel: string;
  icon: ComponentType<{ className?: string }>;
};

export const FLOOR_TOURNAMENT_SECTIONS: readonly FloorTournamentSectionDefinition[] = [
  { id: "tables", label: "Bàn", mobileLabel: "Bàn", icon: LayoutGrid },
  { id: "players", label: "Người chơi", mobileLabel: "Người chơi", icon: UsersRound },
  { id: "clock", label: "Đồng hồ & blinds", mobileLabel: "Đồng hồ", icon: Clock3 },
  { id: "payout", label: "Trả thưởng", mobileLabel: "Trả thưởng", icon: Trophy },
  { id: "screens", label: "TV & màn hình", mobileLabel: "Thêm", icon: MoreHorizontal },
] as const;
