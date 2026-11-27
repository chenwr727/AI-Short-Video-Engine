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

/**
 * 设置页里声明的字段键。
 *
 * 表单现在是脚本按 SECTIONS 定义渲染出来的，字段写在 `key: "XXX"` 而不是
 * 标签的 data-key 上。两种写法都认，免得改一次渲染方式就绕过这项检查。
 */
function readFormKeys(file) {
  const src = fs.readFileSync(file, "utf8");
  const attr = [...src.matchAll(/data-key="([A-Z0-9_]+)"/g)].map((m) => m[1]);
  const decl = [...src.matchAll(/\bkey:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  return [...attr, ...decl];
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

// 5. 每个字段声明须带可校验的类型，否则非法值会被静默回退
const html = fs.readFileSync(path.join(root, "desktop/assets/settings.html"), "utf8");

/*
 * 表单由 SECTIONS 渲染，字段写成可能跨多行的对象字面量：
 *   {
 *     key: "MATERIAL_MIN_DURATION",
 *     title: "素材最短时长",
 *     kind: "number",
 *     min: 1,
 *     max: 120,
 *   },
 * 按 "{ … }" 切出每个对象块再逐块检查，不假设写在一行。
 */
const blocks = [...html.matchAll(/\{[^{}]*\bkey:\s*"[A-Z0-9_]+"[^{}]*\}/g)].map((m) => m[0]);

for (const block of blocks) {
  const key = (block.match(/\bkey:\s*"([A-Z0-9_]+)"/) ?? [])[1];
  if (!key) continue;

  const kind = (block.match(/\bkind:\s*"([a-z]+)"/) ?? [])[1];
  if (!kind) {
    problems.push(`settings.html 里 ${key} 没声明 kind（text / password / number / switch）`);
    continue;
  }
  if (!["text", "password", "number", "switch"].includes(kind)) {
    problems.push(`settings.html 里 ${key} 的 kind "${kind}" 不认识`);
    continue;
  }
  if (kind !== "number") continue;

  // 数字项必须有 min / max，否则前端没法拦非法值
  const min = (block.match(/\bmin:\s*(-?\d+(?:\.\d+)?)/) ?? [])[1];
  const max = (block.match(/\bmax:\s*(-?\d+(?:\.\d+)?)/) ?? [])[1];
  if (min === undefined || max === undefined) {
    problems.push(`settings.html 里 ${key} 是数字项，必须声明 min 与 max`);
    continue;
  }
  if (Number(min) > Number(max)) {
    problems.push(`settings.html 里 ${key} 的 min 大于 max`);
  }
}

// 6. 语言包：单一真源在 locales/，各语言的键必须与中文对齐
/*
 * en.ts 已经用 Record<MessageKey, string> 在编译期约束住，但那只覆盖 web。
 * 设置页、关于页走的是构建产物 locales.json，没有类型保护，
 * 所以这里独立验一遍，顺便确认那两份产物是最新的。
 */
const localesDir = path.join(root, "locales");

/**
 * 从一个 .ts 文件里取顶层两空格缩进的键。
 *
 * 值的写法有两种：与键同行，或（长文案）折到下一行由 prettier 排。
 * 这里只认「键 + 冒号」，不要求后面紧跟引号，否则跨行的那些会被漏掉。
 * 引号同样可能被 prettier 去掉。
 */
function readTsKeys(file) {
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf8");
  return [...body.matchAll(/^\s{2}"?([^\s":]+)"?:\s*(?:"|$)/gm)].map((m) => m[1]);
}

/** 汇总文件里 prefix("ns", …) 的命名空间顺序 */
function readNamespaces(file) {
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf8");
  return [...body.matchAll(/\.\.\.prefix\("(\w+)"/g)].map((m) => m[1]);
}

const languages = ["zh", "en"];
const flat = {};

for (const lang of languages) {
  const nsList = readNamespaces(path.join(localesDir, `${lang}.ts`));
  if (!nsList) {
    problems.push(`locales/${lang}.ts 不存在（语言包入口缺失）`);
    continue;
  }
  flat[lang] = new Set();
  for (const ns of nsList) {
    const keys = readTsKeys(path.join(localesDir, `${ns}.${lang}.ts`));
    if (!keys) {
      problems.push(`locales/${ns}.${lang}.ts 不存在`);
      continue;
    }
    for (const key of keys) flat[lang].add(`${ns}.${key}`);
  }
  if (flat[lang].size === 0) problems.push(`locales/${lang}.ts 没汇总出任何键`);
}

if (flat.zh && flat.en) {
  for (const key of flat.zh) if (!flat.en.has(key)) problems.push(`locales 英文缺少 ${key}`);
  for (const key of flat.en) if (!flat.zh.has(key)) problems.push(`locales 中文缺少 ${key}`);
}

// 7. 原生页面不许再自带词典：只允许 fetch locales.json
for (const page of ["settings.html", "about.html"]) {
  const file = path.join(root, "desktop/assets", page);
  const src = fs.readFileSync(file, "utf8");
  if (/\bconst I18N\s*=\s*\{/.test(src)) {
    problems.push(`${page} 里还有内联 I18N 词典，应改为读 locales.json`);
  }
  if (!src.includes("locales.json")) {
    problems.push(`${page} 没有引用 locales.json（语言包接不上）`);
  }
}

// 8. locales.json 必须存在且与 locales/ 同步
const jsonFile = path.join(root, "desktop/assets/locales.json");
if (!fs.existsSync(jsonFile)) {
  problems.push("desktop/assets/locales.json 不存在，请运行 node scripts/build-locales.mjs");
} else if (flat.zh && flat.en) {
  const built = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  for (const lang of languages) {
    const keys = new Set(Object.keys(built[lang] ?? {}));
    for (const key of flat[lang]) if (!keys.has(key)) problems.push(`locales.json 的 ${lang} 过期，缺少 ${key}`);
    for (const key of keys) if (!flat[lang].has(key)) problems.push(`locales.json 的 ${lang} 多出 ${key}`);
  }
}

// 9. 前后端各存一份类型定义，同名接口的字段必须一致
/*
 * web 与 server 不共享包，这些接口是手工同步的两份。
 * 只比字段名集合：类型写法（可空、联合）允许有差异，
 * 但少一个字段就意味着那边收不到数据，必须拦下。
 */
function interfaceFields(file) {
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  const out = new Map();
  // 匹配 export interface X { ... }，按花括号配平取主体
  for (const m of src.matchAll(/export interface (\w+)\s*\{/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    // 顶层字段：行首若干空格 + 标识符 + 可选 ?
    const fields = new Set();
    let d = 0;
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      const fm = /^(\w+)\??\s*:/.exec(trimmed);
      if (d === 0 && fm) fields.add(fm[1]);
      d += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    }
    if (fields.size) out.set(m[1], fields);
  }
  return out;
}

const serverTypes = interfaceFields(path.join(root, "server/src/types.ts"));
const webTypes = interfaceFields(path.join(root, "web/src/types.ts"));
if (!serverTypes || !webTypes) {
  problems.push("server/src/types.ts 或 web/src/types.ts 不存在");
} else {
  for (const [name, serverFields] of serverTypes) {
    const webFields = webTypes.get(name);
    if (!webFields) continue; // 只在一侧出现的接口不在此列
    for (const f of serverFields) if (!webFields.has(f)) problems.push(`类型 ${name}：web 侧缺少字段 ${f}`);
    for (const f of webFields) if (!serverFields.has(f)) problems.push(`类型 ${name}：server 侧缺少字段 ${f}`);
  }
}

if (problems.length) {
  console.error(`配置不一致，共 ${problems.length} 处：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`配置一致：server ${server.size} 项 / desktop ${desktop.size} 项 / 表单 ${new Set(form).size} 个输入框`);
