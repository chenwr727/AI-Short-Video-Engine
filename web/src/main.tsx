import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initLanguage, syncLanguageFromHost, t, bindDocumentTitle, watchSystemLanguage } from "./i18n";
import { initTheme, syncThemeFromHost } from "./theme";
import "./index.css";

// 先定主题和语言再挂载，避免首帧闪一下再跳变
initTheme();
initLanguage();
watchSystemLanguage();
bindDocumentTitle("app.name");

// localStorage 只是首帧镜像，以 ui.json 为准校正一次
void syncLanguageFromHost();
void syncThemeFromHost();

const container = document.getElementById("root");
if (!container) throw new Error(t("error.root"));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
