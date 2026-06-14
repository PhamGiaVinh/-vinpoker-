import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Newspaper, Link2, Facebook } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { SyncingBadge } from "@/components/SyncingBadge";

const PUBLIC_ORIGIN = "https://vinpoker.live";

const NewsDetail = () => {
  const { t } = useTranslation();
  const { slug } = useParams();

  const { data: post, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["news", "detail", slug],
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.from("news_posts").select("*").eq("slug", slug!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const loading = isLoading && !post;

  useEffect(() => {
    if (post?.id) {
      supabase.from("news_posts").update({ view_count: (post.view_count ?? 0) + 1 }).eq("id", post.id).then(() => {});
    }
  }, [post?.id]);

  const shareUrl = `${PUBLIC_ORIGIN}/news/${slug}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t("newsPage.linkCopied"));
    } catch {
      toast.error(t("newsPage.copyFailed") + shareUrl);
    }
  };

  const shareFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer,width=600,height=600");
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!post) {
    if (isError) {
      return (
        <Card className="p-10 text-center space-y-3">
          <p className="text-destructive font-semibold">{t('newsPage.loadErrorDetail')}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>{t('newsPage.retry')}</Button>
        </Card>
      );
    }
    return <Card className="p-10 text-center">{t("newsPage.notFound")}</Card>;
  }

  return (
    <article className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/news"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> {t("newsPage.backToAll")}</Button></Link>
        <SyncingBadge isFetching={isFetching && !isLoading} isError={isError && !!post} />
      </div>
      {post.cover_url ? (
        <div className="aspect-[16/9] overflow-hidden rounded-xl bg-muted">
          <img src={post.cover_url} alt={post.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-[16/9] rounded-xl bg-gradient-to-br from-primary/20 to-secondary flex items-center justify-center">
          <Newspaper className="w-16 h-16 text-primary/60" />
        </div>
      )}
      <div>
        <div className="text-xs font-bold tracking-widest text-primary uppercase mb-3">
          {post.published_at ? formatDateTime(post.published_at) : t("newsPage.draft")}
        </div>
        <h1 className="font-display font-black text-3xl md:text-4xl leading-tight">{post.title}</h1>
        {post.summary && <p className="text-lg text-muted-foreground mt-3">{post.summary}</p>}

        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Link2 className="w-4 h-4 mr-1.5" /> {t("newsPage.copyLinkLong")}
          </Button>
          <Button size="sm" variant="outline" onClick={shareFacebook}>
            <Facebook className="w-4 h-4 mr-1.5" /> {t("newsPage.shareFacebook")}
          </Button>
        </div>
      </div>
      {post.body && (
        <div className="prose prose-invert max-w-none text-base leading-relaxed space-y-4">
          {post.body.split(/(!\[[^\]]*\]\([^)]+\))/g).map((chunk, i) => {
            const m = chunk.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (m) {
              return (
                <img
                  key={i}
                  src={m[2]}
                  alt={m[1] || ""}
                  loading="lazy"
                  className="rounded-lg border border-border max-w-full h-auto mx-auto"
                />
              );
            }
            return chunk ? (
              <p key={i} className="whitespace-pre-wrap">{chunk}</p>
            ) : null;
          })}
        </div>
      )}
    </article>
  );
};

export default NewsDetail;
