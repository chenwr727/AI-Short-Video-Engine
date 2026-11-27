import assert from "node:assert/strict";
import { test } from "node:test";
import { fitOrientation, isVisionUnsupported } from "./material.js";

/**
 * 画幅词兜底。
 *
 * 这组测试守的是一个用真实接口量出来的结论：
 * Pixabay 把 `vertical` 当画幅筛选词，但有它还不够 —— 词一长筛选就失效。
 * 实测竖屏占比：`vertical man` 85%、`vertical press` 70%、
 * `vertical stock chart` 45%、`vertical stock market screen` 10%、
 * 四词以上掉到 5%。所以竖屏词必须是 `vertical` + 最多 2 个实义词。
 */

test("竖屏：缺 vertical 时补上", () => {
  assert.deepEqual(fitOrientation(["stock chart"], true), ["vertical stock chart"]);
});

test("竖屏：已有 vertical 时不重复加", () => {
  assert.deepEqual(fitOrientation(["vertical stock chart"], true), ["vertical stock chart"]);
});

test("竖屏：大小写混写的 vertical 只保留一个", () => {
  assert.deepEqual(fitOrientation(["Vertical Stock Chart"], true), ["vertical stock chart"]);
});

test("竖屏：超长词截到 vertical + 2 个实义词", () => {
  // 四词以上的竖屏命中率只剩 5%，必须截断
  assert.deepEqual(fitOrientation(["vertical stock market screen close up"], true), ["vertical stock market"]);
  assert.deepEqual(fitOrientation(["businessman walking across empty office lobby"], true), [
    "vertical businessman walking",
  ]);
});

test("竖屏：标点被清掉，不会污染检索词", () => {
  assert.deepEqual(fitOrientation(["vertical, stock-chart!"], true), ["vertical stock chart"]);
});

test("横屏：去掉 vertical，横屏素材本来就充足", () => {
  assert.deepEqual(fitOrientation(["vertical press conference"], false), ["press conference"]);
});

test("横屏：不加 vertical，且最多留 4 个词", () => {
  assert.deepEqual(fitOrientation(["stock market screen close up detail"], false), ["stock market screen close"]);
});

test("空词或全是标点时原样返回，不产生没有内容的检索词", () => {
  assert.deepEqual(fitOrientation([""], true), [""]);
  assert.deepEqual(fitOrientation(["---"], true), ["---"]);
});

test("每个输出词都是非空且不含多余空格", () => {
  const out = fitOrientation(["  vertical   stock   chart  ", "stock chart"], true);
  for (const term of out) {
    assert.equal(term, term.trim());
    assert.doesNotMatch(term, /\s{2,}/);
    assert.ok(term.length > 0);
  }
});

/**
 * 视觉选片失败的分类。
 *
 * 这两类必须分开：模型不支持图片是「永久」的，后面每段再试都要白等一次
 * 240 秒超时；而超时、限流、格式错都是临时的，一旦误判成永久，
 * 后面所有段落都会退化成标签选片 —— Pexels 不返回标签，那等于盲选。
 */

test("模型不支持图片 → 永久关闭看图", () => {
  assert.equal(isVisionUnsupported(new Error("This model does not support image input")), true);
  assert.equal(isVisionUnsupported(new Error("invalid content type: image_url")), true);
  assert.equal(isVisionUnsupported(new Error("unsupported media type")), true);
  assert.equal(isVisionUnsupported(new Error("multimodal input not enabled")), true);
});

test("超时 / 限流 / 格式错 → 只影响当前段，下段继续看图", () => {
  assert.equal(isVisionUnsupported(new Error("视觉选片返回格式不符")), false);
  assert.equal(isVisionUnsupported(new Error("LLM 请求失败（429）：rate limit exceeded")), false);
  assert.equal(isVisionUnsupported(new Error("The operation was aborted due to timeout")), false);
  assert.equal(isVisionUnsupported(new Error("fetch failed")), false);
  assert.equal(isVisionUnsupported(new Error("LLM 请求失败（500）：nginx")), false);
});

test("非 Error 输入也能判断，不会抛异常", () => {
  assert.equal(isVisionUnsupported("does not support image"), true);
  assert.equal(isVisionUnsupported(undefined), false);
  assert.equal(isVisionUnsupported(null), false);
});
