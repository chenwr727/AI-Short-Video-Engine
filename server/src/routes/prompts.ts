import type { FastifyInstance } from "fastify";
import { errorMessage, userText } from "../errors.js";
import { langOf, type Lang } from "../i18n.js";
import { PROMPT_DOCS, promptDocs, readPromptValue, resetPromptValue, writePromptValue } from "../services/prompts.js";

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
  app.get("/api/prompts", async (req) => {
    const docs = promptDocs(langOf(req.headers["accept-language"]));
    return {
      docs,
      values: PROMPT_DOCS.flatMap((doc) =>
        doc.fields.map((field) => {
          const item = readPromptValue(doc.file, field.key);
          return { file: item.file, key: item.key, value: item.value, overridden: item.overridden };
        }),
      ),
    };
  });

  app.get("/api/prompts/one", async (req, reply) => {
    const { file, key } = target((req.query ?? {}) as PromptBody);
    const lang: Lang = langOf(req.headers["accept-language"]);
    try {
      return reply.send(readPromptValue(file, key));
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, lang) });
    }
  });

  app.post("/api/prompts", async (req, reply) => {
    const body = (req.body ?? {}) as PromptBody;
    const { file, key } = target(body);
    const lang: Lang = langOf(req.headers["accept-language"]);
    if (typeof body.value !== "string") {
      return reply.code(400).send({ error: userText("promptValueInvalid", lang) });
    }
    try {
      return reply.send(writePromptValue(file, key, body.value));
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, lang) });
    }
  });

  /** 恢复内置默认，删掉该键的覆盖 */
  app.post("/api/prompts/reset", async (req, reply) => {
    const { file, key } = target((req.body ?? {}) as PromptBody);
    const lang: Lang = langOf(req.headers["accept-language"]);
    try {
      return reply.send(resetPromptValue(file, key));
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, lang) });
    }
  });
}
