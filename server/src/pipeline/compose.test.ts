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

/**
 * 回归：片头卡是靠 xfade 叠上来的，字幕若从交叉开始点就亮起，
 * 会直接压在还没退场的片头大字上（「老黄这次的回归」压「隐形推手」）。
 */
test("有片头卡时首段也要垫前置留白", () => {
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

  const opts = { titleDuration: 0, interval: 0, padLead: 0.5, padTail: 0.5 };
  const withoutCard = planParagraphs(transcript, audio, opts);
  assert.equal(withoutCard[0]?.padLead, 0, "没有片头时首段不该有前置留白");

  const withCard = planParagraphs(transcript, audio, { ...opts, leadCard: true });
  const first = withCard[0];
  assert.ok(first);
  near(first.padLead, 0.5);
  // 首句配音与字幕都要等片头退场后才开始
  near(first.sentences[0]?.start ?? -1, 0.5);
  near(first.cues[0]?.start ?? -1, 0.5);

  const withOutro = planParagraphs(transcript, audio, { ...opts, tailCard: true });
  near(withOutro[withOutro.length - 1]?.padTail ?? -1, 0.5);
  const plainOutro = planParagraphs(transcript, audio, opts);
  near(plainOutro[plainOutro.length - 1]?.padTail ?? -1, 0);
});

test("片段签名只随画面要素变化，与字幕无关", () => {
  const [plan] = planParagraphs(transcriptOf([{ speaker: "小简", contents: ["甲"] }]), audioOf([0.8]), TIMELINE);
  assert.ok(plan);

  const base = clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 24);
  assert.equal(base, clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 24));
  assert.notEqual(base, clipSignature(plan, path.join("missing", "a.mp4"), 1080, 1920, 30));
  assert.notEqual(base, clipSignature(plan, path.join("missing", "a.mp4"), 720, 1280, 24));
  assert.notEqual(base, clipSignature(plan, path.join("missing", "b.mp4"), 1080, 1920, 24));
  assert.notEqual(
    base,
    clipSignature(plan, [path.join("missing", "a.mp4"), path.join("missing", "b.mp4")], 1080, 1920, 24),
  );
  // 改字幕文案不该让片段缓存失效
  const edited = { ...plan, cues: plan.cues.map((cue) => ({ ...cue, text: `${cue.text}改` })) };
  assert.equal(base, clipSignature(edited, path.join("missing", "a.mp4"), 1080, 1920, 24));
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
  const fingerprint = "fp-abc123";
  const stamp = () => {
    const stat = fs.statSync(output);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  };

  // 合成中途被杀的残留文件：没有完成标记
  fs.writeFileSync(output, "partial");
  assert.equal(isComposedOutput(output, fingerprint), false);

  // 正常合完：指纹与文件戳都对得上
  fs.writeFileSync(marker, `${fingerprint}\n${stamp()}`, "utf-8");
  assert.equal(isComposedOutput(output, fingerprint), true);

  // 标记之后文件又被改过（截断/续写），同样不可复用
  fs.appendFileSync(output, "more");
  assert.equal(isComposedOutput(output, fingerprint), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 回归：以前标记只存大小与 mtime，于是改了转场/字号/静音间隔之后，
 * 旧成片照样命中缓存，表现为「参数改了没反应」。
 */
test("参数变了旧成片就不该复用", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aisv-compose-"));
  const output = path.join(dir, "_output.mp4");
  const marker = `${output}.ok`;
  const stamp = () => {
    const stat = fs.statSync(output);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  };

  fs.writeFileSync(output, "video");
  fs.writeFileSync(marker, `fp-old\n${stamp()}`, "utf-8");

  assert.equal(isComposedOutput(output, "fp-old"), true);
  // 文件没动，但这次的参数指纹不同：必须重合成
  assert.equal(isComposedOutput(output, "fp-new"), false);

  // 老格式标记（只有戳，没有指纹行）无法判断参数，一律当过期处理
  fs.writeFileSync(marker, stamp(), "utf-8");
  assert.equal(isComposedOutput(output, "fp-old"), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
