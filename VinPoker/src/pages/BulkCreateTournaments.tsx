import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, ImagePlus, Wand2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

type Status = "pending" | "processing" | "done" | "error";

interface ParsedTour {
  tempId: string;
  name: string;
  start_time: string; // ISO
  buy_in: number;
  starting_stack: number;
  game_type: "nlh" | "plo" | "mixed";
  venue?: string | null;
  club_id: string;
  selected: boolean;
  source_image: string;
}

interface UploadedImage {
  id: string;
  file: File;
  url: string;
  status: Status;
  error?: string;
  count: number;
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.split(",")[1] || "");
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const toLocalInputValue = (iso: string) => {
  // Convert ISO to "yyyy-MM-ddTHH:mm" in local TZ for <input type=datetime-local>
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
};

export default function BulkCreateTournaments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [parsed, setParsed] = useState<ParsedTour[]>([]);
  const [defaultClubId, setDefaultClubId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = roles?.some((r: any) => r.role === "super_admin");
      if (!isAdmin) { toast.error(t("bulkCreate.adminOnly")); navigate("/"); return; }
      setAuthChecked(true);
      const { data: cs } = await supabase.from("clubs").select("id,name").eq("status", "approved").order("name");
      setClubs(cs ?? []);
      if (cs && cs.length === 1) setDefaultClubId(cs[0].id);
    })();
  }, [navigate]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const arr: UploadedImage[] = Array.from(files).filter(f => f.type.startsWith("image/")).map(f => ({
      id: crypto.randomUUID(),
      file: f,
      url: URL.createObjectURL(f),
      status: "pending" as Status,
      count: 0,
    }));
    setImages(prev => [...prev, ...arr]);
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(i => i.id !== id));
    setParsed(prev => prev.filter(p => p.source_image !== id));
  };

  const processAll = async () => {
    const todo = images.filter(i => i.status === "pending" || i.status === "error");
    if (todo.length === 0) { toast.info(t("bulkCreate.noPending")); return; }

    for (const img of todo) {
      setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: "processing", error: undefined } : i));
      try {
        const b64 = await fileToBase64(img.file);
        const { data, error } = await supabase.functions.invoke("parse-tournament-schedule", {
          body: { image_base64: b64, image_mime: img.file.type },
        });
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);

        const tours = (data?.tournaments ?? []) as any[];
        const newParsed: ParsedTour[] = tours.map(t => ({
          tempId: crypto.randomUUID(),
          name: t.name ?? "",
          start_time: t.start_time ?? "",
          buy_in: Number(t.buy_in) || 0,
          starting_stack: Number(t.starting_stack) || 20000,
          game_type: (["nlh", "plo", "mixed"].includes(t.game_type) ? t.game_type : "nlh") as any,
          venue: t.venue ?? null,
          club_id: defaultClubId || "",
          selected: true,
          source_image: img.id,
        }));
        setParsed(prev => [...prev, ...newParsed]);
        setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: "done", count: tours.length } : i));
      } catch (e: any) {
        setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: "error", error: e.message } : i));
        toast.error(t("bulkCreate.errorPrefix", { msg: e.message }));
      }
    }
    toast.success(t("bulkCreate.processDone"));
  };

  const updateRow = (tempId: string, patch: Partial<ParsedTour>) => {
    setParsed(prev => prev.map(p => p.tempId === tempId ? { ...p, ...patch } : p));
  };

  const removeRow = (tempId: string) => setParsed(prev => prev.filter(p => p.tempId !== tempId));

  const createAll = async () => {
    const rows = parsed.filter(p => p.selected);
    if (rows.length === 0) { toast.error(t("bulkCreate.noRowSelected")); return; }
    const invalid = rows.find(r => !r.name.trim() || !r.start_time || !r.club_id);
    if (invalid) { toast.error(t("bulkCreate.rowValidation")); return; }

    setCreating(true);
    // `schedule_upload_id` intentionally omitted — migration 20260516123400 (adds
    // tournaments.schedule_upload_id for push-notification grouping) is NOT applied to the live DB,
    // so sending it fails the insert with "column not found in schema cache". Nothing reads it in the
    // app. Re-add once that migration is applied (owner-gated). Same fix as BulkScheduleDialog.tsx.
    const payload = rows.map(r => ({
      name: r.name.trim(),
      start_time: new Date(r.start_time).toISOString(),
      buy_in: r.buy_in,
      starting_stack: r.starting_stack,
      game_type: r.game_type,
      location: r.venue ?? null,
      club_id: r.club_id,
    }));
    const { error } = await (supabase as any).from("tournaments").insert(payload as any);
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("bulkCreate.created", { count: rows.length }));
    setParsed(prev => prev.filter(p => !p.selected));
  };

  if (!authChecked) return <div className="p-6 text-center"><Loader2 className="animate-spin inline" /></div>;

  const stats = {
    uploaded: images.length,
    done: images.filter(i => i.status === "done").length,
    error: images.filter(i => i.status === "error").length,
    detected: parsed.length,
  };

  return (
    <div className="container max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("bulkCreate.back")}
        </Button>
        <h1 className="text-xl md:text-2xl font-bold">{t("bulkCreate.title")}</h1>
        <div />
      </div>

      {/* Upload zone */}
      <Card className="p-4">
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        >
          <ImagePlus className="h-12 w-12 mx-auto text-primary mb-2" />
          <p className="font-medium">{t("bulkCreate.uploadPrompt")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("bulkCreate.uploadHint")}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {images.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {images.map(img => (
                <div key={img.id} className="relative rounded-lg overflow-hidden border h-40">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-1 right-1 flex gap-1">
                    <Badge variant={img.status === "done" ? "default" : img.status === "error" ? "destructive" : "secondary"}>
                      {img.status === "processing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      {img.status === "done" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {img.status === "error" && <AlertCircle className="h-3 w-3 mr-1" />}
                      {img.status === "done" ? t("bulkCreate.tourCount", { count: img.count }) : img.status}
                    </Badge>
                  </div>
                  <Button size="icon" variant="destructive" className="absolute bottom-1 right-1 h-6 w-6"
                    onClick={() => removeImage(img.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  {img.error && <p className="absolute bottom-0 left-0 right-8 text-[10px] bg-destructive text-destructive-foreground px-1 truncate">{img.error}</p>}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Button onClick={processAll} disabled={images.every(i => i.status === "done" || i.status === "processing")}>
                <Wand2 className="h-4 w-4 mr-1" /> {t("bulkCreate.analyzeAi")}
              </Button>
              <div className="text-sm text-muted-foreground ml-auto">
                {t("bulkCreate.statsLine", { uploaded: stats.uploaded, done: stats.done, errors: stats.error, detected: stats.detected })}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Default club selector */}
      {parsed.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("bulkCreate.assignDefaultClub")}</span>
            <Select value={defaultClubId} onValueChange={(v) => {
              setDefaultClubId(v);
              setParsed(prev => prev.map(p => p.club_id ? p : { ...p, club_id: v }));
            }}>
              <SelectTrigger className="w-64"><SelectValue placeholder={t("bulkCreate.selectClubPh")} /></SelectTrigger>
              <SelectContent>
                {clubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" onClick={() => setParsed(prev => prev.map(p => ({ ...p, club_id: defaultClubId })))} disabled={!defaultClubId}>
              {t("bulkCreate.applyAll")}
            </Button>
            <Button className="ml-auto" onClick={createAll} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("bulkCreate.createCount", { count: parsed.filter(p => p.selected).length })}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left w-8"><input type="checkbox" checked={parsed.every(p => p.selected)} onChange={(e) => setParsed(prev => prev.map(p => ({ ...p, selected: e.target.checked })))} /></th>
                  <th className="p-2 text-left">{t("bulkCreate.colName")}</th>
                  <th className="p-2 text-left">{t("bulkCreate.colDateTime")}</th>
                  <th className="p-2 text-left">{t("bulkCreate.colBuyIn")}</th>
                  <th className="p-2 text-left">{t("bulkCreate.colStack")}</th>
                  <th className="p-2 text-left">{t("bulkCreate.colType")}</th>
                  <th className="p-2 text-left">{t("bulkCreate.colClub")}</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {parsed.map(p => (
                  <tr key={p.tempId} className="border-t">
                    <td className="p-2"><input type="checkbox" checked={p.selected} onChange={(e) => updateRow(p.tempId, { selected: e.target.checked })} /></td>
                    <td className="p-2"><Input value={p.name} onChange={(e) => updateRow(p.tempId, { name: e.target.value })} className="h-8 min-w-[180px]" /></td>
                    <td className="p-2">
                      <Input type="datetime-local" value={toLocalInputValue(p.start_time)}
                        onChange={(e) => updateRow(p.tempId, { start_time: new Date(e.target.value).toISOString() })} className="h-8 w-44" />
                    </td>
                    <td className="p-2"><Input type="number" value={p.buy_in} onChange={(e) => updateRow(p.tempId, { buy_in: Number(e.target.value) })} className="h-8 w-28" /></td>
                    <td className="p-2"><Input type="number" value={p.starting_stack} onChange={(e) => updateRow(p.tempId, { starting_stack: Number(e.target.value) })} className="h-8 w-24" /></td>
                    <td className="p-2">
                      <Select value={p.game_type} onValueChange={(v: any) => updateRow(p.tempId, { game_type: v })}>
                        <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nlh">NLH</SelectItem>
                          <SelectItem value="plo">PLO</SelectItem>
                          <SelectItem value="mixed">Mixed</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <Select value={p.club_id} onValueChange={(v) => updateRow(p.tempId, { club_id: v })}>
                        <SelectTrigger className="h-8 w-44"><SelectValue placeholder={t("bulkCreate.selectClub")} /></SelectTrigger>
                        <SelectContent>
                          {clubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2"><Button size="icon" variant="ghost" onClick={() => removeRow(p.tempId)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
