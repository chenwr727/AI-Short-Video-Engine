import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "./bridge";
import { PromptEditor } from "./components/PromptEditor";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 节点");

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
