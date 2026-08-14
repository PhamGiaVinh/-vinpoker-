export type PublicStreamRow = {
  id: string;
  platform: "youtube" | "facebook";
  stream_url: string;
  title: string | null;
  match_title: string | null;
  scheduled_at: string | null;
  thumbnail_url: string | null;
  custom_tournament_name: string | null;
  is_live: boolean;
  tournament_id: string | null;
};

type TournamentMetadataRow = {
  id: string;
  name: string;
  start_time: string;
  club_id: string;
};

type ClubMetadataRow = {
  id: string;
  name: string;
};

export type PublicStreamItem = Omit<PublicStreamRow, "tournament_id"> & {
  tournament: {
    id: string;
    name: string;
    start_time: string;
    club: { name: string } | null;
  } | null;
};

/**
 * Keep the stream read independent from PostgREST's embedded relationship cache.
 * A missing relation must not make an otherwise public stream disappear.
 */
export function attachLivestreamMetadata(
  streams: PublicStreamRow[],
  tournaments: TournamentMetadataRow[],
  clubs: ClubMetadataRow[],
): PublicStreamItem[] {
  const tournamentsById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  const clubsById = new Map(clubs.map((club) => [club.id, club]));

  return streams.map(({ tournament_id, ...stream }) => {
    const tournament = tournament_id ? tournamentsById.get(tournament_id) : undefined;
    if (!tournament) return { ...stream, tournament: null };

    const club = clubsById.get(tournament.club_id);
    return {
      ...stream,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        start_time: tournament.start_time,
        club: club ? { name: club.name } : null,
      },
    };
  });
}
