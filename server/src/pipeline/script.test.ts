import assert from "node:assert/strict";
import test from "node:test";
import type { RawTranscript } from "../types.js";
import { parseCritique, scriptIssues, scriptRules } from "./script.js";

const RULES = scriptRules("podcast", { main: "小简", guest: "老陈" });
const LINE = "一二三四五六七八九十一二三四五六七八九十一二三四五";

function makeScript(paragraphs = 4, turns = 7, content = LINE): RawTranscript {
  return {
    title: "短标题",
    paragraphs: Array.from({ length: paragraphs }, (_, p) => ({
      description: `第 ${p + 1} 段`,
      dialogues: Array.from({ length: turns }, (_, d) => ({
        speaker: d % 2 === 0 ? "小简" : "老陈",
        content,
      })),
    })),
  };
}

test("合规剧本没有意见", () => {
  assert.deepEqual(scriptIssues(makeScript(), RULES), []);
});

test("缺标题要修", () => {
  const issues = scriptIssues({ ...makeScript(), title: "" }, RULES);
  assert.ok(issues.some((issue) => issue.includes("title")));
});

test("陌生角色要修", () => {
  const script = makeScript();
  script.paragraphs[0]!.dialogues[0] = { speaker: "主持人", content: LINE };
  const issues = scriptIssues(script, RULES);
  assert.ok(issues.some((issue) => issue.includes("主持人")));
});

test("Markdown 与括号注释要修", () => {
  const script = makeScript(4, 7);
  script.paragraphs[0]!.dialogues[0]!.content = "**重点**这句台词。";
  script.paragraphs[1]!.dialogues[0]!.content = "（笑）这句台词。";
  const issues = scriptIssues(script, RULES);
  assert.ok(issues.some((issue) => issue.includes("Markdown")));
  assert.ok(issues.some((issue) => issue.includes("括号")));
});

test("段落数与字数偏少要修", () => {
  const issues = scriptIssues(makeScript(2), RULES);
  assert.ok(issues.some((issue) => issue.includes("段落数")));
  assert.ok(issues.some((issue) => issue.includes("总字数")));
});

test("单句过长要修", () => {
  const issues = scriptIssues(makeScript(4, 7, "一".repeat(30)), RULES);
  assert.ok(issues.some((issue) => issue.includes("单句")));
});

test("审稿结果解析与百分制兼容", () => {
  const direct = parseCritique('{"overall":0.87,"issues":["开头太慢"]}');
  assert.deepEqual(direct, { overall: 0.87, issues: ["开头太慢"] });

  const percent = parseCritique('{"overall":85}');
  assert.equal(percent?.overall, 0.85);

  const averaged = parseCritique('{"scores":{"hook":0.8,"style":0.6}}');
  assert.equal(averaged?.overall, 0.7);

  assert.equal(parseCritique("没有 JSON"), null);
});
