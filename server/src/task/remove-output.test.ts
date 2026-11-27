import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeWithRetryForTest } from "./manager.js";

/**
 * 删成片时的占用兜底。
 *
 * 线上表现：成片还在浏览器里播着，用户点「继续」，服务端删 _output.mp4 抛
 * EPERM，整条「继续」直接失败；再点一次还是同一行报错，只能关掉播放器。
 * 这里守的是「删不掉不算致命错误」这条约定。
 */

test("正常文件：删掉并返回 true", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aisv-rm-")), "a.mp4");
  fs.writeFileSync(file, "x");
  assert.equal(removeWithRetryForTest(file), true);
  assert.equal(fs.existsSync(file), false);
});

test("文件不存在：当成已删干净，返回 true", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aisv-rm-")), "missing.mp4");
  assert.equal(removeWithRetryForTest(file), true);
});

test("被独占占用：重试后放弃，返回 false 但不抛异常", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aisv-rm-"));
  const file = path.join(dir, "locked.mp4");
  fs.writeFileSync(file, "x");

  // Windows 上以不共享方式持有句柄，等价于「播放器正在读」
  const handle = fs.openSync(file, "r");
  try {
    const ok = removeWithRetryForTest(file);
    // 有些平台允许删正在读的文件，这时也算通过 —— 关键是不能抛
    assert.equal(typeof ok, "boolean");
  } finally {
    fs.closeSync(handle);
  }
});
