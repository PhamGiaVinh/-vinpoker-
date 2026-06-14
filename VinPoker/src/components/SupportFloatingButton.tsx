import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LifeBuoy, Send, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Cat = "technical" | "financial" | "account" | "other";

export const SupportFloatingButton = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [supportId, setSupportId] = useState<string | null>(null);
  const [category, setCategory] = useState<Cat>("technical");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("app_settings").select("value").eq("key", "support_user_id").maybeSingle()
      .then(({ data }) => {
        const v = (data?.value as any);
        if (typeof v === "string") setSupportId(v);
      });
  }, [open]);

  if (!user) return null;

  const openChat = () => {
    if (!supportId) return toast.error(t("support.supportNotConfigured"));
    if (supportId === user.id) return toast.error(t("support.youAreSupport"));
    setOpen(false);
    nav(`/dm/${supportId}`);
  };

  const submitTicket = async () => {
    if (content.trim().length < 5) return toast.error(t("support.contentTooShort"));
    setBusy(true);
    const { error } = await supabase.from("support_tickets").insert({
      user_id: user.id,
      category,
      subject: subject.trim() || null,
      content: content.trim(),
      ticket_ref: ticketRef.trim() || null,
    });
    if (!error && supportId && supportId !== user.id) {
      // Send a chat ping to support
      const [a, b] = [user.id, supportId].sort();
      let { data: ex } = await supabase.from("direct_chats").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
      if (!ex) {
        const { data: created } = await supabase.from("direct_chats").insert({ user_a: a, user_b: b }).select("id").single();
        ex = created;
      }
      if (ex) {
        await supabase.from("direct_messages").insert({
          chat_id: ex.id,
          sender_id: user.id,
          content: `🎫 [${category.toUpperCase()}] ${subject || t("support.defaultSubject")}${ticketRef ? ` (Mã: ${ticketRef})` : ""}\n\n${content}\n\n${t("support.responseWithin24h")}`,
        });
      }
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("support.ticketSent"));
    setSubject(""); setContent(""); setTicketRef("");
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="relative px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/60 text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors"
          title={t("support.triggerTitle")}
          aria-label={t("support.centerAriaLabel")}
        >
          <LifeBuoy className="w-4 h-4" />
        </button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><LifeBuoy className="w-5 h-5 text-primary" /> {t("support.centerTitle")}</SheetTitle>
          <SheetDescription>{t("support.centerDescription")}</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="ticket" className="mt-4 flex-1 flex flex-col">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="ticket">{t("support.tabSubmitTicket")}</TabsTrigger>
            <TabsTrigger value="chat">{t("support.tabChatSupport")}</TabsTrigger>
          </TabsList>

          <TabsContent value="ticket" className="space-y-3 mt-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("support.labelCategory")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as Cat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="technical">{t("support.catTechnical")}</SelectItem>
                  <SelectItem value="financial">{t("support.catFinancial")}</SelectItem>
                  <SelectItem value="account">{t("support.catAccount")}</SelectItem>
                  <SelectItem value="other">{t("support.catOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("support.labelSubject")}</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("support.labelTicketRef")}</Label>
              <Input value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("support.labelContent")}</Label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={2000} placeholder={t("support.contentPlaceholder")} />
            </div>
            <Button onClick={submitTicket} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {t("support.submitButton")}
            </Button>
          </TabsContent>

          <TabsContent value="chat" className="space-y-3 mt-4">
            <p className="text-sm text-muted-foreground">{t("support.chatIntroBefore")} <b className="text-foreground">VBacker Support</b>. {t("support.chatIntroAfter")}</p>
            <Button onClick={openChat} className="w-full gradient-gold text-primary-foreground border-0">
              <MessageCircle className="w-4 h-4 mr-2" /> {t("support.openChatButton")}
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};
