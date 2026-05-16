import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

type ClubRow = { id: string; name: string };

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club";

export default function ClubCardQrTab({ clubs }: { clubs: ClubRow[] }) {
  if (clubs.length === 0) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Chưa có CLB nào.</Card>;
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        In QR này lên thẻ thành viên hoặc dán tại quầy. Cashier quét để lọc nhanh deal theo CLB.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((c) => <ClubQrCard key={c.id} club={c} />)}
      </div>
    </div>
  );
}

function ClubQrCard({ club }: { club: ClubRow }) {
  const ref = useRef<HTMLDivElement>(null);
  const url = `https://vinpoker.live/cashier/scan?club_id=${club.id}`;

  const download = () => {
    const canvas = ref.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) { toast.error("Không tạo được ảnh"); return; }
    const link = document.createElement("a");
    link.download = `vinpoker-${slugify(club.name)}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <Card className="p-4 flex flex-col items-center gap-3">
      <div className="text-sm font-semibold text-center line-clamp-2">{club.name}</div>
      <div ref={ref} className="bg-white p-3 rounded-lg">
        <QRCodeCanvas value={url} size={1024} level="H" includeMargin={false} style={{ width: 200, height: 200 }} />
      </div>
      <div className="text-[10px] font-mono text-muted-foreground break-all text-center">{url}</div>
      <Button variant="outline" size="sm" onClick={download} className="w-full">
        <Download className="w-4 h-4" /> Tải PNG (1024px)
      </Button>
    </Card>
  );
}
