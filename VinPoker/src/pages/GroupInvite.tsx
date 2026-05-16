import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Users, Globe, Lock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Preview {
  group_id: string | null;
  group_name: string | null;
  avatar_url: string | null;
  is_public: boolean | null;
  member_count: number;
  valid: boolean;
  reason: string;
}

const GroupInvite = () => {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(true);
  const [joining, setJoining] = useState(false);

  const reasonText = (r: string) =>
    t(`groupChat.invitePage.reasons.${r}`, { defaultValue: t("groupChat.invitePage.unavailable") });

  useEffect(() => {
    if (!token) return;
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("get_invite_preview", { _token: token });
      setBusy(false);
      if (error) { toast.error(error.message); return; }
      const row = Array.isArray(data) ? data[0] : data;
      setPreview(row as Preview | null);
    })();
  }, [token]);

  const join = async () => {
    if (!token) return;
    setJoining(true);
    const { data, error } = await supabase.rpc("accept_group_invite", { _token: token });
    setJoining(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("groupChat.invitePage.joined"));
    nav(`/group/${data}`);
  };

  if (authLoading || busy) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(`/invite/${token}`)}`} replace />;
  }

  if (!preview || preview.reason === "not_found") {
    return (
      <Card className="max-w-md mx-auto p-8 text-center border-destructive/40 mt-12">
        <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-2" />
        <p className="text-sm font-semibold">{t("groupChat.invitePage.invalid")}</p>
        <p className="text-xs text-muted-foreground mt-1">{reasonText("not_found")}</p>
        <Button asChild className="mt-4" size="sm"><Link to="/inbox">{t("groupChat.invitePage.backInbox")}</Link></Button>
      </Card>
    );
  }

  return (
    <Card className="max-w-md mx-auto p-8 text-center mt-12 space-y-4">
      <Avatar className="h-20 w-20 mx-auto">
        <AvatarImage src={preview.avatar_url ?? undefined} />
        <AvatarFallback className="bg-primary/20 text-primary"><Users className="w-7 h-7" /></AvatarFallback>
      </Avatar>
      <div>
        <h1 className="text-lg font-bold flex items-center justify-center gap-2">
          {preview.group_name ?? t("groupChat.invitePage.fallbackName")}
          {preview.is_public ? <Globe className="w-4 h-4 text-muted-foreground" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">{t("groupChat.invitePage.membersN", { n: preview.member_count })}</p>
      </div>
      {preview.valid ? (
        <Button onClick={join} disabled={joining} className="w-full">
          {joining ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Users className="w-4 h-4 mr-1" />}
          {t("groupChat.invitePage.joinBtn")}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-destructive flex items-center justify-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {reasonText(preview.reason)}
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/inbox">{t("groupChat.invitePage.backInbox")}</Link></Button>
        </div>
      )}
    </Card>
  );
};

export default GroupInvite;
