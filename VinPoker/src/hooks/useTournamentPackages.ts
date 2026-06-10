import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'

export interface TournamentPackage {
  id: string
  name: string
  name_en: string
  description: string | null
  description_en: string | null
  price_vnd: number
  original_price_vnd: number | null
  early_bird_end: string | null
  max_participants: number | null
  registered_count: number
  benefits: { icon: string; label: string; label_en: string }[]
  image_url: string | null
  sort_order: number
  status: 'active' | 'inactive'
  created_at: string
  tournaments: { id: string; name: string }[]
}

export function useTournamentPackages() {
  return useQuery({
    queryKey: ['tournament-packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournament_packages')
        .select('*, tournaments:package_tournaments(tournament_id, tournaments(id, name))')
        .eq('status', 'active')
        .order('sort_order', { ascending: true })

      if (error) throw error

      return (data || []).map((pkg: any) => ({
        ...pkg,
        tournaments: (pkg.tournaments || []).map((pt: any) => pt.tournaments).filter(Boolean),
      })) as unknown as TournamentPackage[]
    },
  })
}

export function useTournamentPackage(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament-package', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournament_packages')
        .select('*, tournaments:package_tournaments(tournament_id, tournaments(id, name))')
        .eq('id', id)
        .single()

      if (error) throw error

      return {
        ...data,
        tournaments: (data.tournaments || []).map((pt: any) => pt.tournaments).filter(Boolean),
      } as unknown as TournamentPackage
    },
  })
}
