import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // 主界面 + 提示词独立窗口
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        prompts: fileURLToPath(new URL("prompts.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      // 直接复用 remotion 子工程的卡片组件：预览与最终渲染是同一份代码
      "@cards": fileURLToPath(new URL("../remotion/src", import.meta.url)),
    },
  },
  server: {
    // 显式绑 IPv4，否则只监听 [::1]，Electron 连不上
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
