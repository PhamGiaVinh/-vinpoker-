export function trackerFloorAlertLink(alert: {
  tournament_id: string;
  physical_table_id: string;
  hand_id: string | null;
}): string {
  const params = new URLSearchParams({
    tournament: alert.tournament_id,
    table: alert.physical_table_id,
  });
  if (alert.hand_id) params.set("handId", alert.hand_id);
  return `/tracker/hand-input?${params.toString()}`;
}
