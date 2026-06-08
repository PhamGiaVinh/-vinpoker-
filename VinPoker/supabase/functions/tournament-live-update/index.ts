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
      case 'record_hand': {
        const { table_id, hand_number, hand_time, players, actions, side_pots, community_cards, pot_size } = body
        result = await supabase.rpc('record_hand', {
          p_tournament_id: tournament_id,
          p_table_id: table_id,
          p_hand_number: hand_number,
          p_hand_time: hand_time,
          p_players: players,
          p_actions: actions,
          p_side_pots: side_pots || '[]',
          p_community_cards: community_cards || '[]',
          p_pot_size: pot_size || 0
        })
        break
      }
      case 'void_hand': {
        const { hand_id } = body
        result = await supabase.rpc('void_last_hand', {
          p_hand_id: hand_id
        })
        break
      }
      case 'update_stack': {
        const { player_id, entry_number, chip_count } = body
        result = await supabase.rpc('update_stack', {
          p_tournament_id: tournament_id,
          p_player_id: player_id,
          p_entry_number: entry_number,
          p_chip_count: chip_count
        })
        break
      }
      case 'bulk_update': {
        const { updates } = body
        result = await supabase.rpc('bulk_update_stacks', {
          p_tournament_id: tournament_id,
          p_updates: updates
        })
        break
      }
      case 're_enter': {
        const { player_id, new_chip_count } = body
        result = await supabase.rpc('re_enter_tournament', {
          p_tournament_id: tournament_id,
          p_player_id: player_id,
          p_new_chip_count: new_chip_count || 0
        })
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
