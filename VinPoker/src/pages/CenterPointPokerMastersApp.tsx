import { Toaster } from "sonner";
import CenterPointPokerMastersPage from "./CenterPointPokerMastersPage";

export default function CenterPointPokerMastersApp() {
  return (
    <>
      <Toaster theme="dark" position="top-center" />
      <CenterPointPokerMastersPage />
    </>
  );
}
