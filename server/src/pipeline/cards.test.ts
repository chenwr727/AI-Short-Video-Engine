import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, type AppConfig } from "../config.js";
import type { Transcript } from "../types.js";
import { buildCards, cardDefaults, cardPlan, cardsEnabled, MAX_CHAPTER_CARDS } from "./cards.js";

const cfg = (patch: Record<string, string>): AppConfig => patch as unknown as AppConfig;

/** 只关心段数，标题取段号，便于断言 */
const transcriptOf = (count: number): Transcript => ({
  title: "测试标题",
  paragraphs: Array.from({ length: count }, (_, index) => ({
    description: `第 ${index + 1} 段描述`,
    dialogues: [{ speaker: "甲", contents: [`第 ${index + 1} 段首句`], contentsTts: [`第 ${index + 1} 段首句`] }],
  })),
});

test("补建只产出请求的类型，时长用传入的绝对秒数", () => {
  const items = buildCards(cfg({}), transcriptOf(4), ["intro"], { intro: 1.5 }, "#ff5a3c", 1080, 1920, 24);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "intro");
  assert.equal(items[0]?.durationSec, 1.5);
  assert.equal(items[0]?.title, "测试标题");
});

test("补建章节卡从第 2 段开始，不出第 1 段", () => {
  const items = buildCards(cfg({}), transcriptOf(3), ["chapter"], { chapter: 2 }, "#ff5a3c", 1080, 1920, 24);
  assert.deepEqual(
    items.map((item) => item.id),
    ["chapter-2", "chapter-3"],
  );
  assert.equal(items[0]?.title, "第 2 段首句");
});

test("补建章节卡不超过上限，段数很少时只有 1 段也不出", () => {
  const many = buildCards(cfg({}), transcriptOf(20), ["chapter"], { chapter: 2 }, "#ff5a3c", 1080, 1920, 24);
  assert.equal(many.length, MAX_CHAPTER_CARDS);

  const single = buildCards(cfg({}), transcriptOf(1), ["chapter"], { chapter: 2 }, "#ff5a3c", 1080, 1920, 24);
  assert.equal(single.length, 0);
});

test("补建片尾时用配置里的文案与账号", () => {
  const items = buildCards(
    cfg({ OUTRO_TITLE: "记得三连", OUTRO_HANDLE: "@某某" }),
    transcriptOf(3),
    ["outro"],
    { outro: 3 },
    "#ff5a3c",
    1080,
    1920,
    24,
  );
  assert.equal(items[0]?.title, "记得三连");
  assert.equal(items[0]?.handle, "@某某");
  assert.equal(items[0]?.durationSec, 3);
});

test("wanted 为空时不补任何卡", () => {
  assert.equal(buildCards(cfg({}), transcriptOf(5), [], {}, "#ff5a3c", 1080, 1920, 24).length, 0);
});

test("三个按钮全关时按配置里的时长出片头与章节卡", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "1.6", CHAPTER_DURATION: "2" }), 6);
  assert.deepEqual(plan, { introSec: 1.6, chapterSec: 2, outroSec: 0, auto: true });
});

/**
 * 回归：以前默认模式下 TITLE_DURATION 的 0 会被默认 1.6 顶掉，
 * 用户填 0 却照样出片头，提示文案与实际行为正好相反。
 */
test("默认模式下片头时长填 0 就是不显示片头", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "0", CHAPTER_DURATION: "2" }), 6);
  assert.equal(plan.introSec, 0);
  assert.equal(plan.auto, true);
});

test("默认模式下片头时长没配时按 0 处理，不偷偷补默认值", () => {
  const plan = cardPlan(cfg({}), 6);
  assert.equal(plan.introSec, 0);
  assert.equal(plan.auto, true);
});

/**
 * 回归：以前默认模式把章节时长写死 2 秒，用户填的值被忽略。
 */
test("默认模式下过场卡时长按配置走", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "1.6", CHAPTER_DURATION: "3" }), 6);
  assert.equal(plan.chapterSec, 3);
});

test("默认模式下过场卡时长填 0 就不出章节卡", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "1.6", CHAPTER_DURATION: "0" }), 6);
  assert.equal(plan.chapterSec, 0);
  assert.equal(plan.introSec, 1.6);
});

/**
 * 版式页现在能直接改三类时长，覆盖必须是「绝对取值」语义：
 * 0 表示这次关掉，不能因为配置里开着就又被填回来。
 */
test("任务级覆盖优先于配置，且 0 能关掉配置里开着的卡", () => {
  const base = cfg({ INTRO_ENABLED: "1", TITLE_DURATION: "2", CHAPTER_CARD: "1", OUTRO_DURATION: "3" });

  const off = cardPlan(base, 6, { introDurationSec: 0, outroDurationSec: 0 });
  assert.equal(off.introSec, 0);
  assert.equal(off.outroSec, 0);

  const changed = cardPlan(base, 6, { introDurationSec: 1, chapterDurationSec: 4, outroDurationSec: 5 });
  assert.equal(changed.introSec, 1);
  assert.equal(changed.chapterSec, 4);
  assert.equal(changed.outroSec, 5);
});

test("覆盖为 0 时不会凭空造出配置里没开的卡", () => {
  // 配置里三类都没开，覆盖成 0 依旧是 0，而不是回落到配置的兜底值
  const plan = cardPlan(cfg({}), 6, { introDurationSec: 0, chapterDurationSec: 0 });
  assert.equal(plan.introSec, 0);
  assert.equal(plan.chapterSec, 0);
});

test("只用片头时长覆盖时，另两类仍跟随配置", () => {
  const plan = cardPlan(cfg({ CHAPTER_CARD: "1", CHAPTER_DURATION: "2.5" }), 6, { introDurationSec: 1.2 });
  assert.equal(plan.introSec, 1.2);
  assert.equal(plan.chapterSec, 2.5);
});

test("只开片头时另外两类为 0", () => {
  const plan = cardPlan(cfg({ INTRO_ENABLED: "1", TITLE_DURATION: "2" }), 6);
  assert.deepEqual(plan, { introSec: 2, chapterSec: 0, outroSec: 0, auto: false });
});

test("只开章节卡但段落不足时不出章节，也不误判成默认", () => {
  const plan = cardPlan(cfg({ CHAPTER_CARD: "1", CHAPTER_DURATION: "2" }), 1);
  assert.deepEqual(plan, { introSec: 0, chapterSec: 0, outroSec: 0, auto: false });
});

test("只开片尾时照常生成，且不触发默认", () => {
  const plan = cardPlan(cfg({ OUTRO_DURATION: "3" }), 6);
  assert.deepEqual(plan, { introSec: 0, chapterSec: 0, outroSec: 3, auto: false });
});

test("片头 + 章节卡 + 片尾全开时按配置走", () => {
  const plan = cardPlan(cfg({ INTRO_ENABLED: "1", TITLE_DURATION: "2", CHAPTER_CARD: "1", OUTRO_DURATION: "3" }), 4);
  assert.deepEqual(plan, { introSec: 2, chapterSec: 2, outroSec: 3, auto: false });
});

test("手动选了章节时长就以它为准", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "1.6", CHAPTER_DURATION: "2" }), 6, { chapterDurationSec: 3 });
  assert.equal(plan.chapterSec, 3);
  assert.equal(plan.introSec, 1.6);
});

/**
 * 版式页能直接改时长后，显式给非 0 就是「这次我要这类卡」：
 * 配置里没开章节卡，用户把章节卡从 0 填成 3，卡就应该出现。
 */
test("显式给出的章节时长会把配置里没开的章节卡打开", () => {
  const plan = cardPlan(cfg({ INTRO_ENABLED: "1", TITLE_DURATION: "2" }), 6, { chapterDurationSec: 3 });
  assert.equal(plan.chapterSec, 3);
  assert.equal(plan.introSec, 2);
});

test("段落只有一段时，再显式给时长也出不了章节卡", () => {
  const plan = cardPlan(cfg({}), 1, { chapterDurationSec: 3 });
  assert.equal(plan.chapterSec, 0);
});

/**
 * 版式页显示的「当前配置」和真正出片必须同源，
 * 否则页面写着 2s、成片却是 3s，用户只会觉得设置不生效。
 */
test("版式页用的 cardDefaults 与实际出片一致", () => {
  const cases: Record<string, string>[] = [
    {},
    { TITLE_DURATION: "2", CHAPTER_DURATION: "3" },
    { INTRO_ENABLED: "1", TITLE_DURATION: "1.6", CHAPTER_CARD: "1", CHAPTER_DURATION: "2.5", OUTRO_DURATION: "3" },
    { OUTRO_DURATION: "4" },
  ];

  for (const patch of cases) {
    const defaults = cardDefaults(cfg(patch));
    // 段落足够多时，章节卡不会被砍掉，两者应当逐项相等
    const plan = cardPlan(cfg(patch), MAX_CHAPTER_CARDS + 1);
    assert.equal(plan.introSec, defaults.introSec, `片头不一致：${JSON.stringify(patch)}`);
    assert.equal(plan.chapterSec, defaults.chapterSec, `章节不一致：${JSON.stringify(patch)}`);
    assert.equal(plan.outroSec, defaults.outroSec, `片尾不一致：${JSON.stringify(patch)}`);
    assert.equal(plan.auto, defaults.auto, `默认标记不一致：${JSON.stringify(patch)}`);
  }
});

test("段落太少时只砍章节卡，片头片尾照旧", () => {
  const patch = { INTRO_ENABLED: "1", TITLE_DURATION: "1.6", CHAPTER_CARD: "1", OUTRO_DURATION: "3" };
  const plan = cardPlan(cfg(patch), 1);
  assert.equal(plan.chapterSec, 0);
  assert.equal(plan.introSec, 1.6);
  assert.equal(plan.outroSec, 3);
});

/**
 * 默认配置（CARDS_ENABLED=1，三个卡片开关全关）就应产出片头 + 章节卡，
 * 只在设置页改时长即可调，不需要用户额外开开关。
 */
test("默认配置下开箱就有片头与章节卡", () => {
  const plan = cardPlan(DEFAULTS, 6);
  assert.deepEqual(plan, { introSec: 1.6, chapterSec: 2, outroSec: 0, auto: true });
  assert.equal(cardsEnabled(DEFAULTS), true);
});
