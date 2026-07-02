import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbLinkTargets } from "@/hooks/useFnbLinkTargets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, RefreshCw, Trash2, Copy, Printer } from "lucide-react";

type QrToken = { token_id: string; table_ref: string; table_name: string | null; label: string | null; token: string; created_at: string };

const guestUrl = (token: string) => `${window.location.origin}/fnb/order?t=${token}`;

/**
 * GQR admin "QR bàn" tab (owner-only). One QR per table. Generate / rotate / revoke / copy link /
 * print. Reads active tables via fnb_list_link_targets (any facet) + issued tokens via
 * fnb_list_table_qr_tokens (owner-only, returns plaintext). Gated by the parent on FEATURES.fnbGuestOrder.
 */
export function FnbTableQrManager({ clubId }: { clubId: string }) {
  const { data: linkTargets } = useFnbLinkTargets(clubId);
  const [tokens, setTokens] = useState<QrToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("fnb_list_table_qr_tokens", { p_club_id: clubId });
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); setLoading(false); return; }
    setTokens((res?.tokens ?? []) as QrToken[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const tables = linkTargets?.tables ?? [];
  const byTable = new Map(tokens.map((t) => [t.table_ref, t]));

  const issue = async (tableRef: string) => {
    setBusy(tableRef);
    const { data, error } = await (supabase.rpc as any)("fnb_issue_table_qr_token", { p_club_id: clubId, p_table_ref: tableRef, p_label: null });
    setBusy(null);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success("Đã tạo mã QR cho bàn.");
    load();
  };

  const revoke = async (t: QrToken) => {
    if (!confirm(`Thu hồi mã QR của ${t.table_name ?? "bàn"}? Mã cũ sẽ không dùng được nữa.`)) return;
    setBusy(t.token_id);
    const { data, error } = await (supabase.rpc as any)("fnb_revoke_table_qr_token", { p_token_id: t.token_id });
    setBusy(null);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success("Đã thu hồi mã.");
    load();
  };

  const copy = (t: QrToken) => { navigator.clipboard.writeText(guestUrl(t.token)); toast.success("Đã copy link."); };

  const print = (t: QrToken) => {
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) { toast.error("Trình duyệt chặn cửa sổ in — cho phép popup rồi thử lại."); return; }
    // Encode the URL into a QR via a public renderer isn't allowed (offline). Use the same on-screen
    // SVG: serialize the rendered node for this table into the print window.
    const svg = document.getElementById(`qr-${t.token_id}`)?.outerHTML ?? "";
    w.document.write(`<!doctype html><html><head><title>QR ${t.table_name ?? ""}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px}
      h1{font-size:28px;margin:8px 0}p{color:#555;margin:4px 0 20px}svg{width:280px;height:280px}</style>
      </head><body><h1>${t.table_name ?? "Bàn"}</h1><p>Quét mã để gọi món F&amp;B</p>${svg}
      <p style="margin-top:20px;font-size:12px">${guestUrl(t.token)}</p>
      <script>window.onload=function(){window.print();}<\/script></body></html>`);
    w.document.close();
  };

  if (loading) return <Card className="p-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải…</div></Card>;

  if (tables.length === 0) {
    return <Card className="p-5 text-sm text-muted-foreground">Chưa có bàn nào trong câu lạc bộ. Tạo bàn ở khu vực Sàn/Bàn trước.</Card>;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Mỗi bàn một mã QR. Khách quét → chọn ghế → gọi món. In mã dán lên bàn. Thu hồi/đổi mã bất cứ lúc nào.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tables.map((tbl) => {
          const t = byTable.get(tbl.id);
          return (
            <Card key={tbl.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{tbl.table_name}</div>
                {t ? <span className="text-[11px] text-success">● Đang bật</span> : <span className="text-[11px] text-muted-foreground">Chưa có mã</span>}
              </div>
              {t ? (
                <>
                  <div className="flex justify-center">
                    <div className="bg-white p-2 rounded-lg">
                      <QRCodeSVG id={`qr-${t.token_id}`} value={guestUrl(t.token)} size={132} level="M" marginSize={1} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => copy(t)}><Copy className="w-3.5 h-3.5 mr-1" /> Link</Button>
                    <Button size="sm" variant="outline" onClick={() => print(t)}><Printer className="w-3.5 h-3.5 mr-1" /> In</Button>
                    <Button size="sm" variant="outline" disabled={busy === tbl.id} onClick={() => issue(tbl.id)}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Đổi mã</Button>
                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={busy === t.token_id} onClick={() => revoke(t)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Thu hồi</Button>
                  </div>
                </>
              ) : (
                <Button className="w-full" disabled={busy === tbl.id} onClick={() => issue(tbl.id)}>
                  {busy === tbl.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <QrCode className="w-4 h-4 mr-1" />} Tạo mã QR
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
