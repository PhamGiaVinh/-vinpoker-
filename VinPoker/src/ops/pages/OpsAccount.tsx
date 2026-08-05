import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { Link } from "react-router-dom";
import { clearInvitePasswordSetupRequired } from "@/ops/auth/opsInviteCompletion";

function maskedId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}

export default function OpsAccount() {
  const client = useSupabaseClient();
  const { user, signOutLocal } = useOpsAuth();
  const capabilities = useOpsCapabilities();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const resetMode = params.get("mode") === "reset-password";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setMessage("Mật khẩu cần ít nhất 8 ký tự.");
      return;
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setMessage("Không cập nhật được mật khẩu.");
      return;
    }
    setPassword("");
    clearInvitePasswordSetupRequired();
    setMessage("Đã cập nhật mật khẩu Ops. Đang mở workspace…");
    window.setTimeout(() => navigate("/ops", { replace: true }), 700);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
          VinPoker Ops
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Tài khoản vận hành
        </h1>
      </header>

      <Card className="border-white/10 bg-white/[0.035] text-white">
        <CardHeader>
          <CardTitle className="text-lg">
            {user?.email ?? "Tài khoản Ops"}
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Phiên này độc lập với app người chơi trên cùng thiết bị.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {capabilities.scope.map((row) => (
            <div
              key={row.club_id}
              className="rounded-xl border border-white/8 bg-black/20 p-3"
            >
              <div className="font-medium text-white">
                {capabilities.clubs.find((club) => club.id === row.club_id)
                  ?.name ?? `CLB ${maskedId(row.club_id)}`}
              </div>
              <div className="mt-1 text-zinc-400">
                {[
                  row.can_owner && "Owner",
                  row.can_floor && "Floor",
                  row.can_cashier && "Cashier",
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
          {capabilities.metadataError && (
            <p className="text-amber-300">{capabilities.metadataError}</p>
          )}
        </CardContent>
      </Card>

      {resetMode && (
        <Card className="border-amber-300/20 bg-amber-300/5 text-white">
          <CardHeader>
            <CardTitle className="text-lg">Đặt mật khẩu mới</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={updatePassword} className="space-y-3">
              <Label htmlFor="ops-new-password">Mật khẩu mới</Label>
              <Input
                id="ops-new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-h-11 bg-black/20"
              />
              {message && <p className="text-sm text-zinc-300">{message}</p>}
              <Button type="submit" className="min-h-11">
                Cập nhật mật khẩu
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {capabilities.hasOwnerAccess && (
        <Button asChild className="min-h-11 w-full">
          <Link to="/ops/club-admin/accounts">Quản lý tài khoản CLB</Link>
        </Button>
      )}

      <Button
        variant="outline"
        className="min-h-11 w-full border-white/10 bg-transparent text-white"
        onClick={() => {
          void signOutLocal().then(setSignOutError);
        }}
      >
        Đăng xuất riêng phiên Ops
      </Button>
      {signOutError && <p className="text-sm text-rose-300">{signOutError}</p>}
    </div>
  );
}
