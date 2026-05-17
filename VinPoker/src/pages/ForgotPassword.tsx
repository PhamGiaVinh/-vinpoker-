import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const ForgotPassword = () => {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const r = z.string().trim().email("Email không hợp lệ").max(255).safeParse(email);
    if (!r.success) return toast.error(r.error.errors[0].message);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(r.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSent(true);
    toast.success("Vui lòng kiểm tra email để đặt lại mật khẩu");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h1 className="font-display text-xl">Quên mật khẩu</h1>
        </div>
        {sent ? (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>Đã gửi liên kết đặt lại mật khẩu tới <b className="text-foreground">{email}</b>.</p>
            <p>Kiểm tra cả hộp thư Spam nếu bạn không thấy email trong vài phút tới. Liên kết hết hạn sau 1 giờ.</p>
            <Button variant="outline" className="w-full" onClick={() => nav("/auth")}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Quay lại đăng nhập
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Nhập email tài khoản, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.</p>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@email.com" />
            </div>
            <Button onClick={submit} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Gửi liên kết đặt lại mật khẩu
            </Button>
            <Link to="/auth" className="block text-xs text-center text-muted-foreground hover:text-foreground">
              ← Quay lại đăng nhập
            </Link>
          </>
        )}
      </Card>
    </div>
  );
};

export default ForgotPassword;
