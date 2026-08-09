import { createSeriesCopilotHandlerV1 } from "./handler.ts";

const handler = createSeriesCopilotHandlerV1({
  env: {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    geminiApiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
  },
});

Deno.serve(handler);
