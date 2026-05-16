import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Newspaper, ArrowRight } from "lucide-react";
import { formatShortDate } from "@/lib/format";

interface NewsItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  published_at: string | null;
  is_featured: boolean;
}

export const NewsWidget = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("news_posts")
        .select("id, slug, title, summary, cover_url, published_at, is_featured")
        .eq("status", "published")
        .order("is_featured", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(3);
      setItems(data ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading || items.length === 0) return null;

  const [hero, ...rest] = items;

  return (
    <Card className="overflow-hidden border border-border gradient-card">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-primary" />
          <h2 className="font-display font-bold text-sm tracking-[0.2em] uppercase">{t("newsPage.weeklyTitle")}</h2>
        </div>
        <Link to="/news" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
          {t("newsPage.all")} <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-0">
        <Link to={`/news/${hero.slug}`} className="group relative block overflow-hidden md:border-r border-border/60">
          {hero.cover_url ? (
            <div className="aspect-[16/9] overflow-hidden bg-muted">
              <img src={hero.cover_url} alt={hero.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
            </div>
          ) : (
            <div className="aspect-[16/9] bg-gradient-to-br from-primary/20 to-secondary flex items-center justify-center">
              <Newspaper className="w-10 h-10 text-primary/60" />
            </div>
          )}
          <div className="p-5">
            <div className="text-[10px] font-bold tracking-widest text-primary uppercase mb-2">
              {hero.published_at ? formatShortDate(hero.published_at) : t("newsPage.newOrLatest")}
            </div>
            <h3 className="font-display font-bold text-lg leading-snug group-hover:text-primary transition-colors">{hero.title}</h3>
            {hero.summary && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{hero.summary}</p>}
          </div>
        </Link>

        <div className="divide-y divide-border/60">
          {rest.map((n) => (
            <Link
              key={n.id}
              to={`/news/${n.slug}`}
              className="group flex gap-3 p-4 hover:bg-muted/40 transition-colors"
            >
              {n.cover_url && (
                <img src={n.cover_url} alt={n.title} className="w-20 h-20 rounded-lg object-cover shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-widest text-primary uppercase mb-1">
                  {n.published_at ? formatShortDate(n.published_at) : t("newsPage.newOrLatest")}
                </div>
                <h4 className="font-bold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">{n.title}</h4>
                {n.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.summary}</p>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
};
