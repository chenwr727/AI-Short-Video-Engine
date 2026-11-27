import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * 素材页「重新生成」后界面自己跳到成片预览。
 *
 * 用户没点下一步，素材还在第 6/6 段，页面却翻到了成片预览。
 * 原因是 phases.ts 用 task.material 有没有值判断素材是否完成，
 * 而重新匹配期间 executeMatch 会逐段把部分清单挂到 state.material 上
 * （第 1 段下载完就非空了）；再看到上一轮遗留的 cards 非空，
 * running 分支就一路走到 result。
 *
 * 这里不 import web 的类型文件：server 是 NodeNext 解析，web 是 Bundler，
 * 跨包引用会让 server 用另一套规则重编 web 源码（要求 .js 扩展名）而报错。
 * 所以只按运行时行为验证纯函数。
 */
const { derivePhase, materialDone, reachedIndex } = (await import(
  new URL("../../../web/src/phases.ts", import.meta.url).href
)) as {
  derivePhase: (task: unknown) => string | null;
  materialDone: (task: unknown) => boolean;
  reachedIndex: (task: unknown) => number;
};

type Fake = Record<string, unknown>;

function makeState(overrides: {
  status?: string;
  stages?: Record<string, string>;
  hasMaterial?: boolean;
  hasCards?: boolean;
  hasAudio?: boolean;
}): Fake {
  const order = ["fetch", "write", "rewrite", "split", "tts", "material", "cards", "compose"];
  const statuses = overrides.stages ?? {};
  return {
    id: "t",
    input: "",
    options: {},
    workspace: "/tmp/ws",
    status: overrides.status ?? "running",
    stages: order
      .filter((id) => statuses[id] !== "absent")
      .map((id) => ({ id, label: id, status: statuses[id] ?? "done", message: "" })),
    logs: [],
    transcript: {},
    audio: overrides.hasAudio === false ? null : {},
    material: overrides.hasMaterial === false ? null : {},
    cards: overrides.hasCards === false ? null : {},
    cardPrefs: null,
    result: null,
    error: null,
    createdAt: "",
    updatedAt: "",
  };
}

test("重新匹配素材中途：已挂部分清单 + 上一轮卡片，也不能跳到成片预览", () => {
  const state = makeState({
    status: "running",
    stages: { material: "running", cards: "done", compose: "pending" },
    hasMaterial: true,
    hasCards: true,
  });
  assert.equal(derivePhase(state), "material");
});

test("重新匹配素材中途：清空了素材、卡片还在，同样停在素材页", () => {
  const state = makeState({
    status: "running",
    stages: { material: "running", cards: "pending", compose: "pending" },
    hasMaterial: false,
    hasCards: true,
  });
  assert.equal(derivePhase(state), "material");
});

test("素材跑完、版式还没跑：停在素材页等版式生成", () => {
  const state = makeState({
    status: "running",
    stages: { material: "done", cards: "running", compose: "pending" },
    hasMaterial: true,
    hasCards: false,
  });
  assert.equal(derivePhase(state), "material");
});

test("素材与版式都跑完：才进成片预览", () => {
  const state = makeState({
    status: "running",
    stages: { material: "done", cards: "done", compose: "pending" },
    hasMaterial: true,
    hasCards: true,
  });
  assert.equal(derivePhase(state), "result");
});

test("没开版式的任务：素材跑完即进成片预览", () => {
  const state = makeState({
    status: "running",
    stages: { material: "done", cards: "absent", compose: "pending" },
    hasMaterial: true,
    hasCards: false,
  });
  assert.equal(derivePhase(state), "result");
});

test("materialDone 只看阶段状态，不看部分清单", () => {
  assert.equal(materialDone(makeState({ stages: { material: "running" }, hasMaterial: true })), false);
  assert.equal(materialDone(makeState({ stages: { material: "done" }, hasMaterial: false })), true);
  assert.equal(materialDone(makeState({ stages: { material: "skipped" } })), true);
  assert.equal(materialDone(makeState({ stages: { material: "absent" } })), true);
});

test("步骤条最远位置：重新匹配时不把成片预览点亮", () => {
  const state = makeState({
    status: "running",
    stages: { material: "running", cards: "done", compose: "pending" },
    hasMaterial: true,
    hasCards: true,
  });
  // 5 步里 material 是 index 3，result 是 index 4
  assert.equal(reachedIndex(state), 3);
});
