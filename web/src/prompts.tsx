import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "./bridge";
import { PromptEditor } from "./components/PromptEditor";
import { initLanguage, syncLanguageFromHost, t, bindDocumentTitle, watchSystemLanguage } from "./i18n";
import { initTheme, syncThemeFromHost, watchSystemTheme } from "./theme";
import "./index.css";

// 先定主题和语言再挂载，避免首帧闪一下再跳变
initTheme();
// 独立窗口不会跟着主窗口重渲染，主题与语言变化都要自己接住
watchSystemTheme(() => undefined);
initLanguage();
watchSystemLanguage();
bindDocumentTitle("prompts.title");
void syncLanguageFromHost();
void syncThemeFromHost();

const container = document.getElementById("root");
if (!container) throw new Error(t("error.root"));

/** 独立窗口里由主进程关窗，浏览器里退回 window.close */
function close() {
  const api = bridge();
  if (api?.closeWindow) {
    void api.closeWindow();
    return;
  }
  window.close();
}

createRoot(container).render(
  <StrictMode>
    <PromptEditor standalone onClose={close} />
  </StrictMode>,
);
