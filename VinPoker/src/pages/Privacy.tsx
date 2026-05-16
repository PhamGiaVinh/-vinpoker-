import { useTranslation } from "react-i18next";

const Privacy = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 prose prose-invert">
      <h1 className="font-display text-3xl text-primary mb-6">{t("privacy.title")}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t("privacy.updated")}</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-bold text-foreground mt-6">{t("privacy.h1")}</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t("privacy.l1")}</li>
          <li>{t("privacy.l2")}</li>
          <li>{t("privacy.l3")}</li>
          <li>{t("privacy.l4")}</li>
        </ul>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("privacy.h2")}</h2>
        <p>{t("privacy.p2")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("privacy.h3")}</h2>
        <p>{t("privacy.p3")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("privacy.h4")}</h2>
        <p>{t("privacy.p4")}</p>

        <h2 className="text-lg font-bold text-foreground mt-6">{t("privacy.h5")}</h2>
        <p>{t("privacy.p5")}</p>
      </section>
    </div>
  );
};

export default Privacy;
