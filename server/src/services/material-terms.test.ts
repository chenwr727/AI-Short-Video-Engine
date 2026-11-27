import assert from "node:assert/strict";
import { test } from "node:test";
import { shortenTerms } from "../services/material.js";

/**
 * 长检索词缩短。
 *
 * 这里守的是一条容易看漏的规则：**画幅词必须带过缩短过程**。
 * 早先 `vertical stock market screen` 会按位置硬切出 `market screen` ——
 * 看着只是少了一个单词，实际把竖屏筛选整个丢掉了，捡回来的全是横屏素材，
 * 前面好不容易攒的竖屏命中率在这里白费。
 */

test("竖屏长词缩短后仍带 vertical", () => {
  assert.deepEqual(shortenTerms("vertical stock market screen"), ["vertical market screen", "vertical stock market"]);
});

test("竖屏三词本来就是最短形态，不再缩", () => {
  // vertical + 2 个实义词已经是竖屏词的长度上限，再缩会把画幅词挤掉
  assert.deepEqual(shortenTerms("vertical senate hearing"), []);
  assert.deepEqual(shortenTerms("vertical oil pump"), []);
});

test("横屏长词正常缩短，不加 vertical", () => {
  const out = shortenTerms("stock market screen close up");
  assert.deepEqual(out, ["market screen", "stock market"]);
  for (const term of out) assert.doesNotMatch(term, /vertical/);
});

test("两个词以内的词没有可缩空间", () => {
  assert.deepEqual(shortenTerms("vertical man"), []);
  assert.deepEqual(shortenTerms("stock chart"), []);
});

test("缩短结果不含多余空格，也不重复", () => {
  const out = shortenTerms("vertical data center corridor");
  assert.ok(out.length > 0);
  for (const term of out) {
    assert.equal(term, term.trim());
    assert.doesNotMatch(term, /\s{2,}/);
  }
  assert.equal(new Set(out).size, out.length);
});
