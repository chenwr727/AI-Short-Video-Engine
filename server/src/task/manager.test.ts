import assert from "node:assert/strict";
import { test } from "node:test";
import { nextResumeStep } from "./manager.js";
import type { TaskState } from "../types.js";

/**
 * 「继续」该从哪一步接。
 *
 * 这组测试守的是一个线上踩到的问题：素材重新匹配跑到第 2 段就断了，
 * 点「继续」却直接跳去合成成片 —— 因为判断用的是 state.cards 有没有值，
 * 而那 6 张卡是上一轮留下的。结果就是拿过期的素材清单去出片。
 */
function makeState(overrides: {
  stages: Record<string, string>;
  hasTranscript?: boolean;
  hasAudio?: boolean;
  hasMaterial?: boolean;
  /** 上一轮遗留的卡片，故意与阶段状态脱钩 */
  hasCards?: boolean;
}): TaskState {
  const order = ["fetch", "write", "rewrite", "split", "tts", "material", "cards", "compose"];
  const labels: Record<string, string> = {
    fetch: "抓取",
    write: "撰写",
    rewrite: "改写",
    split: "分段",
    tts: "配音",
    material: "素材",
    cards: "版式",
    compose: "合成",
  };
  return {
    id: "t",
    input: "",
    options: {} as TaskState["options"],
    workspace: "/tmp/ws",
    status: "failed",
    stages: order
      .filter((id) => overrides.stages[id] !== "absent")
      .map((id) => ({
        id,
        label: labels[id] ?? id,
        status: (overrides.stages[id] ?? "done") as TaskState["stages"][number]["status"],
        message: "",
      })),
    logs: [],
    transcript: (overrides.hasTranscript ?? true) ? ({} as TaskState["transcript"]) : null,
    audio: (overrides.hasAudio ?? true) ? ({} as TaskState["audio"]) : null,
    material: (overrides.hasMaterial ?? true) ? ({} as TaskState["material"]) : null,
    cards: (overrides.hasCards ?? true) ? ({} as TaskState["cards"]) : null,
    cardPrefs: null,
    result: null,
    error: null,
    createdAt: "",
    updatedAt: "",
  };
}

test("素材匹配中断：即使有上一轮的卡片，也先回去补齐素材", () => {
  const state = makeState({ stages: { material: "failed", cards: "done", compose: "pending" }, hasCards: true });
  assert.equal(nextResumeStep(state), "match");
});

test("素材被标成 skipped（取消后已收尾）：不重跑素材，接着做卡片", () => {
  /*
   * skipped 是「正常收尾」的语义（cancel 会把 running 标成 skipped 并写「已取消」）。
   * 这种阶段不重新执行，否则用户每点一次「继续」都会把取消掉的步骤再跑一遍。
   */
  const state = makeState({ stages: { material: "skipped", cards: "pending", compose: "pending" }, hasCards: true });
  assert.equal(nextResumeStep(state), "cards");
});

test("素材已好、卡片没跑完：接着生成卡片", () => {
  const state = makeState({ stages: { material: "done", cards: "pending", compose: "pending" }, hasCards: false });
  assert.equal(nextResumeStep(state), "cards");
});

test("素材与卡片都好：进入合成", () => {
  const state = makeState({ stages: { material: "done", cards: "done", compose: "pending" } });
  assert.equal(nextResumeStep(state), "compose");
});

test("没开版式（没有 cards 阶段）：素材好了直接合成", () => {
  const state = makeState({ stages: { material: "done", cards: "absent", compose: "pending" }, hasCards: false });
  assert.equal(nextResumeStep(state), "compose");
});

test("素材阶段 done 但被标成 skipped（取消后收尾）：不再重跑", () => {
  const state = makeState({ stages: { material: "skipped", cards: "absent", compose: "pending" }, hasCards: false });
  assert.equal(nextResumeStep(state), "compose");
});

test("设置里关掉版式：遗留的 cards 阶段被标 skipped 后，直接进合成而不是反复重跑", () => {
  /*
   * cards 阶段是建任务时按当时配置定下的。用户在设置里关掉 CARDS_ENABLED 后，
   * confirmMaterial 会把遗留阶段标成 skipped；若仍留 pending，
   * nextResumeStep 会一直认为这步没做完，点「继续」就卡在版式上打转。
   */
  const closed = makeState({ stages: { material: "done", cards: "skipped", compose: "pending" } });
  assert.equal(nextResumeStep(closed), "compose");

  // 对照：没关开关时同样状态下会去补版式
  const stillOpen = makeState({ stages: { material: "done", cards: "pending", compose: "pending" } });
  assert.equal(nextResumeStep(stillOpen), "cards");
});

test("素材没跑完且还没配音：交回 other，不去碰后面任何一步", () => {
  // material 待办但 audio 缺失 → 不满足 match；material 清单也没有 → 不满足 cards/compose
  const state = makeState({
    stages: { material: "running", cards: "pending", compose: "pending" },
    hasAudio: false,
    hasMaterial: false,
  });
  assert.equal(nextResumeStep(state), "other");
});
