#!/usr/bin/env node
/**
 * 把 locales/ 编译成 desktop/assets/locales.json。
 *
 * 设置页和关于页是原生 HTML，不经打包，拿不到 TypeScript 模块。
 * 语言包以 locales/ 为单一真源，这里生成一份 JSON 供它们 fetch，
 * 避免各个页面各存一份词典、改文案时漏改。
 *
 * 既可以直接跑（node scripts/build-locales.mjs），也可以被 build.mjs
 * 直接调用 —— 少一次进程创建，在限制 spawn 的环境里更稳。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "locales");
const outFile = path.join(root, "desktop/assets/locales.json");

/**
 * 一条词典条目：两空格缩进，键可以带引号也可以不带
 * （prettier 的 quoteProps: as-needed 会去掉合法标识符的引号）。
 */
const ENTRY = /^\s{2}"?([^\s":]+)"?:\s*("(?:[^"\\]|\\.)*"),$/gm;

/** 从汇总文件里取出 prefix("ns", …) 的调用顺序 */
function namespacesOf(file) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/\.\.\.prefix\("(\w+)"/g)].map((m) => m[1]);
}

/**
 * 生成 locales.json。
 * @returns {string[]} 中英不一致时的错误信息；空数组表示成功。
 */
export function buildLocales() {
  const languages = ["zh", "en"];
  const result = {};

  for (const lang of languages) {
    const summary = path.join(srcDir, `${lang}.ts`);
    if (!fs.existsSync(summary)) return [`缺少 ${summary}`];
    const flat = {};
    for (const ns of namespacesOf(summary)) {
      const file = path.join(srcDir, `${ns}.${lang}.ts`);
      if (!fs.existsSync(file)) return [`缺少 ${file}`];
      const body = fs.readFileSync(file, "utf8");
      for (const m of body.matchAll(ENTRY)) flat[`${ns}.${m[1]}`] = JSON.parse(m[2]);
    }
    result[lang] = flat;
  }

  // 两份语言必须键一致，否则说明有词典结构被破坏了
  const zhKeys = Object.keys(result.zh).sort();
  const enKeys = Object.keys(result.en).sort();
  const problems = [];
  for (const k of zhKeys) if (!(k in result.en)) problems.push(`en 缺少 ${k}`);
  for (const k of enKeys) if (!(k in result.zh)) problems.push(`zh 缺少 ${k}`);
  if (problems.length) return problems;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`, "utf8");
  console.log(`locales.json：${zhKeys.length} 条 × ${languages.length} 语言 → ${path.relative(root, outFile)}`);
  return [];
}

// 直接执行时才跑（被 import 时交给调用方）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = buildLocales();
  if (problems.length) {
    console.error("locales 生成失败：");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}
