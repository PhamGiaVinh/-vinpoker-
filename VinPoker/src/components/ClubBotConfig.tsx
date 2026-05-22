import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Bot, ImagePlus, Loader2, Save, Trash2, Send, HelpCircle } from "lucide-react";

const DEFAULT_MSG =
  "Đây là mã QR thanh toán phí tập huấn bên CLB, anh/chị thanh toán xong vui lòng gửi lại hình ảnh thanh toán thành công!";

export const ClubBotConfig = ({ club, onSaved }: { club: any; onSaved?: () => void }) => {
  const [enabled, setEnabled] = useState<boolean>(!!club?.bot_enabled);
  const [qrUrl, setQrUrl] = useState<string>(club?.bot_qr_url ?? "");
  const [msg, setMsg] = useState<string>(club?.bot_welcome_message ?? DEFAULT_MSG);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEnabled(!!club?.bot_enabled);
    setQrUrl(club?.bot_qr_url ?? "");
    setMsg(club?.bot_welcome_message ?? DEFAULT_MSG);
    // Load telegram chat ID from club_settings
    (async () => {
      if (!club?.id) return;
      const { data } = await supabase
        .from("club_settings")
        .select("telegram_chat_id")
        .eq("club_id", club.id)
        .maybeSingle();
      setTelegramChatId((data as any)?.telegram_chat_id ?? "");
    })();
  }, [club?.id]);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Chỉ nhận ảnh");
    if (file.size > 5 * 1024 * 1024) return toast.error("Ảnh tối đa 5MB");
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `club-bot/${club.id}/qr-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-uploads").upload(path, file, { upsert: true });
    if (error) {
      setUploading(false);
      return toast.error(error.message);
    }
    const { data: pub } = supabase.storage.from("chat-uploads").getPublicUrl(path);
    setQrUrl(pub.publicUrl);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    toast.success("Đã tải ảnh QR");
  };

  const save = async () => {
    setSaving(true);
    const { error: e1 } = await supabase
      .from("clubs")
      .update({
        bot_enabled: enabled,
        bot_qr_url: qrUrl || null,
        bot_welcome_message: msg.trim() || DEFAULT_MSG,
      })
      .eq("id", club.id);
    if (e1) { setSaving(false); return toast.error(e1.message); }

    // Upsert telegram chat ID into club_settings
    const { error: e2 } = await supabase
      .from("club_settings")
      .upsert({ club_id: club.id, telegram_chat_id: telegramChatId.trim() || null }, { onConflict: "club_id" });
    if (e2) { setSaving(false); return toast.error(e2.message); }

    setSaving(false);
    toast.success("Đã lưu cấu hình");
    onSaved?.();
  };

  return (
    <Card className="p-4 gradient-card border-primary/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <h3 className="font-display text-primary">Chatbot tự động</h3>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="bot-toggle" className="text-xs text-muted-foreground">
            {enabled ? "Đang bật" : "Đang tắt"}
          </Label>
          <Switch id="bot-toggle" checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Khi player tạo chat đặt stack, bot sẽ tự gửi mã QR + lời chào. Lễ tân chỉ cần check ảnh chuyển khoản và bấm xác nhận.
      </p>

      <div className="space-y-2">
        <Label className="text-xs">Ảnh QR thanh toán</Label>
        {qrUrl ? (
          <div className="relative inline-block">
            <img src={qrUrl} alt="QR thanh toán CLB" className="rounded-lg max-h-48 border border-border" />
            <Button
              size="icon"
              variant="destructive"
              className="absolute -top-2 -right-2 h-7 w-7"
              onClick={() => setQrUrl("")}
              title="Xoá ảnh QR"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">Chưa có ảnh QR.</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-1" />}
          {qrUrl ? "Đổi ảnh QR" : "Tải ảnh QR"}
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Lời chào của bot</Label>
        <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} />
      </div>

      <div className="space-y-2 border-t border-border pt-3 mt-2">
        <div className="flex items-center gap-1">
          <Send className="w-3.5 h-3.5 text-primary" />
          <Label className="text-xs">Telegram Chat ID</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64 text-xs">
                Nhập Chat ID của group Telegram để nhận thông báo swing. 
                Thêm bot @VBACKERBOT vào group, gửi /id để lấy Chat ID.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder="-100xxxxxxxxxx"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Bot sẽ gửi thông báo đổi ca, hết giờ nghỉ, và cảnh báo thiếu dealer vào group này.
        </p>
      </div>

      <Button onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
        <Save className="w-4 h-4 mr-1" />
        {saving ? "Đang lưu..." : "Lưu cấu hình"}
      </Button>
    </Card>
  );
};

export default ClubBotConfig;
