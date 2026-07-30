import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OpsApp from "@/OpsApp";
import "@/index.css";
import "@/i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OpsApp />
  </StrictMode>,
);
