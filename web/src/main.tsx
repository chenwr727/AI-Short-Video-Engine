import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initLanguage, syncLanguageFromHost, t, bindDocumentTitle, watchSystemLanguage } from "./i18n";
import { initTheme } from "./theme";
import "./index.css";

// 先定主题和语言再挂载，避免首帧闪一下再跳变
initTheme();
initLanguage();
watchSystemLanguage();
bindDocumentTitle("app.name");

// 以主进程的 ui.json 为准校正一次：localStorage 那份只是首帧的镜像
void syncLanguageFromHost();

const container = document.getElementById("root");
if (!container) throw new Error(t("error.root"));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
