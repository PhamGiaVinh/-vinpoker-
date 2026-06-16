#!/usr/bin/env node
// Read-only verification: confirm get_club_finance_summary v3 is live + show ACTUAL collected
// rake / service fee / staking fees per club. SELECT-only. Secrets masked. No creds → exit 0.
const log = (...a) => console.log("[verify]", ...a);
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { log("no credentials — exiting safely."); process.exit(0); }

async function sql(label, q) {
  let res;
  try { res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); }
  catch (e) { log(`${label}: network ${mask(e.message)}`); return; }
  const text = await res.text();
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(text).slice(0, 500)}`); return; }
  log(`── ${label} ──`); console.log(mask(text).slice(0, 5000));
}

// 1) Confirm v3 is the LIVE function body (emits serviceFee + subtracts service_fee_amount from rakeActual).
await sql("v3 RPC live?", `
select
  position('serviceFee' in pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure)) > 0 as emits_serviceFee,
  position('- coalesce(t.service_fee_amount' in pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure)) > 0 as rakeactual_subtracts_service;`);

// 2) ACTUAL collected per club (confirmed registrations): rake collected (rake-only), service collected,
//    configured rake, configured service, entry count. This is the real "rake đã thu" answer.
await sql("tournament rake/service collected per club (confirmed regs)", `
select t.club_id,
  count(*) as confirmed_entries,
  sum(greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0) - coalesce(t.service_fee_amount,0)))::bigint as rake_collected,
  sum(coalesce(t.service_fee_amount,0))::bigint as service_collected_configured,
  sum(coalesce(t.rake_amount,0))::bigint as rake_configured,
  sum(greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0)))::bigint as total_fee_collected
from public.tournament_registrations tr
join public.tournaments t on t.id = tr.tournament_id
where tr.status = 'confirmed'
group by t.club_id
order by rake_collected desc
limit 10;`);

// 3) Staking fees collected per club (for the same owner-finance streams).
await sql("staking fees per club", `
select d.club_id,
  sum(case when d.player_checked_in then coalesce(d.platform_fixed_fee,0) else 0 end)::bigint as staking_fixed,
  sum(case when d.player_checked_in then coalesce(d.platform_percent_fee,0) else 0 end)::bigint as staking_percent,
  sum(case when d.status='completed' and coalesce(d.result_prize_vnd,0) > 0 then least(coalesce(d.platform_archive_fee,199000), d.result_prize_vnd) else 0 end)::bigint as staking_archive
from public.staking_deals d
group by d.club_id
order by staking_fixed desc
limit 10;`);

log("done (read-only).");
