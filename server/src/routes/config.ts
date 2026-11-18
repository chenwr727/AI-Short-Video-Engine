import type { FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "../config.js";
import { runConfigTest, type TestTarget } from "../services/config-test.js";

interface TestBody {
  target?: string;
  config?: Record<string, unknown>;
}

/** 只接受已知键的字符串值 */
function pickConfig(input: unknown): Partial<AppConfig> {
  const base = loadConfig();
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const out: Partial<AppConfig> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key in base && typeof value === "string") out[key as keyof AppConfig] = value.trim();
  }
  return out;
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  // 用表单未保存的值走一次真实请求
  app.post("/api/config-test", async (req, reply) => {
    const body = (req.body ?? {}) as TestBody;
    const target = body.target === "dashscope" ? "dashscope" : body.target === "llm" ? "llm" : null;
    if (!target) return reply.code(400).send({ error: "target 只能是 llm 或 dashscope" });

    const cfg: AppConfig = { ...loadConfig(), ...pickConfig(body.config) };
    const result = await runConfigTest(target as TestTarget, cfg);
    return reply.send(result);
  });
}
