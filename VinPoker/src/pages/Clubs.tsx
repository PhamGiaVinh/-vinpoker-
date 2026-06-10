import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star, Loader2, Spade } from "lucide-react";
import royalPokerLogo from "@/assets/royal-poker-logo.jpg";
import { useTranslation } from "react-i18next";

const REGIONS = ["All", "TP.HCM", "Hanoi", "Da Nang"];

const Clubs = () => {
  const { t } = useTranslation();
  const [clubs, setClubs] = useState<any[]>([]);
  const [region, setRegion] = useState("All");
  const [sort, setSort] = useState("curated");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clubs")
        .select("*")
        .eq("status", "approved")
        .order("schedule_sort_order", { ascending: true })
        .order("name");
      setClubs(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let r = clubs.filter(c => region === "All" || c.region === region);
    r.sort((a, b) => {
      if (sort === "rating") return Number(b.rating) - Number(a.rating);
      if (sort === "name") return a.name.localeCompare(b.name);
      // curated: schedule_sort_order asc, then name
      const oa = a.schedule_sort_order ?? 0;
      const ob = b.schedule_sort_order ?? 0;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    return r;
  }, [clubs, region, sort]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-card/60 to-card/40 border border-gold/30 p-6 backdrop-blur-sm">
        <h1 className="font-display text-3xl font-bold text-gold">{t("clubsPage.title")}</h1>
        <p className="text-sm text-muted-foreground mt-2">{t("clubsPage.subtitle")}</p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger className="bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
          <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r === "All" ? t("clubsPage.allRegions") : r}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="curated">{t("clubsPage.sortCurated")}</SelectItem>
            <SelectItem value="rating">{t("clubsPage.sortRating")}</SelectItem>
            <SelectItem value="name">{t("clubsPage.sortName")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(c => (
            <Link key={c.id} to={`/club/${c.id}`}>
              <Card className="bg-gradient-to-br from-card/60 to-card/40 border-border/40 hover:border-gold/40 transition-all p-5 backdrop-blur-sm">
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center shrink-0 shadow-gold bg-background">
                    {c.cover_url ? (
                      <img src={c.cover_url} alt={c.name} className="w-full h-full object-cover" />
                    ) : /royal\s*poker/i.test(c.name) ? (
                      <img src={royalPokerLogo} alt={c.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full gradient-gold flex items-center justify-center">
                        <Spade className="w-8 h-8 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold text-base truncate">{c.name}</h3>
                      <Badge variant="outline" className="border-success/40 text-success shrink-0">{t("clubsPage.open")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {c.address}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="flex items-center gap-0.5 text-gold font-semibold">
                        <Star className="w-3.5 h-3.5 fill-current" /> {(/quads\s*poker/i.test(c.name) ? 5.0 : 4.8).toFixed(1)}
                      </span>
                      <span className="text-muted-foreground">· {c.region}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Clubs;
