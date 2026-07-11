import { useState } from "react";
import { KeyRound, Link2, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStaffRedeemCode } from "@/hooks/staff/useStaffRedeemCode";

/**
 * Shown in the /staff portal when the signed-in account is not yet bound to a staff row.
 * Self-link path: the owner/accountant generates a one-time invite code (staff_generate_link_code)
 * and gives it to the staff; here the staff redeems it themselves (staff_redeem_link_code binds
 * auth.uid()). On success the redeem hook invalidates the staff link query and the portal re-reads
 * as linked. Falls back to the manual owner-link note if code redemption isn't available yet.
 */
export function StaffNotLinkedScreen() {
  const [code, setCode] = useState("");
  const redeem = useStaffRedeemCode();
  const trimmed = code.trim();

  const submit = () => {
    if (trimmed.length < 6 || redeem.isPending) return;
    redeem.mutate(trimmed);
  };

  return (
    <Card className="p-5 border-border text-center space-y-4">
      <span className="mx-auto grid place-items-center w-12 h-12 rounded-xl bg-muted text-muted-foreground">
        <UserRoundCheck className="w-6 h-6" />
      </span>
      <div>
        <h1 className="text-base font-bold text-foreground">Chưa liên kết hồ sơ nhân viên</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Tài khoản này chưa gắn với hồ sơ nhân viên của CLB. Nếu chủ CLB / kế toán đã đưa bạn{" "}
          <span className="font-bold text-foreground">mã mời</span>, hãy nhập bên dưới để tự liên kết.
        </p>
      </div>

      <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-3 text-left space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-bold text-foreground">
          <KeyRound className="w-4 h-4 text-primary" />
          Nhập mã mời
        </div>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="VD: 3F9A2C7B10E4"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            className="font-mono tracking-[0.15em] text-center"
          />
          <Button onClick={submit} disabled={trimmed.length < 6 || redeem.isPending} className="shrink-0">
            {redeem.isPending ? "Đang liên kết…" : "Liên kết"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Mã 12 ký tự, dùng 1 lần. Không có mã? Hỏi chủ CLB / kế toán.</p>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-left text-[12px] text-muted-foreground">
        <div className="flex items-center gap-2 font-bold text-foreground mb-1">
          <Link2 className="w-3.5 h-3.5 text-primary" />
          Cách khác
        </div>
        Chủ CLB / kế toán cũng có thể gán trực tiếp tài khoản của bạn trong màn "Nhân viên & lương".
      </div>
    </Card>
  );
}
