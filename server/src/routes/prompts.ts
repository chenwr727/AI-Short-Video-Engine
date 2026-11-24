import type { FastifyInstance } from "fastify";
import {
  PROMPT_DOCS,
  readPromptValue,
  resetPromptValue,
  writePromptValue,
} from "../services/prompts.js";

interface PromptBody {
  file?: unknown;
  key?: unknown;
  value?: unknown;
}

function target(body: PromptBody): { file: string; key: string } {
  return {
    file: typeof body.file === "string" ? body.file : "",
    key: typeof body.key === "string" ? body.key : "",
  };
}

export async function registerPromptRoutes(app: FastifyInstance): Promise<void> {
  /** 编辑器用的目录与全部当前值 */
  app.get("/api/prompts", async () => ({
    docs: PROMPT_DOCS,
    values: PROMPT_DOCS.flatMap((doc) =>
      doc.fields.map((field) => {
        const item = readPromptValue(doc.file, field.key);
        return { file: item.file, key: item.key, value: item.value, overridden: item.overridden };
      }),
    ),
  }));

  app.get("/api/prompts/one", async (req, reply) => {
    const { file, key } = target((req.query ?? {}) as PromptBody);
    try {
      return reply.send(readPromptValue(file, key));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/prompts", async (req, reply) => {
    const body = (req.body ?? {}) as PromptBody;
    const { file, key } = target(body);
    if (typeof body.value !== "string") return reply.code(400).send({ error: "value 必须是字符串" });
    try {
      return reply.send(writePromptValue(file, key, body.value));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 恢复内置默认，删掉该键的覆盖 */
  app.post("/api/prompts/reset", async (req, reply) => {
    const { file, key } = target((req.body ?? {}) as PromptBody);
    try {
      return reply.send(resetPromptValue(file, key));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
