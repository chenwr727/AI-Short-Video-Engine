import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSpeaker } from "./config.js";
import { ERRORS, errorMessage, STAGE_TEXT, stageText, TaskError, userError, userText } from "./errors.js";
import { LOG_TEXT, logText } from "./logs.js";

/** 占位符名字排序后拼成可比较的串 */
function placeholders(template: string): string {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
}

// 三张表都要守同样的规矩：少一条英文，英文界面就漏中文；占位符对不上会残留 {n}
for (const [name, table] of [
  ["ERRORS", ERRORS],
  ["STAGE_TEXT", STAGE_TEXT],
  ["LOG_TEXT", LOG_TEXT],
] as const) {
  test(`${name} 中英齐全，且占位符一致`, () => {
    for (const [key, text] of Object.entries(table)) {
      assert.ok(text.zh.trim(), `${key} 缺中文`);
      assert.ok(text.en.trim(), `${key} 缺英文`);
      assert.ok(!/[\u4e00-\u9fff]/.test(text.en), `${key} 的英文里混进了汉字`);
      assert.equal(placeholders(text.en), placeholders(text.zh), `${key} 的中英占位符不一致`);
    }
  });
}

test("问号和未替换模板不会被当成角色名", () => {
  assert.equal(normalizeSpeaker("??", "小简"), "小简");
  assert.equal(normalizeSpeaker("？？", "老陈"), "老陈");
  assert.equal(normalizeSpeaker("script.speakerMain", "小简"), "小简");
  assert.equal(normalizeSpeaker("{{SPEAKER_MAIN}}", "小简"), "小简");
  assert.equal(normalizeSpeaker("  小简  ", "老陈"), "小简");
});

test("同一个错误按请求语言渲染", () => {
  assert.equal(userText("noTask", "zh"), "当前没有任务");
  assert.equal(userText("noTask", "en"), "There's no task yet");
  assert.equal(errorMessage(userError("notEditable", 400), "en"), "The task can't be edited");
  assert.equal(errorMessage(userError("notEditable", 400), "zh"), "当前任务不可编辑");
});

test("占位符和双语变量都按语言填", () => {
  const paragraph = userError("noMaterialForParagraph", 400, { n: 3 });
  assert.equal(errorMessage(paragraph, "zh"), "第 3 段还没有素材");
  assert.equal(errorMessage(paragraph, "en"), "Section 3 has no footage yet");

  // label 是双语变量：两种语言下用各自的字段名
  const duration = userError("durationRange", 400, { label: { zh: "片头", en: "Intro" } });
  assert.equal(errorMessage(duration, "zh"), "片头时长要在 0–15 秒之间");
  assert.equal(errorMessage(duration, "en"), "Intro duration must be between 0 and 15 seconds");
});

test("阶段进度与日志在落盘前就把占位符填好", () => {
  assert.equal(stageText("cached").zh, "命中缓存");
  assert.equal(stageText("progress", { i: 2, total: 5 }).en, "Section 2/5");
  assert.equal(stageText("progressPercent", { i: 1, total: 3, percent: 40 }).zh, "第 1/3 段 40%");

  const match = logText("matchStart", { n: 2, sec: "4.2", terms: "city night" });
  assert.equal(match.zh, "第 2 段匹配素材（需 4.2s）：city night");
  assert.equal(match.en, "Matching section 2 (needs 4.2s): city night");
  assert.equal(logText("cancelled").en, "Task cancelled");
});

test("内部错误原样透出，不做翻译", () => {
  const internal = new TaskError("remotion exited with code 1", 500);
  assert.equal(errorMessage(internal, "en"), "remotion exited with code 1");
  assert.equal(errorMessage(internal, "zh"), "remotion exited with code 1");
  assert.equal(errorMessage(new Error("boom"), "zh"), "boom");
  assert.equal(errorMessage("plain", "en"), "plain");
});

test("statusCode 跟着抛错处走", () => {
  assert.equal(userError("busy", 409).statusCode, 409);
  // message 落中文且已填好占位符，日志与兜底路径看到的都是它
  assert.equal(userError("busy", 409).message, ERRORS.busy.zh);
});
