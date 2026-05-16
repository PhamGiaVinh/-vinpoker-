import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Upload, Trash2 } from "lucide-react";

type ParsedRow = {
  rank?: number;
  name: string;
  amount: number;
  matches: { user_id: string; display_name: string }[];
  selected: string | "skip";
};

const parseLine = (line: string): { rank?: number; name: string; amount: number } | null => {
  const cleaned = line.trim();
  if (!cleaned) return null;
  const rankMatch = cleaned.match(/^(\d{1,3})[.)\s]+(.*)$/);
  let rank: number | undefined;
  let rest = cleaned;
  if (rankMatch) {
    rank = parseInt(rankMatch[1], 10);
    rest = rankMatch[2];
  }
  const amountMatch = rest.match(/([\$₫]?\s*[\d.,]+)\s*[A-Za-z₫\$]*\s*$/);
  if (!amountMatch) return null;
  const rawAmount = amountMatch[1].replace(/[^\d]/g, "");
  if (!rawAmount) return null;
  const amount = parseInt(rawAmount, 10);
  const name = rest.slice(0, amountMatch.index).replace(/[—\-–|\t]+$/g, "").trim();
  if (!name) return null;
  return { rank, name, amount };
};

export const MoneyListManager = ({ currentUserId }: { currentUserId: string }) => {
  const [busy, setBusy] = useState(true);
  const [profiles, setProfiles] = useState<{ user_id: string; display_name: string }[]>([]);
  const [existing, setExisting] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setBusy(true);
    const [{ data: p }, { data: list }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name"),
      supabase.from("all_time_money_list").select("*").order("total_winnings", { ascending: false }),
    ]);
    setProfiles((p ?? []).filter((x: any) => x.display_name));
    setExisting(list ?? []);
    setBusy(false);
  };

  useEffect(() => { load(); }, []);

  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

  const profileIndex = useMemo(() => {
    const m: Record<string, { user_id: string; display_name: string }[]> = {};
    profiles.forEach((p) => {
      const k = norm(p.display_name);
      (m[k] ||= []).push(p);
    });
    return m;
  }, [profiles]);

  const handleParse = () => {
    const lines = text.split(/\r?\n/);
    const parsed: ParsedRow[] = [];
    for (const line of lines) {
      const r = parseLine(line);
      if (!r) continue;
      const matches = profileIndex[norm(r.name)] ?? [];
      parsed.push({
        ...r,
        matches,
        selected: matches.length === 1 ? matches[0].user_id : "skip",
      });
      if (parsed.length >= 100) break;
    }
    if (!parsed.length) {
      toast.error("Không có dòng hợp lệ. Format: `1. Tên 123,456`");
      return;
    }
    setRows(parsed);
    const matched = parsed.filter((r) => r.selected !== "skip").length;
    toast.success(`Đã phân tích ${parsed.length} dòng · ${matched} khớp tài khoản`);
  };

  const handleImport = async () => {
    if (!rows) return;
    const toInsert = rows.map((r) => ({
      player_id: r.selected && r.selected !== "skip" ? (r.selected as string) : null,
      display_name: r.name,
      total_winnings: r.amount,
      rank_source: r.rank ?? null,
      imported_by: currentUserId,
    }));
    if (!toInsert.length) {
      toast.error("Không có dữ liệu");
      return;
    }
    setImporting(true);
    const { error: delErr } = await supabase.from("all_time_money_list").delete().not("id", "is", null);
    if (delErr) { setImporting(false); return toast.error(delErr.message); }
    const { error: insErr } = await supabase.from("all_time_money_list").insert(toInsert);
    setImporting(false);
    if (insErr) return toast.error(insErr.message);
    const linked = toInsert.filter((r) => r.player_id).length;
    toast.success(`Đã import ${toInsert.length} player · ${linked} liên kết tài khoản`);
    setText("");
    setRows(null);
    load();
  };

  const handleClearAll = async () => {
    if (!confirm("Xoá toàn bộ All-Time Money List?")) return;
    const { error } = await supabase.from("all_time_money_list").delete().not("id", "is", null);
    if (error) toast.error(error.message);
    else { toast.success("Đã xoá"); load(); }
  };

  if (busy) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-semibold">1. Dán dữ liệu</div>
          <span className="text-[11px] text-muted-foreground">tối đa 100 dòng</span>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={`1. Nguyen Van A   1,234,567\n2. Tran Van B     980,000\n3 Le Van C $750000`}
          className="font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button onClick={handleParse} disabled={!text.trim()} size="sm" className="gradient-neon text-primary-foreground border-0">
            Phân tích
          </Button>
          {rows && <Button variant="ghost" size="sm" onClick={() => setRows(null)}>Reset</Button>}
        </div>
      </Card>

      {rows && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-semibold">2. Kiểm tra & khớp ({rows.length} dòng)</div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border/50 -mx-1">
            {rows.map((r, i) => (
              <div key={i} className="py-2 px-1 flex items-center gap-2 text-xs">
                <div className="w-6 text-muted-foreground font-mono">{r.rank ?? i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-muted-foreground">{r.amount.toLocaleString("vi-VN")}₫</div>
                </div>
                <div className="w-44">
                  {r.matches.length === 0 ? (
                    <span className="text-muted-foreground text-[11px]">Chỉ tên (chưa có acc)</span>
                  ) : (
                    <Select
                      value={r.selected}
                      onValueChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, selected: v as any } : x))}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">— Bỏ qua —</SelectItem>
                        {r.matches.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button onClick={handleImport} disabled={importing} size="sm" className="w-full gradient-neon text-primary-foreground border-0">
            {importing ? "Đang import..." : <><Upload className="w-4 h-4 mr-1.5" />Thay thế & Import</>}
          </Button>
        </Card>
      )}

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Danh sách hiện tại ({existing.length})</div>
          {existing.length > 0 && (
            <Button size="sm" variant="ghost" onClick={handleClearAll}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
        </div>
        {existing.length === 0 ? (
          <p className="text-xs text-muted-foreground">Trống.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-border/50 -mx-1">
            {existing.map((e, i) => (
              <div key={e.id} className="py-1.5 px-1 flex items-center gap-2 text-xs">
                <div className="w-6 text-muted-foreground font-mono">{i + 1}</div>
                <div className="flex-1 truncate">{e.display_name}</div>
                <div className="text-primary font-semibold">{Number(e.total_winnings).toLocaleString("vi-VN")}₫</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
