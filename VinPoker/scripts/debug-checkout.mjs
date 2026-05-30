import pg from "pg";
const SUPABASE_URL = "https://orlesggcjamwuknxwcpk.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.uCdDhiYxyK8EdP2LAlQ3vVN0lRImBEcXRkX3PNBg2T0";
const CLUB_ID = "11111111-1111-1111-1111-111111111111";

const p = new pg.Pool({
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  port: 5432,
  user: "cli_login_postgres.orlesggcjamwuknxwcpk",
  password: "zjnjTbHbdDeTlNQLOMEAhRDQGHNLvvlJ",
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // Find an available attendance for club 1
  const r = await p.query(
    "SELECT da.id FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE da.current_state = 'available' AND da.status = 'checked_in' AND d.club_id = $1 LIMIT 1",
    [CLUB_ID]
  );
  console.log("Found attendance ID:", r.rows[0]?.id);

  if (r.rows[0]) {
    // Call checkout-dealer
    const resp = await fetch(SUPABASE_URL + "/functions/v1/checkout-dealer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ANON_KEY,
      },
      body: JSON.stringify({ attendance_id: r.rows[0].id }),
    });
    console.log("HTTP Status:", resp.status);
    console.log("Response:", (await resp.text()).substring(0, 800));
  }

  // Also test process-swing dry_run
  const resp2 = await fetch(SUPABASE_URL + "/functions/v1/process-swing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + ANON_KEY,
    },
    body: JSON.stringify({ club_id: CLUB_ID, dry_run: true }),
  });
  console.log("\n--- process-swing ---");
  console.log("HTTP Status:", resp2.status);
  console.log("Response:", (await resp2.text()).substring(0, 800));

  await p.end();
}

main().catch(console.error);
