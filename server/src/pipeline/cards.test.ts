import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config.js";
import { cardPlan } from "./cards.js";

const cfg = (patch: Record<string, string>): AppConfig => patch as unknown as AppConfig;

test("三个按钮全关时按默认出片头与章节卡", () => {
  const plan = cardPlan(cfg({ TITLE_DURATION: "1.6", CHAPTER_DURATION: "2" }), 6);
  assert.deepEqual(plan, { introSec: 1.6, chapterSec: 2, outroSec: 0, auto: true });
});

test("片头时长没配时用默认 1.6 秒", () => {
  const plan = cardPlan(cfg({}), 6);
  assert.equal(plan.introSec, 1.6);
  assert.equal(plan.auto, true);
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

test("本来就不出章节卡时，手动时长不硬开", () => {
  const plan = cardPlan(cfg({ INTRO_ENABLED: "1", TITLE_DURATION: "2" }), 6, { chapterDurationSec: 3 });
  assert.equal(plan.chapterSec, 0);
});
