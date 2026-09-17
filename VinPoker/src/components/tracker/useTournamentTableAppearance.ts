import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TABLE_APPEARANCE, type TableAppearance } from './tableAppearance';

export const tableAppearanceKey = (id: string) => ['tournament-table-appearance', id];
export function useTournamentTableAppearance(tournamentId: string) {
  return useQuery({
    queryKey: tableAppearanceKey(tournamentId), enabled: Boolean(tournamentId), staleTime: 30_000, refetchInterval: 30_000,
    queryFn: async (): Promise<TableAppearance> => {
      const { data, error } = await supabase.from('tournament_table_appearance' as never)
        .select('felt_color,rail_color,logo_url').eq('tournament_id', tournamentId).maybeSingle();
      if (error) throw error;
      const row = data as { felt_color: string; rail_color: string; logo_url: string | null } | null;
      return row ? { feltColor: row.felt_color, railColor: row.rail_color, logoUrl: row.logo_url } : DEFAULT_TABLE_APPEARANCE;
    },
  });
}
