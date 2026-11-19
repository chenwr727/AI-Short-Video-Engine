import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { AudioManifest, Transcript } from "../types.js";
import { clipSignature, planParagraphs } from "./compose.js";

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
});
