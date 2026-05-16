import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, MessageCircle, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type Ticket = {
  id: string;
  user_id: string;
  category: string;
  subject: string | null;
  content: string;
  ticket_ref: string | null;
  status: "pending" | "in_progress" | "resolved";
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  profile?: { display_name: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xử lý",
  in_progress: "Đang xử lý",
  resolved: "Đã giải quyết",
};

export const AdminSupportTab = () => {
  const [tab, setTab] = useState<"pending" | "in_progress" | "resolved">("pending");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setBusy(true);
    const { data } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("status", tab)
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = Array.from(new Set((data ?? []).map((x) => x.user_id)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      pmap = Object.fromEntries((profs ?? []).map((p) => [p.user_id, p]));
    }
    setTickets((data ?? []).map((t: any) => ({ ...t, profile: pmap[t.user_id] })));
    setBusy(false);
  };

  useEffect(() => { load(); }, [tab]);

  const updateStatus = async (id: string, status: Ticket["status"]) => {
    const patch: any = { status };
    if (status === "resolved") {
      patch.resolved_at = new Date().toISOString();
      if (notes[id]?.trim()) patch.resolution_note = notes[id].trim();
    }
    const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cập nhật trạng thái");
    load();
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <LifeBuoy className="w-5 h-5 text-primary" />
        <h2 className="font-semibold">Hỗ trợ & Khiếu nại</h2>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Chờ xử lý</TabsTrigger>
          <TabsTrigger value="in_progress">Đang xử lý</TabsTrigger>
          <TabsTrigger value="resolved">Đã giải quyết</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-3">
          {busy ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Không có ticket.</p>
          ) : tickets.map((t) => (
            <Card key={t.id} className="p-3 space-y-2 bg-muted/30">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] uppercase">{t.category}</Badge>
                    {t.ticket_ref && <Badge variant="secondary" className="text-[10px]">Mã: {t.ticket_ref}</Badge>}
                    <Badge className="text-[10px]">{STATUS_LABEL[t.status]}</Badge>
                  </div>
                  <div className="font-semibold mt-1 truncate">{t.subject || "(Không tiêu đề)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.profile?.display_name || "User"} · {formatDateTime(t.created_at)}
                  </div>
                </div>
                <Link to={`/dm/${t.user_id}`}>
                  <Button size="sm" variant="outline"><MessageCircle className="w-4 h-4 mr-1" /> Chat</Button>
                </Link>
              </div>

              <p className="text-sm whitespace-pre-wrap bg-background rounded-md p-2 border border-border/50">{t.content}</p>

              {t.status !== "resolved" && (
                <div className="space-y-2">
                  {t.status === "in_progress" && (
                    <Textarea
                      placeholder="Ghi chú giải quyết (tùy chọn)…"
                      value={notes[t.id] ?? ""}
                      onChange={(e) => setNotes((m) => ({ ...m, [t.id]: e.target.value }))}
                      rows={2}
                    />
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {t.status === "pending" && (
                      <Button size="sm" onClick={() => updateStatus(t.id, "in_progress")}>Bắt đầu xử lý</Button>
                    )}
                    {t.status === "in_progress" && (
                      <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90"
                        onClick={() => updateStatus(t.id, "resolved")}>Đánh dấu đã giải quyết</Button>
                    )}
                  </div>
                </div>
              )}

              {t.status === "resolved" && t.resolution_note && (
                <div className="text-xs text-muted-foreground italic">Ghi chú: {t.resolution_note}</div>
              )}
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </Card>
  );
};
