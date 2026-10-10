import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/** Shared emergency OFF control: must remain available when operational reads fail. */
export function DealerSwingStopControl({ clubId, onStopped }: { clubId: string | null; onStopped: () => void }) {
  const { user } = useAuth();
  const scopeKey = JSON.stringify([user?.id ?? null, clubId]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const lifetime = useRef({ active: false, generation: 0 });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    const mountedLifetime = lifetime.current;
    mountedLifetime.active = true;
    mountedLifetime.generation += 1;
    return () => { mountedLifetime.active = false; mountedLifetime.generation += 1; };
  }, []);
  useEffect(() => {
    setOpen(false);
    setSaving(false);
    savingRef.current = false;
  }, [scopeKey]);
  const stop = async () => {
    if (!clubId || !user?.id || savingRef.current) return;
    const scope = scopeRef.current;
    const generation = lifetime.current.generation;
    const isCurrent = () => lifetime.current.active && lifetime.current.generation === generation && scopeRef.current === scope;
    savingRef.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.from("club_settings")
        .upsert({ club_id: clubId, auto_swing_enabled: false }, { onConflict: "club_id" });
      if (!isCurrent()) return;
      if (error) { toast.error(error.message); return; }
      onStopped();
      setOpen(false);
      toast.success("Đã tắt Auto-Swing");
    } catch {
      if (isCurrent()) toast.error("Không xác minh được trạng thái Swing. Hãy tải lại trước khi thao tác tiếp.");
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  return <>
    <button disabled={!clubId || !user?.id || saving} onClick={() => setOpen(true)}
      className="text-xs text-destructive hover:text-destructive/80 px-2 py-1" title="Dừng toàn bộ Swing">⏹ Dừng Swing</button>
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dừng toàn bộ Swing</AlertDialogTitle>
          <AlertDialogDescription>Thao tác này đặt Auto-Swing về OFF. Bạn có chắc chắn muốn dừng?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Huỷ</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive text-destructive-foreground"
            onClick={(event) => { event.preventDefault(); void stop(); }} disabled={saving}>
            {saving ? "Đang dừng..." : "Dừng"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
