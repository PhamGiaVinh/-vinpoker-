import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

export default function OpsForgotPassword() {
  const client = useSupabaseClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/ops/auth/callback?next=${encodeURIComponent("/ops/account?mode=reset-password")}`,
    });
    setBusy(false);
    // Do not reveal whether an email exists.
    setSent(true);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 py-10 text-white">
      <Card className="w-full max-w-md border-white/10 bg-[#0d1512] text-white">
        <CardHeader>
          <CardTitle>Khôi phục tài khoản Ops</CardTitle>
          <CardDescription className="text-zinc-400">
            Link đặt lại mật khẩu sẽ quay về đúng phiên Ops.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-300">Nếu email hợp lệ, hướng dẫn đã được gửi.</p>
              <Button asChild className="min-h-11 w-full"><Link to="/ops/login">Về đăng nhập</Link></Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="ops-recovery-email">Email</Label>
                <Input
                  id="ops-recovery-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="min-h-11 bg-black/20"
                />
              </div>
              <Button className="min-h-11 w-full" type="submit" disabled={busy}>Gửi link khôi phục</Button>
              <Button asChild variant="ghost" className="min-h-11 w-full"><Link to="/ops/login">Huỷ</Link></Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
