import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const body = await req.json()
  const { tournament_id, action } = body

  if (!tournament_id || !action) {
    return new Response(JSON.stringify({ error: 'Missing tournament_id or action' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  let result: any

  try {
    switch (action) {
      case 'get_seats': {
        result = await supabase.rpc('get_seats_for_draw', { p_tournament_id: tournament_id })
        break
      }
      case 'update_seats': {
        const { seats } = body
        const { data: upsertData, error: upsertError } = await supabase.from('tournament_seats').upsert(
          seats.map((seat: any) => ({
            tournament_id,
            player_id: seat.player_id,
            entry_number: seat.entry_number || 1,
            table_id: seat.table_id,
            seat_number: seat.seat_number,
            chip_count: seat.chip_count || 0,
            is_active: seat.is_active !== false
          })),
          { onConflict: 'tournament_id,player_id' }
        )
        if (upsertError) throw upsertError
        result = { data: { updated: seats.length } }
        break
      }
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (result.error) {
      throw result.error
    }

    return new Response(JSON.stringify({ status: 'success', data: result.data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
