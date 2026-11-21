import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AudioManifest, Transcript } from "../types.js";
import { clipSignature, isComposedOutput, planParagraphs, shotDurations } from "./compose.js";

const TIMELINE = { titleDuration: 1.6, interval: 0.2, padLead: 0, padTail: 0 };

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

function transcriptOf(dialogues: { speaker: string; contents: string[] }[]): Transcript {
  return {
    title: "标题",
    paragraphs: [{ description: "", dialogues: dialogues.map((d) => ({ ...d, contentsTts: [...d.contents] })) }],
  };
}

function audioOf(durations: number[]): AudioManifest {
  const files = durations.map((duration, i) => ({ file: `1_1_${i + 1}.mp3`, duration, text: `第${i + 1}句` }));
  const total = durations.reduce((sum, d) => sum + d, 0);
  return {
    engine: "edge",
    model: "test",
    totalDuration: total,
    paragraphs: [{ index: 1, duration: total, dialogues: [{ speaker: "小简", voice: "v", duration: total, files }] }],
  };
}

test("标题插在首句前，句间留间隔", () => {
  const [plan] = planParagraphs(
    transcriptOf([{ speaker: "小简", contents: ["甲", "乙"] }]),
    audioOf([0.8, 0.7]),
    TIMELINE,
  );
  assert.ok(plan);

  assert.deepEqual(plan.cues[0], { text: "标题", start: 0, end: 1.6, style: "Title" });
  near(plan.sentences[0]?.start ?? -1, 1.6);
  near(plan.cues[1]?.start ?? -1, 1.6);
  near(plan.cues[1]?.end ?? -1, 2.4);
  near(plan.cues[2]?.start ?? -1, 2.6);
  near(plan.duration, 3.3);
});

test("多段时只有中间段落垫首尾留白", () => {
  const transcript: Transcript = {
    title: "标题",
    paragraphs: [
      { description: "", dialogues: [{ speaker: "小简", contents: ["甲"], contentsTts: ["甲"] }] },
      { description: "", dialogues: [{ speaker: "小简", contents: ["乙"], contentsTts: ["乙"] }] },
    ],
  };
  const audio = audioOf([0.8]);
  const files = audio.paragraphs[0]?.dialogues[0]?.files ?? [];
  audio.paragraphs.push({
    index: 2,
    duration: 0.8,
    dialogues: [{ speaker: "小简", voice: "v", duration: 0.8, files }],
  });
  audio.totalDuration = 1.6;

  const plans = planParagraphs(transcript, audio, { ...TIMELINE, padLead: 0.5, padTail: 0.5 });
  assert.equal(plans.length, 2);

  const [first, second] = plans;
  assert.ok(first && second);
  assert.equal(first.padLead, 0);
  near(first.padTail, 0.5);
  near(first.duration, 2.9);

  near(second.padLead, 0.5);
  assert.equal(second.padTail, 0);
  near(second.sentences[0]?.start ?? -1, 0.7);
  near(second.duration, 1.5);
});

test("片段签名随字号与素材变化", () => {
  const [plan] = planParagraphs(transcriptOf([{ speaker: "小简", contents: ["甲"] }]), audioOf([0.8]), TIMELINE);
  assert.ok(plan);

  const base = clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 24, 72);
  assert.equal(base, clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 24, 72));
  assert.notEqual(base, clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 24, 80));
  assert.notEqual(base, clipSignature(plan, path.join("missing", "b.mp4"), 1080, 1920, 24, 72));
  assert.notEqual(
    base,
    clipSignature(plan, [path.join("missing", "a.mp4"), path.join("missing", "b.mp4")], 1080, 1920, 24, 72),
  );
});

test("段内切镜按句子边界切，总时长不变", () => {
  const [plan] = planParagraphs(
    transcriptOf([{ speaker: "小简", contents: ["甲", "乙", "丙", "丁"] }]),
    audioOf([1, 1, 1, 1]),
    { titleDuration: 0, interval: 0, padLead: 0, padTail: 0 },
  );
  assert.ok(plan);

  near(plan.duration, 4);
  assert.deepEqual(shotDurations(plan, 1), [4]);

  const two = shotDurations(plan, 2);
  assert.equal(two.length, 2);
  near(
    two.reduce((sum, d) => sum + d, 0),
    4,
  );
  near(two[0] ?? 0, 2);

  const three = shotDurations(plan, 3);
  assert.equal(three.length, 3);
  near(
    three.reduce((sum, d) => sum + d, 0),
    4,
  );
  near(three[0] ?? 0, 1);
});

test("没写完的成片不算完整产物，不能当缓存复用", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aisv-compose-"));
  const output = path.join(dir, "_output.mp4");
  const marker = `${output}.ok`;
  const stamp = () => {
    const stat = fs.statSync(output);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  };

  // 合成中途被杀的残留文件：没有完成标记
  fs.writeFileSync(output, "partial");
  assert.equal(isComposedOutput(output), false);

  // 正常合完：标记与文件对得上
  fs.writeFileSync(marker, stamp(), "utf-8");
  assert.equal(isComposedOutput(output), true);

  // 标记之后文件又被改过（截断/续写），同样不可复用
  fs.appendFileSync(output, "more");
  assert.equal(isComposedOutput(output), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
