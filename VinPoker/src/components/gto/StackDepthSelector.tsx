import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STACK_DEPTHS, type StackDepth } from "@/lib/gto/rangeTree";
import { useRangeTree } from "@/hooks/useRangeTree";
import { useAuth } from "@/hooks/useAuth";
import { useVisibleStackDepths } from "@/hooks/useVisibleStackDepths";
import { Eye, EyeOff, Settings2 } from "lucide-react";
import { toast } from "sonner";

function StackDepthSelector() {
  const { state, setStackDepth, resetAll } = useRangeTree();
  const { isAdmin } = useAuth();
  const { depths: visible, save } = useVisibleStackDepths();
  const [editMode, setEditMode] = useState(false);

  // Với user thường: chỉ render những depth được super admin bật
  const shown = isAdmin && editMode ? STACK_DEPTHS : STACK_DEPTHS.filter((d) => visible.includes(d));

  // Nếu depth hiện tại bị admin ẩn → tự chuyển về depth visible đầu tiên
  if (!isAdmin && shown.length > 0 && !shown.includes(state.stackDepth)) {
    setTimeout(() => setStackDepth(shown[0]), 0);
  }

  const toggleVisible = async (d: StackDepth) => {
    const next = visible.includes(d) ? visible.filter((x) => x !== d) : [...visible, d];
    if (next.length === 0) {
      toast.error("Phải để ít nhất 1 stack depth visible cho user");
      return;
    }
    try {
      await save(next);
      toast.success(`Đã ${visible.includes(d) ? "ẩn" : "hiện"} ${d}bb với user`);
    } catch (err: any) {
      toast.error("Lưu thất bại", { description: err?.message ?? String(err) });
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-muted-foreground">Stack:</span>
      <div className="flex items-center gap-1 flex-wrap">
        {shown.map((d) => {
          const isHidden = !visible.includes(d);
          const isSelected = state.stackDepth === d;
          return (
            <div key={d} className="flex items-center gap-0.5">
              <Button
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                onClick={() => {
                  if (isSelected) return;
                  if (
                    state.actionPath.length > 0 &&
                    !confirm("Changing stack depth will reset the action path. Continue?")
                  ) {
                    return;
                  }
                  setStackDepth(d);
                }}
                className={cn(
                  "h-7 px-2 text-xs",
                  isSelected && "ring-2 ring-primary",
                  isAdmin && isHidden && "opacity-50",
                )}
                title={isAdmin && isHidden ? "Đang ẩn với user" : undefined}
              >
                {d}bb
                {isAdmin && isHidden && <EyeOff className="w-3 h-3 ml-1 opacity-70" />}
              </Button>
              {isAdmin && editMode && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleVisible(d)}
                  className="h-7 w-7 p-0"
                  title={isHidden ? "Hiện với user" : "Ẩn với user"}
                >
                  {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <Button
          type="button"
          size="sm"
          variant={editMode ? "secondary" : "ghost"}
          onClick={() => setEditMode((v) => !v)}
          className="h-7 px-2 text-xs"
        >
          <Settings2 className="w-3.5 h-3.5 mr-1" />
          {editMode ? "Done" : "Manage visibility"}
        </Button>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          if (confirm("Reset all custom ranges?")) resetAll();
        }}
        className="h-7 px-2 text-xs text-muted-foreground"
      >
        Reset All
      </Button>
    </div>
  );
}
