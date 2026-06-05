import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Save, Copy, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { RangeTreeProvider, useRangeTree } from "@/hooks/useRangeTree";
import {
  makeSpotKey,
  saveCustomRange,
  saveUserRange,
  clearUserRange,
  initUserRanges,
} from "@/lib/gto/precomputed";
import { copyRangeToClipboard, pasteRangeFromClipboard } from "@/lib/gto/rangeClipboard";
import ActionBar from "./ActionBar";
import RangeMatrix from "./RangeMatrix";
import RangeBreakdownPanel from "./RangeBreakdownPanel";
import StackDepthSelector from "./StackDepthSelector";

function Inner({ personalMode }: { personalMode: boolean }) {
  const { state, currentRange, isGtoMode, resetNode, setCurrentRange } = useRangeTree();
  const { isAdmin, user } = useAuth();
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    if (personalMode) initUserRanges();
  }, [personalMode, user?.id]);

  const raiseCount = state.actionPath.filter(
    (s) => s.action === "raise" || s.action === "allin",
  ).length;
  const spotType =
    state.actionPath.length === 0
      ? "OPEN"
      : raiseCount === 1
      ? "VS_3B"
      : raiseCount === 2
      ? "VS_4B"
      : "VS_ALLIN";
  const spotKey = makeSpotKey(state.viewingPosition, spotType, state.stackDepth);

  const handleSaveAdmin = async () => {
    setBusy("save");
    try {
      await saveCustomRange(spotKey, currentRange);
      resetNode();
      toast.success(`Đã lưu ${spotKey}`, { description: "Range đã sync realtime cho mọi user." });
    } catch (err: any) {
      toast.error("Lưu thất bại", { description: err?.message ?? String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleSavePersonal = async () => {
    if (!user) {
      toast.error("Bạn cần đăng nhập để lưu range cá nhân");
      return;
    }
    setBusy("save");
    try {
      await saveUserRange(spotKey, currentRange);
      resetNode();
      toast.success(`Đã lưu range cá nhân`, { description: spotKey });
    } catch (err: any) {
      toast.error("Lưu thất bại", { description: err?.message ?? String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleResetPersonal = async () => {
    setBusy("reset");
    try {
      await clearUserRange(spotKey);
      resetNode();
      toast.success("Đã reset về range mặc định");
    } catch (err: any) {
      toast.error("Reset thất bại", { description: err?.message ?? String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    await copyRangeToClipboard(currentRange, spotKey);
    toast.success("Đã copy range", { description: `${spotKey} → clipboard` });
  };

  const handlePaste = async () => {
    const r = await pasteRangeFromClipboard();
    if (!r || Object.keys(r).length === 0) {
      toast.error("Clipboard rỗng", { description: "Hãy Copy 1 range trước khi paste." });
      return;
    }
    setCurrentRange(r);
    toast.success("Đã paste range", {
      description: `${spotKey} (chưa lưu — bấm Save để áp dụng)`,
    });
  };

  const showAdminSave = !personalMode && isAdmin;
  const showPersonalSave = personalMode && !!user;

  return (
    <div className="space-y-4">
      <Card className="p-3 bg-card/60 border-border/60">
        <StackDepthSelector />
      </Card>

      <ActionBar />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <Card className="p-3 space-y-2 bg-card/60 border-border/60">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              Viewing: <span className="text-primary">{state.viewingPosition}</span>
              <span className="text-muted-foreground text-xs">· {state.stackDepth}bb</span>
              <Badge
                variant={isGtoMode ? "default" : "secondary"}
                className="text-[10px] h-5"
              >
                {personalMode ? "Personal" : isGtoMode ? "GTO" : "Custom"}
              </Badge>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleCopy} className="h-7">
                <Copy className="w-3.5 h-3.5 mr-1" />
                Copy
              </Button>
              {(isAdmin || personalMode) && (
                <Button size="sm" variant="outline" onClick={handlePaste} className="h-7">
                  <ClipboardPaste className="w-3.5 h-3.5 mr-1" />
                  Paste
                </Button>
              )}
            </div>

            {showAdminSave && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveAdmin} disabled={busy !== null} className="h-7">
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {busy === "save" ? "Đang lưu…" : "Save range"}
                </Button>
              </div>
            )}

            {showPersonalSave && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSavePersonal} disabled={busy !== null} className="h-7">
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {busy === "save" ? "Đang lưu…" : "Lưu range của tôi"}
                </Button>
              </div>
            )}
          </div>

          <div
            className="mx-auto w-full"
            style={{ maxWidth: "min(100%, calc(100vh - 280px))" }}
          >
            <RangeMatrix range={currentRange} editable={personalMode || isAdmin} />
          </div>

          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gto-allin inline-block" />Allin</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gto-raise inline-block" />Raise</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gto-call inline-block" />Call</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gto-fold inline-block" />Fold</span>
          </div>
          {personalMode && (
            <div className="text-[10px] text-muted-foreground pt-1">
              💡 Click vào ô để toggle Raise ↔ Fold. Bấm <b>Lưu range của tôi</b> để chỉ lưu cho tài khoản của bạn.
            </div>
          )}
        </Card>

        <Card className="p-3 bg-card/60 border-border/60">
          <RangeBreakdownPanel range={currentRange} />
        </Card>
      </div>
    </div>
  );
}

function GTOOpenRangeView({ personalMode = false }: { personalMode?: boolean } = {}) {
  return (
    <RangeTreeProvider personalMode={personalMode}>
      <Inner personalMode={personalMode} />
    </RangeTreeProvider>
  );
}
