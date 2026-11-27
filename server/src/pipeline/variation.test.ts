import assert from "node:assert/strict";
import test from "node:test";
import { seedFrom, shuffle, shuffledIndex } from "./variation.js";

/**
 * 这组测试防的是「每条视频长得一样」。
 *
 * 之前的实现是 `plan.index % 4` 与固定轮换，于是任何视频的第 1 段都推、
 * 第 2 段都拉，画面骨架完全一致。现在改由种子洗牌，必须保证：
 *   1. 换种子 → 顺序确实变了（否则等于没改）；
 *   2. 同种子 → 结果完全一致（否则缓存失效、重渲画面还会漂）。
 */

test("同一种子洗牌结果完全一致", () => {
  const items = [0, 1, 2, 3, 4, 5];
  const a = shuffle(items, seedFrom("同一篇稿子"));
  const b = shuffle(items, seedFrom("同一篇稿子"));
  assert.deepEqual(a, b);
});

test("不同种子洗牌结果不同", () => {
  const items = [0, 1, 2, 3, 4, 5];
  const a = shuffle(items, seedFrom("选题 A"));
  const b = shuffle(items, seedFrom("选题 B"));
  assert.notDeepEqual(a, b);
});

test("洗牌是排列而非丢弃：元素一个不多一个不少", () => {
  const items = [0, 1, 2, 3];
  const out = shuffle(items, seedFrom("任意标题"));
  assert.equal(out.length, items.length);
  assert.deepEqual([...out].sort(), [...items].sort());
});

test("洗牌不改动入参", () => {
  const items = [0, 1, 2, 3];
  shuffle(items, 12345);
  assert.deepEqual(items, [0, 1, 2, 3]);
});

test("空数组与单元素不崩", () => {
  assert.deepEqual(shuffle([], 42), []);
  assert.deepEqual(shuffle([7], 42), [7]);
  assert.equal(shuffledIndex(1, 1, 42), 0);
});

/**
 * 关键回归：旧实现下「第 1 段永远推」，所有视频都一样。
 * 现在不同种子应当让第 1 段落到不同的运镜上。
 */
test("不同视频的第 1 段不再固定同一种运镜", () => {
  const seeds = ["选题一", "选题二", "选题三", "选题四"].map((title) => seedFrom(title));
  const firsts = seeds.map((seed) => shuffledIndex(1, 4, seed));
  // 4 个种子不该全都得到同一个下标
  assert.ok(new Set(firsts).size > 1, `第 1 段运镜全都一样：${firsts.join(",")}`);
});

test("同一段落在同一种子下稳定，缓存才有意义", () => {
  const seed = seedFrom("固定选题");
  const first = shuffledIndex(3, 4, seed);
  const again = shuffledIndex(3, 4, seed);
  assert.equal(first, again);
});

test("段落数超过池子大小时循环取用，不越界", () => {
  const seed = seedFrom("长视频");
  for (let index = 1; index <= 20; index++) {
    const hit = shuffledIndex(index, 4, seed);
    assert.ok(hit >= 0 && hit < 4, `第 ${index} 段落算出越界下标：${hit}`);
  }
});

test("四个连续段落覆盖池子里全部运镜，不会连续重复同一种", () => {
  const seed = seedFrom("覆盖检查");
  const got = [1, 2, 3, 4].map((index) => shuffledIndex(index, 4, seed));
  assert.equal(new Set(got).size, 4, `前四段应覆盖四种运镜，实际：${got.join(",")}`);
});

test("下标从 1 起，但传 0 或负数也不能返回 undefined", () => {
  /*
   * (index - 1) % count 在 index=0 时得到 -1，order[-1] 是 undefined。
   * 调用方目前都从 1 开始，但把这种假设留给运行时太脆弱。
   */
  const seed = seedFrom("边界");
  for (const index of [0, -1, -5]) {
    const hit = shuffledIndex(index, 4, seed);
    assert.equal(typeof hit, "number", `index=${index} 返回了 ${hit}`);
    assert.ok(hit >= 0 && hit < 4, `index=${index} 越界：${hit}`);
  }
});
