import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

function safeNext(value: unknown): string {
  return typeof value === "string" && value.startsWith("/ops") ? value : "/ops";
}
export default function OpsLogin() {
  const { user, loading, signInWithPassword } = useOpsAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/ops" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const message = await signInWithPassword(email, password);
    setSubmitting(false);
    if (message) {
      setError("Không đăng nhập được. Kiểm tra email, mật khẩu và thử lại.");
      return;
    }
    const state = location.state as { from?: string } | null;
    navigate(safeNext(state?.from), { replace: true });
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#060b09] px-4 py-10 text-white">
      <Card className="w-full max-w-md border-emerald-300/15 bg-[#0d1512] text-white shadow-2xl shadow-black/30">
        <CardHeader className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/12 text-emerald-300">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-2xl">VinPoker Ops</CardTitle>
            <CardDescription className="mt-1 text-zinc-400">
              Đăng nhập workspace vận hành. Không dùng chung phiên trình duyệt với app người chơi.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="ops-email">Email</Label>
              <Input
                id="ops-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="min-h-11 bg-black/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ops-password">Mật khẩu</Label>
              <Input
                id="ops-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="min-h-11 bg-black/20"
              />
            </div>
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <Button className="min-h-11 w-full" type="submit" disabled={submitting || loading}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Đăng nhập Ops
            </Button>
            <button
              type="button"
              onClick={() => navigate("/ops/forgot-password")}
              className="min-h-11 w-full text-sm text-emerald-300 underline-offset-4 hover:underline"
            >
              Quên mật khẩu
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
