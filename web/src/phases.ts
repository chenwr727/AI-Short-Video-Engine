import type { TaskState } from "./types";

export type Phase = "input" | "script" | "render" | "material" | "cards" | "result";

export interface StepDef {
  id: Phase;
  label: string;
  desc: string;
}

const ALL_STEPS: StepDef[] = [
  { id: "input", label: "文案脚本", desc: "输入链接或正文" },
  { id: "script", label: "剧本生成", desc: "选脚本风格 · AI 写稿" },
  { id: "render", label: "配音生成", desc: "逐句配音 · 音色选择" },
  { id: "material", label: "素材确认", desc: "匹配素材 · 片头章节" },
  { id: "result", label: "成片预览", desc: "渲染设置 · 播放" },
];

/**
 * 版式不再是独立一步：片头/章节/片尾的参数并进「素材确认」的配置区，
 * 和素材一起确认。这里保留 id 只为兼容旧快照与路由，步骤条上不再出现。
 */
export const LEGACY_CARD_PHASE: Phase = "cards";

/** 有 cards 阶段 = 这个任务开了版式 */
export function hasCards(task: TaskState | null): boolean {
  return Boolean(task?.stages.some((stage) => stage.id === "cards"));
}

/** 步骤条固定 5 步，版式不再是独立一步 */
export function stepsFor(_withCards: boolean): StepDef[] {
  return ALL_STEPS;
}

export function indexOf(phase: Phase, withCards: boolean): number {
  const index = stepsFor(withCards).findIndex((step) => step.id === phase);
  return index < 0 ? 0 : index;
}

export const SCRIPT_STAGE_IDS = ["fetch", "write", "rewrite", "split"];

export const RENDER_STAGE_IDS = ["tts"];

/**
 * 素材页要显示的日志阶段。
 *
 * 版式已并进这一页，生成版式的日志归属 cards 阶段；
 * 只列 material 会把「按当前参数生成版式…」「版式已生成：6 张卡」全滤掉，
 * 用户看不到卡片是怎么来的。
 */
export const MATERIAL_STAGE_IDS = ["material", "cards"];

export const CARD_STAGE_IDS = ["cards"];

export const COMPOSE_STAGE_IDS = ["compose"];

/** skipped 也算结束 */
export function scriptStagesDone(task: TaskState): boolean {
  const stages = task.stages.filter((stage) => SCRIPT_STAGE_IDS.includes(stage.id));
  return stages.length > 0 && stages.every((stage) => stage.status === "done" || stage.status === "skipped");
}

/** 阶段是否已经跑完；不存在（没开版式）算完成 */
function stageSettled(task: TaskState, id: string): boolean {
  const stage = task.stages.find((entry) => entry.id === id);
  if (!stage) return true;
  return stage.status === "done" || stage.status === "skipped";
}

/**
 * 素材这一步是否已经做完。
 *
 * 不能只看 task.material：重新匹配期间它会被逐段挂成「进行中的清单」，
 * 第 1 段下载完就非空了。以前据此判断，重新生成时前端立刻认定素材已完成，
 * 再看到上一轮遗留的 cards 非空，就把页面翻到成片预览 —— 用户没点下一步，
 * 素材其实还在第 6/6 段。这里改看阶段状态，只有真正跑完才算完成。
 */
export function materialDone(task: TaskState): boolean {
  return stageSettled(task, "material");
}

/** 版式是否已经做完；没开版式的任务同样算完成 */
export function cardsDone(task: TaskState): boolean {
  return stageSettled(task, "cards");
}

/** 当前应停留的步骤，failed / cancelled 返回 null */
export function derivePhase(task: TaskState | null): Phase | null {
  if (!task) return null;
  switch (task.status) {
    case "completed":
      return "result";
    case "awaiting_script":
      return "script";
    case "awaiting_material":
      // 素材没匹配时停在配音页试听
      return task.material ? "material" : "render";
    // 版式已并进素材页：等待版式确认时仍停在素材页，卡片就在那一页
    case "awaiting_cards":
      return "material";
    case "cards_ready":
      return "result";
    case "running":
      if (!scriptStagesDone(task)) return "script";
      if (!task.audio) return "render";
      if (!materialDone(task)) return "material";
      if (!cardsDone(task)) return "material";
      return "result";
    case "material_ready":
      return "result";
    case "script_confirmed":
    case "tts_ready":
      return "render";
    default:
      return null;
  }
}

export function stalledPhase(task: TaskState | null): Phase | null {
  if (!task || task.status === "idle") return null;
  return derivePhase(task) ?? stepsFor(hasCards(task))[reachedIndex(task)]?.id ?? null;
}

export function doneThrough(task: TaskState | null): number {
  if (!task || task.status === "idle") return 0;
  const withCards = hasCards(task);
  if (task.status === "completed") return indexOf("result", withCards) + 1;
  if (task.status === "failed" || task.status === "cancelled") return reachedIndex(task);

  if (task.status === "awaiting_script") return indexOf("script", withCards) + 1;
  if (task.status === "awaiting_cards") return indexOf("material", withCards);
  if (task.status === "cards_ready") return indexOf("result", withCards);
  if (task.status === "awaiting_material" || task.status === "material_ready") {
    return task.status === "material_ready" ? indexOf("result", withCards) : indexOf("material", withCards);
  }
  if (task.status === "running" && task.audio) {
    if (!materialDone(task)) return indexOf("material", withCards);
    if (!cardsDone(task)) return indexOf("material", withCards);
    return indexOf("result", withCards);
  }

  const current = derivePhase(task);
  return current ? indexOf(current, withCards) : reachedIndex(task);
}

/** 最远到达的步骤，决定步骤条哪些可点回 */
export function reachedIndex(task: TaskState | null): number {
  if (!task || task.status === "idle") return 0;
  const withCards = hasCards(task);
  const at = (phase: Phase) => indexOf(phase, withCards);

  if (task.status === "completed") return at("result");
  if (task.status === "failed" || task.status === "cancelled") {
    const started = (id: string) => {
      const stage = task.stages.find((entry) => entry.id === id);
      return Boolean(stage) && stage?.status !== "pending";
    };
    if (task.result || started("compose")) return at("result");
    if (task.cards || started("cards")) return at("material");
    if (task.material || started("material")) return at("material");
    if (task.audio || started("tts")) return at("render");
    return task.transcript || started("split") ? at("script") : at("input");
  }
  // 等待确认时也要能进下一步
  if (task.status === "awaiting_script") return at("render");
  if (task.status === "awaiting_material") return at("material");
  if (task.status === "awaiting_cards") return at("material");
  if (task.status === "cards_ready") return at("result");
  if (task.status === "material_ready") return at("result");
  if (task.status === "running") {
    if (!scriptStagesDone(task)) return at("script");
    if (!task.audio) return at("render");
    if (!materialDone(task)) return at("material");
    if (!cardsDone(task)) return at("material");
    return at("result");
  }
  return at("render");
}
