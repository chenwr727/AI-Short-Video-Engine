import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "./bridge";
import { PromptEditor } from "./components/PromptEditor";
import { initLanguage, syncLanguageFromHost, t, bindDocumentTitle, watchSystemLanguage } from "./i18n";
import { initTheme, watchSystemTheme } from "./theme";
import "./index.css";

// 先定主题和语言再挂载，避免首帧闪一下再跳变
initTheme();
watchSystemTheme(() => undefined);
initLanguage();
// 独立窗口不会跟着主窗口重渲染，语言变化要自己接住
watchSystemLanguage();
bindDocumentTitle("prompts.title");
void syncLanguageFromHost();

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
