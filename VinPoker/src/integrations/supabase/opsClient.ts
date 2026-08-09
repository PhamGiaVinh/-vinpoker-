import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { opsAuthStorageKey } from "@/integrations/supabase/opsClientConfig";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Ops authentication configuration is unavailable.");
}

export const opsClient = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storageKey: opsAuthStorageKey(supabaseUrl),
    persistSession: true,
    autoRefreshToken: true,
    // OpsAuthCallback is the sole PKCE/OTP callback owner. Letting auth-js
    // auto-detect the URL would race the explicit code exchange.
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});
