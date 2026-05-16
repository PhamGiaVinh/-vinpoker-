import { useTranslation } from "react-i18next";

const Terms = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 prose prose-invert">
      <h1 className="font-display text-3xl text-primary mb-6">{t("terms.title")}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t("terms.updated")}</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-bold text-foreground mt-6">{t("terms.h1")}</h2>
        <p>
          {t("terms.p1a")} <strong>{t("terms.p1aBold")}</strong> {t("terms.p1aTail")}
        </p>
        <p>{t("terms.p1b")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("terms.h2")}</h2>
        <p>{t("terms.p2a")}</p>
        <p>{t("terms.p2b")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("terms.h3")}</h2>
        <p>{t("terms.p3")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("terms.h4")}</h2>
        <p>{t("terms.p4")}</p>
      </section>
    </div>
  );
};

export default Terms;
