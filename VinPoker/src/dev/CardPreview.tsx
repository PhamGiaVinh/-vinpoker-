import MemberCardPreview from "@/components/cashier/MemberCardPreview";
import MemberCardBackPreview from "@/components/cashier/MemberCardBackPreview";

/**
 * DEV-ONLY visual harness for the member-card design (cashier → Cấp lại thẻ). Fixture-rendered — no
 * Supabase. Reached only at /__dev/card; DEV-gated in App.tsx so the route + chunk are stripped from
 * the production build. Lets us screenshot the CR80 front/back without a cashier login.
 */
export default function CardPreview() {
  const front = {
    clubName: "Hanoi Royal Poker",
    clubLogoUrl: null,
    fullName: "Nguyễn Văn A",
    memberCardId: "VB-260707-A3F291",
    reissueCode: "R-20260707-0421",
    issuedAt: new Date(2026, 6, 7),
  };
  const back = {
    clubName: "Hanoi Royal Poker",
    clubLogoUrl: null,
    rules: [
      "Xuất trình thẻ khi vào CLB.",
      "Không cho mượn hoặc chuyển nhượng thẻ.",
      "Báo mất trong 24h để được cấp lại.",
      "Tuân thủ nội quy và hướng dẫn của CLB.",
    ],
    hotline: "0909 000 000",
    address: "123 Nguyễn Huệ, Q.1, TP.HCM",
  };
  return (
    <div className="min-h-screen grid place-items-center gap-6 bg-[#07050A] p-8">
      <div className="text-center text-sm text-[#9b8e97]">Member card — mặt trước / mặt sau (CR80 85.6×54mm)</div>
      <MemberCardPreview data={front} />
      <MemberCardBackPreview data={back} />
    </div>
  );
}
