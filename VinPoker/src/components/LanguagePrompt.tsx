import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const PROMPT_KEY = "vinpoker.lang.prompted";
const MANUAL_KEY = "vinpoker.lang.manual";
const STORED_KEY = "vinpoker.lang";

type Target = "zh-CN" | "ko" | "ja" | "th" | null;

export const LanguagePrompt = () => {
  const { i18n, t } = useTranslation();
  const [target, setTarget] = useState<Target>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(MANUAL_KEY)) return;
      if (localStorage.getItem(PROMPT_KEY)) return;
      if (localStorage.getItem(STORED_KEY)) return;
      const nav = (navigator.language || "").toLowerCase();
      const langs = (navigator.languages || []).map((l) => l.toLowerCase());
      const all = [nav, ...langs];
      const cur = (i18n.language || "").toLowerCase();
      if (all.some((l) => l.startsWith("zh")) && !cur.startsWith("zh")) {
        setTarget("zh-CN");
      } else if (all.some((l) => l.startsWith("ko")) && !cur.startsWith("ko")) {
        setTarget("ko");
      } else if (all.some((l) => l.startsWith("ja")) && !cur.startsWith("ja")) {
        setTarget("ja");
      } else if (all.some((l) => l.startsWith("th")) && !cur.startsWith("th")) {
        setTarget("th");
      }
    } catch {}
  }, [i18n.language]);

  const handle = (switchTo: boolean) => {
    try {
      localStorage.setItem(PROMPT_KEY, "1");
      if (switchTo && target) {
        i18n.changeLanguage(target);
        localStorage.setItem(STORED_KEY, target);
        localStorage.setItem(MANUAL_KEY, "1");
      }
    } catch {}
    setTarget(null);
  };

  const open = target !== null;
  const title = target === "ko"
    ? t("languagePrompt.titleKo", "한국어로 전환하시겠습니까?")
    : target === "ja"
    ? t("languagePrompt.titleJa", "日本語に切り替えますか？")
    : target === "th"
    ? t("languagePrompt.titleTh", "เปลี่ยนเป็นภาษาไทย?")
    : t("languagePrompt.title", "切换到简体中文?");
  const desc = target === "ko"
    ? t("languagePrompt.descriptionKo", "브라우저 언어가 한국어로 감지되었습니다. 한국어 인터페이스로 전환할까요?")
    : target === "ja"
    ? t("languagePrompt.descriptionJa", "ブラウザの言語が日本語に設定されています。日本語のインターフェースに切り替えますか？")
    : target === "th"
    ? t("languagePrompt.descriptionTh", "เบราว์เซอร์ของคุณใช้ภาษาไทย เปลี่ยนเป็นอินเทอร์เฟซภาษาไทยหรือไม่?")
    : t("languagePrompt.description", "检测到您的浏览器使用中文。是否切换到简体中文界面?");
  const switchLabel = target === "ko"
    ? t("languagePrompt.switchKo", "한국어로 전환")
    : target === "ja"
    ? t("languagePrompt.switchJa", "日本語に切り替え")
    : target === "th"
    ? t("languagePrompt.switchTh", "เปลี่ยนเป็นภาษาไทย")
    : t("languagePrompt.switch", "切换到简体中文");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handle(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handle(false)}>
            {t("languagePrompt.keep", "Keep current")}
          </Button>
          <Button onClick={() => handle(true)}>{switchLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
