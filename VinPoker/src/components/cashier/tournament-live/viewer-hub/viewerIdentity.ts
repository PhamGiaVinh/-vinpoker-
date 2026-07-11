export interface ViewerIdentitySource {
  playerId: string;
  seatNumber: number;
  snapshotName?: string | null;
  snapshotAvatarUrl?: string | null;
  seatName?: string | null;
  seatAvatarUrl?: string | null;
  profileName?: string | null;
  profileAvatarUrl?: string | null;
}

export interface ViewerIdentity {
  name: string;
  avatarUrl: string | null;
}

export function isOpaqueViewerName(value: string | null | undefined, playerId?: string): boolean {
  const name = value?.trim() ?? "";
  if (!name) return true;
  if (/^(seat|ghế)\s*0$/i.test(name) || /^#0$/.test(name)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(name) || /^[a-f0-9]{6}$/i.test(name)) return true;
  return !!playerId && (name === playerId || name.toLowerCase() === playerId.slice(0, 6).toLowerCase());
}

/** Public identity order: hand snapshot -> any tournament seat -> profile -> neutral seat label. */
export function resolveViewerIdentity(source: ViewerIdentitySource): ViewerIdentity {
  const names = [source.snapshotName, source.seatName, source.profileName];
  const name = names.find((candidate) => !isOpaqueViewerName(candidate, source.playerId))?.trim()
    ?? (source.seatNumber > 0 ? `Người chơi ghế ${source.seatNumber}` : "Người chơi");

  return {
    name,
    avatarUrl: source.snapshotAvatarUrl
      ?? source.seatAvatarUrl
      ?? source.profileAvatarUrl
      ?? null,
  };
}
