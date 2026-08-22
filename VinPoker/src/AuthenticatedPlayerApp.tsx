import App from "@/App";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { supabase } from "@/integrations/supabase/client";

export default function AuthenticatedPlayerApp() {
  return (
    <SupabaseClientProvider client={supabase}>
      <App />
    </SupabaseClientProvider>
  );
}
