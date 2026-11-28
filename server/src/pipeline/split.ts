import { userError } from "../errors.js";

/** 按标点拆句并合并过短片段，一句对应一条配音与字幕 */
export function splitContent(content: string, minLength = 10): string[] {
  const trimmed = content.trim();
  if (!trimmed) throw userError("emptyLines", 400);

  const parts = trimmed.split(/([。！？；])/);
  const sentences: string[] = [];
  let temp = "";

  for (const part of parts) {
    if (!part) continue;
    temp += part;
    if ("。！？；".includes(part)) {
      sentences.push(temp);
      temp = "";
    }
  }
  if (temp) sentences.push(temp);

  const contents: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length < minLength) {
      current += sentence;
    } else {
      if (current) contents.push(current);
      current = sentence;
    }
  }

  if (current) {
    const last = contents[contents.length - 1];
    if (last !== undefined && current.length < minLength / 2) {
      contents[contents.length - 1] = last + current;
    } else {
      contents.push(current);
    }
  }

  return contents;
}
