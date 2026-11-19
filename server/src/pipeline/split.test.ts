import assert from "node:assert/strict";
import test from "node:test";
import { splitContent } from "./split.js";

test("短句会合并到够长再断开", () => {
  assert.deepEqual(splitContent("第一句。第二句。第三句。"), ["第一句。第二句。第三句。"]);
});

test("长句各自成条", () => {
  const content = "这是一个很长的句子需要单独成行。这也是一个很长的句子需要单独成行。";
  assert.deepEqual(splitContent(content), ["这是一个很长的句子需要单独成行。", "这也是一个很长的句子需要单独成行。"]);
});

test("末尾过短的分片并入上一条", () => {
  const content = "这是一个很长的句子需要单独成行。短。";
  assert.deepEqual(splitContent(content), ["这是一个很长的句子需要单独成行。短。"]);
});

test("没有标点时整体返回", () => {
  assert.deepEqual(splitContent("没有标点的一句话"), ["没有标点的一句话"]);
});

test("空内容报错", () => {
  assert.throws(() => splitContent("   "), /台词内容为空/);
});
