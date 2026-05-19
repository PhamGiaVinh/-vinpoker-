import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'

export interface CurrencyRates {
  usd: number
  cny: number
  krw: number
}

export function useCurrencyRates() {
  return useQuery({
    queryKey: ['currency-rates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'currency_rates')
        .single()

      if (error) throw error
      return (data?.value || { usd: 0, cny: 0, krw: 0 }) as CurrencyRates
    },
    staleTime: 5 * 60 * 1000,
  })
}
