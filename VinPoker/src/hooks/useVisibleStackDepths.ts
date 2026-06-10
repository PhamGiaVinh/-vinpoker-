import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STACK_DEPTHS, type StackDepth } from "@/lib/gto/rangeTree";

const KEY = "visible_stack_depths";
const DEFAULT: StackDepth[] = [50];

let cache: StackDepth[] | null = null;
const subs = new Set<(v: StackDepth[]) => void>();
let inited = false;

function setCache(v: StackDepth[]) {
  cache = v;
  subs.forEach((cb) => cb(v));
}

async function init() {
  if (inited) return;
  inited = true;
  try {
    const { data } = await supabase
      .from("gto_app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const val = (data?.value as any) as StackDepth[] | null;
    if (Array.isArray(val) && val.length) setCache(val);
    else setCache(DEFAULT);
  } catch {
    setCache(DEFAULT);
  }
  supabase
    .channel("gto_app_settings_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "gto_app_settings", filter: `key=eq.${KEY}` },
      (payload) => {
        const v = (payload.new as any)?.value;
        if (Array.isArray(v)) setCache(v as StackDepth[]);
      },
    )
    .subscribe();
}

export function useVisibleStackDepths() {
  const [depths, setDepths] = useState<StackDepth[]>(cache ?? DEFAULT);

  useEffect(() => {
    init();
    const cb = (v: StackDepth[]) => setDepths(v);
    subs.add(cb);
    if (cache) setDepths(cache);
    return () => {
      subs.delete(cb);
    };
  }, []);

  const save = useCallback(async (next: StackDepth[]) => {
    const sorted = [...new Set(next)].sort((a, b) => a - b) as StackDepth[];
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("gto_app_settings")
      .upsert(
        { key: KEY, value: sorted as any, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw error;
    setCache(sorted);
  }, []);

  return { depths, save, allDepths: STACK_DEPTHS as readonly StackDepth[] };
}
