import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export const DuplicateNameGuard = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentName, setCurrentName] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase
        .from("profiles")
        .select("display_name, display_name_lower, created_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!me || !me.display_name_lower || cancelled) return;
      const { data: dups } = await supabase
        .from("profiles")
        .select("user_id, created_at")
        .eq("display_name_lower", me.display_name_lower)
        .neq("user_id", user.id)
        .limit(1);
      if (cancelled) return;
      if (dups && dups.length > 0) {
        const otherCreated = new Date(dups[0].created_at).getTime();
        const myCreated = new Date(me.created_at).getTime();
        if (myCreated >= otherCreated) {
          setCurrentName(me.display_name ?? "");
          setNewName("");
          setOpen(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  const submit = async () => {
    const dn = newName.trim();
    if (dn.length < 2) return toast.error(t("duplicateName.min2"));
    if (dn.length > 50) return toast.error(t("duplicateName.max50"));
    if (dn.toLowerCase() === currentName.trim().toLowerCase())
      return toast.error(t("duplicateName.mustDiffer"));
    setSaving(true);
    const { data: dup } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("display_name_lower", dn.toLowerCase())
      .neq("user_id", user!.id)
      .maybeSingle();
    if (dup) {
      setSaving(false);
      return toast.error(t("duplicateName.taken", { name: dn }));
    }
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: dn })
      .eq("user_id", user!.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("duplicateName.changedOk"));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* not dismissible */ }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="w-5 h-5" /> {t("duplicateName.title")}
          </DialogTitle>
          <DialogDescription>
            {t("duplicateName.desc", { name: currentName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          <Label>{t("duplicateName.newLabel")}</Label>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={50}
            placeholder={t("duplicateName.newPh")}
          />
          <Button onClick={submit} disabled={saving} className="w-full gradient-gold text-primary-foreground border-0">
            {saving ? t("duplicateName.saving") : t("duplicateName.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
