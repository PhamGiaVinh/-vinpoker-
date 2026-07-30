export const FLOOR_WORKSPACE_TABS = [
  { key: "tables", label: "Bàn", mobileLabel: "Bàn" },
  { key: "players", label: "Người chơi", mobileLabel: "Người chơi" },
  { key: "clock", label: "Đồng hồ & Blind", mobileLabel: "Đồng hồ" },
  { key: "payout", label: "Trả thưởng", mobileLabel: "Trả thưởng" },
  { key: "screens", label: "Màn hình TV", mobileLabel: "Thêm" },
] as const;

export type FloorWorkspaceTab = (typeof FLOOR_WORKSPACE_TABS)[number]["key"];

export function floorTournamentPath(
  tournamentId: string,
  tab: FloorWorkspaceTab = "tables",
): string {
  return `/ops/floor/tournaments/${tournamentId}/${tab}`;
}

export function floorWorkspaceParentPath(): string {
  return "/ops/floor";
}
