import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

const ResetPassword = () => {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase auto-creates a recovery session when redirected with the token in URL hash.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    if (pw.length < 8) return toast.error("Mật khẩu tối thiểu 8 ký tự");
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return toast.error("Mật khẩu phải có cả chữ và số");
    if (pw !== pw2) return toast.error("Hai mật khẩu không khớp");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Đặt lại mật khẩu thành công");
    await supabase.auth.signOut();
    nav("/auth");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          <h1 className="font-display text-xl">Đặt lại mật khẩu</h1>
        </div>
        {!ready ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Đang xác minh liên kết…
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Mật khẩu mới (≥ 8 ký tự, gồm chữ và số)</Label>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Xác nhận mật khẩu</Label>
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <Button onClick={submit} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Đặt lại mật khẩu
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default ResetPassword;
