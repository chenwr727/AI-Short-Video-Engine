#!/usr/bin/env node
/**
 * 配置一致性检查，配置键散落在三处，漏改会静默丢值：
 *   server/src/config.ts —— 唯一真源
 *   desktop/src/config.ts —— 白名单与默认值
 *   desktop/assets/settings.html —— 表单字段
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 从 `const DEFAULTS = { ... };` 解析键 → 原始字面量 */
function readDefaults(file) {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("const DEFAULTS");
  if (start < 0) throw new Error(`${file} 里找不到 const DEFAULTS`);
  const open = src.indexOf("{", start);
  const close = src.indexOf("\n};", open);
  if (open < 0 || close < 0) throw new Error(`${file} 里 DEFAULTS 的括号不完整`);

  const out = new Map();
  for (const line of src.slice(open + 1, close).split(/\r?\n/)) {
    const m = line.match(/^\s{2}([A-Z0-9_]+):\s*(.+?),\s*$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** 设置页表单里出现的 data-key */
function readFormKeys(file) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/data-key="([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

const problems = [];

const server = readDefaults(path.join(root, "server/src/config.ts"));
const desktop = readDefaults(path.join(root, "desktop/src/config.ts"));
const form = readFormKeys(path.join(root, "desktop/assets/settings.html"));

if (server.size === 0) problems.push("server/src/config.ts 没解析出任何配置项");

// 1. 键集合一致
for (const key of server.keys()) {
  if (!desktop.has(key)) problems.push(`desktop/src/config.ts 缺少 ${key}（保存时会被白名单丢弃）`);
}
for (const key of desktop.keys()) {
  if (!server.has(key)) problems.push(`desktop/src/config.ts 多出 ${key}（server 不认识这个键）`);
}

// 2. 默认值一致
for (const [key, value] of server) {
  const other = desktop.get(key);
  if (other !== undefined && other !== value) {
    problems.push(`默认值不一致 ${key}: server=${value} desktop=${other}`);
  }
}

// 3. 表单覆盖每个配置项
for (const key of server.keys()) {
  if (!form.includes(key)) problems.push(`settings.html 缺少 ${key} 的输入框（用户改不到）`);
}
for (const key of form) {
  if (!server.has(key)) problems.push(`settings.html 多出 ${key}（配置里不存在，保存会被忽略）`);
}

// 4. 同一个 key 只能有一个输入框
const seen = new Set();
for (const key of form) {
  if (seen.has(key)) problems.push(`settings.html 里 ${key} 出现了多次`);
  seen.add(key);
}

// 5. 输入框须声明类型，否则非法值会被静默回退
const html = fs.readFileSync(path.join(root, "desktop/assets/settings.html"), "utf8");
const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);

for (const tag of inputs) {
  const key = (tag.match(/data-key="([A-Z0-9_]+)"/) ?? [])[1];
  if (!key) continue;
  const type = (tag.match(/type="([^"]+)"/) ?? [])[1] ?? "text";

  if (type === "checkbox") {
    if (tag.includes("data-num") || tag.includes("data-text") || tag.includes("data-max")) {
      problems.push(`settings.html 里 ${key} 是开关，不该声明 data-num / data-text / data-max`);
    }
    continue;
  }

  const hasNum = tag.includes("data-num");
  const hasText = tag.includes('data-text="1"');
  const hasMax = tag.includes("data-max");
  const numOk = /\bdata-num="\d+(?:\.\d+)?,\d+(?:\.\d+)?"/.test(tag);
  const maxOk = /\bdata-max="[1-9]\d*"/.test(tag);

  if (hasNum && !numOk) {
    problems.push(`settings.html 里 ${key} 的 data-num 格式不对，应为 "最小,最大"（如 "1,120"）`);
    continue;
  }
  if (hasMax && !maxOk) {
    problems.push(`settings.html 里 ${key} 的 data-max 应为正整数（如 "8"）`);
    continue;
  }
  if ([hasNum, hasText, hasMax].filter(Boolean).length > 1) {
    problems.push(`settings.html 里 ${key} 同时声明了多种类型（data-num / data-text / data-max），只能选一种`);
    continue;
  }

  // password 本身即文本，无需 data-text
  if (type === "password") {
    if (hasNum) problems.push(`settings.html 里 ${key} 是密钥输入框，不该声明 data-num`);
    continue;
  }

  if (!hasNum && !hasText && !hasMax) {
    problems.push(
      `settings.html 里 ${key} 没声明类型：数字请加 data-num="最小,最大"，文本请加 data-text="1"，有长度限制请加 data-max="上限"`,
    );
  }
}

if (problems.length) {
  console.error(`配置不一致，共 ${problems.length} 处：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`配置一致：server ${server.size} 项 / desktop ${desktop.size} 项 / 表单 ${new Set(form).size} 个输入框`);
