import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calendar, MapPin, Loader2, Plus, Trash2, Save, Upload, Pencil } from "lucide-react";
import { BackButton } from "@/components/BackButton";

type Series = {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string;
  cover_url: string | null;
  status: string;
};

type Post = {
  id: string;
  series_id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  position: number;
  created_at: string;
};

const SeriesDetail = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [series, setSeries] = useState<Series | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: s }, { data: ps }] = await Promise.all([
      supabase.from("tournament_series").select("*").eq("id", id).maybeSingle(),
      supabase.from("series_posts").select("*").eq("series_id", id).order("position", { ascending: true }),
    ]);
    setSeries(s as any);
    setPosts((ps ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!series) return <div className="text-center py-20 text-muted-foreground">Series not found.</div>;

  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <BackButton />

      <Card className="overflow-hidden border border-primary/30 p-0">
        <div className="aspect-[16/6] bg-gradient-to-br from-secondary to-background relative">
          {series.cover_url && <img src={series.cover_url} alt={series.name} className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-8">
            <div className="text-[11px] tracking-[0.3em] text-primary font-bold mb-1">INTERNATIONAL SERIES</div>
            <h1 className="font-display font-black text-3xl md:text-4xl">{series.name}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" />{fmt(series.start_date)} – {fmt(series.end_date)}</span>
              {series.location && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{series.location}</span>}
            </div>
          </div>
        </div>
        {series.description && <div className="p-5 text-sm whitespace-pre-wrap">{series.description}</div>}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-primary">Schedule & Articles</h2>
        {isAdmin && <NewPostDialog seriesId={series.id} onCreated={load} />}
      </div>

      {posts.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No articles yet.</Card>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} isAdmin={isAdmin} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
};

const PostCard = ({ post, isAdmin, onChanged }: { post: Post; isAdmin: boolean; onChanged: () => void }) => {
  const remove = async () => {
    if (!confirm("Delete this article?")) return;
    const { error } = await supabase.from("series_posts").delete().eq("id", post.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); onChanged(); }
  };
  return (
    <Card className="overflow-hidden p-0 border border-border">
      {post.image_url && (
        <div className="aspect-[16/7] bg-muted">
          <img src={post.image_url} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display font-bold text-lg">{post.title}</h3>
          {isAdmin && (
            <div className="flex gap-1 shrink-0">
              <EditPostDialog post={post} onSaved={onChanged} />
              <Button variant="ghost" size="icon" onClick={remove}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          )}
        </div>
        {post.body && <div className="text-sm whitespace-pre-wrap mt-2 text-muted-foreground leading-relaxed">{post.body}</div>}
      </div>
    </Card>
  );
};

const PostForm = ({ initial, onSubmit, submitting }: any) => {
  const [f, setF] = useState({ title: initial?.title ?? "", body: initial?.body ?? "", image_url: initial?.image_url ?? "", position: initial?.position ?? 0 });
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Image only");
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5MB");
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `series-posts/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("app-assets").getPublicUrl(path);
    setF((p) => ({ ...p, image_url: data.publicUrl }));
    setUploading(false);
  };
  return (
    <div className="space-y-2">
      <Label>Title</Label>
      <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <Label>Body / Schedule</Label>
      <Textarea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Day 1: Event #1 NLH $1,500 @ 12:00..." />
      <Label>Image URL</Label>
      <Input value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} placeholder="https://… or upload" />
      <Label>Order</Label>
      <Input type="number" value={f.position} onChange={(e) => setF({ ...f, position: +e.target.value })} />
      <label>
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button asChild variant="outline" size="sm" className="border-primary/40 text-primary cursor-pointer">
          <span><Upload className="w-4 h-4 mr-1" />{uploading ? "Uploading..." : "Upload image"}</span>
        </Button>
      </label>
      <Button onClick={() => onSubmit(f)} disabled={submitting || !f.title.trim()} className="w-full gradient-neon text-primary-foreground border-0">
        <Save className="w-4 h-4 mr-1" />{submitting ? "Saving…" : "Save"}
      </Button>
    </div>
  );
};

const NewPostDialog = ({ seriesId, onCreated }: { seriesId: string; onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (f: any) => {
    setBusy(true);
    const { error } = await supabase.from("series_posts").insert({ ...f, series_id: seriesId });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Article added"); setOpen(false); onCreated(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gradient-neon text-primary-foreground border-0"><Plus className="w-4 h-4 mr-1" />Add Article</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Article</DialogTitle></DialogHeader>
        <PostForm onSubmit={submit} submitting={busy} />
      </DialogContent>
    </Dialog>
  );
};

const EditPostDialog = ({ post, onSaved }: { post: Post; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (f: any) => {
    setBusy(true);
    const { error } = await supabase.from("series_posts").update(f).eq("id", post.id);
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); setOpen(false); onSaved(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon"><Pencil className="w-4 h-4 text-primary" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Article</DialogTitle></DialogHeader>
        <PostForm initial={post} onSubmit={submit} submitting={busy} />
      </DialogContent>
    </Dialog>
  );
};

export default SeriesDetail;
