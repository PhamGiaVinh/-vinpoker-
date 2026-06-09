import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "./supabase/functions/_shared/pickNextDealer.ts";

const SUPABASE_URL = "https://orlesggcjamwuknxwcpk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A";

const admin = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testPickNextDealer() {
  console.log("Testing pickNextDealer...");
  const dealer = await pickNextDealer(admin, "22222222-2222-2222-2222-222222222222", {
    currentTableId: "5ad8867f-576e-409f-aeb6-bb8e3a713d90",
    excludeAttendanceIds: new Set(),
    minInterSwingRestMinutes: 10,
  });
  console.log("Result:", dealer);
}

testPickNextDealer();
