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
  { id: "material", label: "素材确认", desc: "匹配素材 · 可更换" },
  { id: "cards", label: "版式确认", desc: "片头片尾 · 章节卡" },
  { id: "result", label: "成片预览", desc: "渲染设置 · 播放" },
];

/** 有 cards 阶段 = 这个任务开了版式 */
export function hasCards(task: TaskState | null): boolean {
  return Boolean(task?.stages.some((stage) => stage.id === "cards"));
}

export function stepsFor(withCards: boolean): StepDef[] {
  return withCards ? ALL_STEPS : ALL_STEPS.filter((step) => step.id !== "cards");
}

export function indexOf(phase: Phase, withCards: boolean): number {
  const index = stepsFor(withCards).findIndex((step) => step.id === phase);
  return index < 0 ? 0 : index;
}

export const SCRIPT_STAGE_IDS = ["fetch", "write", "rewrite", "split"];

export const RENDER_STAGE_IDS = ["tts"];

export const MATERIAL_STAGE_IDS = ["material"];

export const CARD_STAGE_IDS = ["cards"];

export const COMPOSE_STAGE_IDS = ["compose"];

/** skipped 也算结束 */
export function scriptStagesDone(task: TaskState): boolean {
  const stages = task.stages.filter((stage) => SCRIPT_STAGE_IDS.includes(stage.id));
  return stages.length > 0 && stages.every((stage) => stage.status === "done" || stage.status === "skipped");
}

/** 只看 task.material：阶段标 done 时该字段尚未赋值 */
export function materialDone(task: TaskState): boolean {
  return Boolean(task.material);
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
    case "awaiting_cards":
      return "cards";
    case "cards_ready":
      return "result";
    case "running":
      if (!scriptStagesDone(task)) return "script";
      if (!task.audio) return "render";
      if (!materialDone(task)) return "material";
      if (hasCards(task) && !task.cards) return "cards";
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
  if (task.status === "awaiting_cards") return indexOf("cards", withCards);
  if (task.status === "cards_ready") return indexOf("result", withCards);
  if (task.status === "awaiting_material" || task.status === "material_ready") {
    return task.status === "material_ready" ? indexOf("result", withCards) : indexOf("material", withCards);
  }
  if (task.status === "running" && task.audio) {
    if (!task.material) return indexOf("material", withCards);
    if (withCards && !task.cards) return indexOf("cards", withCards);
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
    if (task.cards || started("cards")) return at("cards");
    if (task.material || started("material")) return at("material");
    if (task.audio || started("tts")) return at("render");
    return task.transcript || started("split") ? at("script") : at("input");
  }
  // 等待确认时也要能进下一步
  if (task.status === "awaiting_script") return at("render");
  if (task.status === "awaiting_material") return at("material");
  if (task.status === "awaiting_cards") return at("cards");
  if (task.status === "cards_ready") return at("result");
  if (task.status === "material_ready") return at("result");
  if (task.status === "running") {
    if (!scriptStagesDone(task)) return at("script");
    if (!task.audio) return at("render");
    if (!materialDone(task)) return at("material");
    if (withCards && !task.cards) return at("cards");
    return at("result");
  }
  return at("render");
}
