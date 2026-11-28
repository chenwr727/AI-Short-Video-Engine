import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { isLlmConfigured, loadConfig } from "./config.js";
import { errorMessage, TaskError } from "./errors.js";
import { langOf } from "./i18n.js";
import { dataDir, ensureDir, outDir } from "./paths.js";
import { probeDeps } from "./services/deps.js";
import { metaPayload } from "./meta.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerPromptRoutes } from "./routes/prompts.js";
import { registerTaskRoutes } from "./routes/task.js";
import { taskManager } from "./task/manager.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";
const VERSION = process.env.AISV_VERSION ?? "0.1.0";

function webDist(): string {
  return process.env.AISV_WEB_DIR ?? path.resolve(process.cwd(), "..", "web", "dist");
}

export function healthPayload() {
  const cfg = loadConfig();
  return {
    ok: true,
    version: VERSION,
    dataDir: dataDir(),
    outDir: outDir(),
    config: {
      llm: {
        baseUrl: cfg.LLM_API_URL,
        model: cfg.LLM_MODEL,
        configured: isLlmConfigured(cfg),
      },
      dashscope: { configured: Boolean(cfg.DASHSCOPE_API_KEY) },
      tts: {
        edge: true,
        dashscope: Boolean(cfg.DASHSCOPE_API_KEY),
        seed: Boolean(cfg.SEED_TTS_API_KEY),
      },
      material: {
        pixabay: Boolean(cfg.PIXABAY_API_KEY),
        pexels: Boolean(cfg.PEXELS_API_KEY),
      },
    },
    deps: probeDeps(),
  };
}

async function build() {
  const app = Fastify({ logger: { level: process.env.AISV_LOG_LEVEL ?? "info" } });

  await app.register(cors, { origin: true });

  // 未知 Content-Type 按字符串处理，避免 415
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  // 任务状态里的文案只存一份，按写入时的界面语言定稿；这里把语言同步给 manager
  app.addHook("onRequest", async (req) => {
    taskManager.setLang(langOf(req.headers["accept-language"]));
  });

  // 兜住路由里没接住的 TaskError：文案按请求语言渲染，别让它漏成中文
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error instanceof TaskError ? error.statusCode : (error.statusCode ?? 500);
    return reply.code(status).send({ error: errorMessage(error, langOf(req.headers["accept-language"])) });
  });

  app.get("/api/health", async () => healthPayload());
  app.get("/api/meta", async (req) => metaPayload(langOf(req.headers["accept-language"])));
  await registerConfigRoutes(app);
  await registerPromptRoutes(app);
  await registerTaskRoutes(app);

  ensureDir(dataDir());
  ensureDir(outDir());

  const dist = webDist();
  if (fs.existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: `未知接口：${req.url}` });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`未找到前端产物：${dist}（开发态请用 vite 访问 :3000）`);
    app.get("/", async () => ({
      message: "后端已启动，但未找到 web/dist。开发时请访问 http://127.0.0.1:3000",
      health: "/api/health",
    }));
  }

  return app;
}

const app = await build();

async function shutdown(signal: string) {
  app.log.info(`收到 ${signal}，正在退出`);
  try {
    taskManager.flush();
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("exit", () => taskManager.flush());

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`后端就绪：http://${HOST}:${PORT}`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
