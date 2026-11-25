import assert from "node:assert/strict";
import test from "node:test";
import { charsPerLine, escapeAssText, wrapAssText } from "./subtitle.js";

/** 96 号字在 1080 宽、左右各 108 边距下的容量 */
const MAX96 = charsPerLine(1080 - 108 - 108, 96);

function linesOf(text: string, maxChars = MAX96): string[] {
  return wrapAssText(escapeAssText(text), maxChars).split("\\N");
}

test("短到放得下时不折行", () => {
  assert.deepEqual(linesOf("就这一句"), ["就这一句"]);
});

test("折行后拼回去与原文逐字一致", () => {
  const texts = [
    "本来大家都以为要等到周日，结果昨晚他人就回来了。",
    "倒黄的主力，其实是共和党里的强硬派。",
    "一跌狠了，董事会和两党，谁都坐不住。",
  ];
  for (const text of texts) {
    assert.equal(linesOf(text).join(""), text);
  }
});

test("每行都不超过容量", () => {
  const text = "他说这句话的时候，语气里带着一种说不出的疲惫。";
  for (const line of linesOf(text)) {
    assert.ok([...line].length <= MAX96, `「${line}」超出行宽`);
  }
});

test("标点不落在行首", () => {
  const texts = [
    "本来大家都以为要等到周日，结果昨晚他人就回来了。",
    "倒黄的主力，其实是共和党里的强硬派。",
    "这一波操作让整个行业都没想到，连对手都愣住了。",
  ];
  for (const text of texts) {
    for (const line of linesOf(text).slice(1)) {
      assert.doesNotMatch(line, /^[，。、；：！？）】」』]/, `「${line}」以标点开头`);
    }
  }
});

/**
 * 回归：单字虚词不该孤零零挂在行尾。
 * 曾经「本来大家都以为要|等到周日」把助动词「要」悬在行尾，是本轮修掉的问题。
 */
test("单字虚词不悬在行尾", () => {
  const lines = linesOf("本来大家都以为要等到周日，结果昨晚他人就回来了。");
  assert.ok(!lines.slice(0, -1).some((line) => /[要会能想让把被给跟和与及或向从对]$/.test(line)), lines.join(" / "));
});

test("不产生明显过短的行", () => {
  const texts = [
    "本来大家都以为要等到周日，结果昨晚他人就回来了。",
    "他说这句话的时候，语气里带着一种说不出的疲惫。",
    "如果他们真的决定这么做，那我们就只能另想办法了。",
  ];
  for (const text of texts) {
    const lens = linesOf(text).map((line) => [...line].length);
    assert.ok(Math.min(...lens) >= 4, `出现 ${Math.min(...lens)} 字的畸短行：${linesOf(text).join(" / ")}`);
  }
});

test("转义后不再含可能破坏 ASS 解析的字符", () => {
  const escaped = escapeAssText("他说：{这里}要用\\斜杠");
  assert.doesNotMatch(escaped, /[{}]/);
  assert.doesNotMatch(escaped, /\\/);
});

test("字号越大每行能放的字越少", () => {
  const area = 1080 - 108 - 108;
  assert.ok(charsPerLine(area, 96) < charsPerLine(area, 72));
  assert.equal(charsPerLine(area, 0), 0);
});
