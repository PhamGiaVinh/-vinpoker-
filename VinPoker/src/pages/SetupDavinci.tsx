import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

const SUPER_EMAIL = "davinci2205@pokervn.com";

const SetupDavinci = () => {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (m: string) => setLog(l => [...l, m]);

  useEffect(() => { append("Ready to create/sign in Super Admin account: " + SUPER_EMAIL); }, []);

  const run = async () => {
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true); setLog([]);
    append("→ Trying to sign in...");
    let { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email: SUPER_EMAIL, password,
    });
    if (signInErr) {
      append("Account does not exist or password is incorrect — trying to create it...");
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: SUPER_EMAIL, password,
        options: { emailRedirectTo: `${window.location.origin}/admin`, data: { display_name: "Davinci" } },
      });
      if (signUpErr) {
        append("✗ " + signUpErr.message);
        setBusy(false); return;
      }
      append("✓ Account created. Database trigger grants Super Admin automatically.");
      // Try sign in again (in case email confirmation disabled)
      const r = await supabase.auth.signInWithPassword({ email: SUPER_EMAIL, password });
      signIn = r.data;
      if (r.error) {
        append("⚠ Email confirmation is required before signing in. Check inbox for " + SUPER_EMAIL);
        setBusy(false); return;
      }
    } else {
      append("✓ Signed in successfully.");
    }

    const uid = signIn?.user?.id;
    if (!uid) { append("✗ Could not get user id"); setBusy(false); return; }

    // Verify role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    const isSuper = (roles ?? []).some((r: any) => r.role === "super_admin");
    if (!isSuper) {
      append("⚠ This account does not have the Super Admin role in the database.");
      append("  → handle_new_user only runs when creating a new user. Contact a database admin to grant the role.");
      setBusy(false); return;
    }
    append("✓ Super Admin role verified. Redirecting...");
    setBusy(false);
    setTimeout(() => nav("/admin"), 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-gold" />
          <h1 className="font-display text-xl text-gold">Bootstrap Super Admin</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Create / sign in account <span className="text-gold">{SUPER_EMAIL}</span> and go straight to the admin page.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Password</Label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </div>
        <Button onClick={run} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run Bootstrap"}
        </Button>
        {log.length > 0 && (
          <div className="text-xs space-y-0.5 bg-background/50 rounded p-2 font-mono max-h-48 overflow-auto">
            {log.map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
          </div>
        )}
      </Card>
    </div>
  );
};

export default SetupDavinci;
