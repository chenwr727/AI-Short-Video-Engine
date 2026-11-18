import type { TaskState } from "./types";

export type Phase = "input" | "script" | "render" | "material" | "result";

export interface StepDef {
  id: Phase;
  label: string;
  desc: string;
}

export const STEPS: StepDef[] = [
  { id: "input", label: "文案脚本", desc: "输入链接或正文" },
  { id: "script", label: "剧本生成", desc: "选脚本风格 · AI 写稿" },
  { id: "render", label: "配音生成", desc: "逐句配音 · 音色选择" },
  { id: "material", label: "素材确认", desc: "匹配素材 · 可更换" },
  { id: "result", label: "成片预览", desc: "渲染设置 · 播放" },
];

export const STEP_INDEX: Record<Phase, number> = {
  input: 0,
  script: 1,
  render: 2,
  material: 3,
  result: 4,
};

export const SCRIPT_STAGE_IDS = ["fetch", "write", "rewrite", "split"];

export const RENDER_STAGE_IDS = ["tts"];

export const MATERIAL_STAGE_IDS = ["material"];

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
    case "running":
      if (!scriptStagesDone(task)) return "script";
      if (!task.audio) return "render";
      return materialDone(task) ? "result" : "material";
    case "material_ready":
      return "result";
    case "script_confirmed":
    case "tts_ready":
      return "render";
    default:
      return null;
  }
}

/** 失败/取消时按跑到哪一步兜底 */
export function stalledPhase(task: TaskState | null): Phase | null {
  if (!task || task.status === "idle") return null;
  return derivePhase(task) ?? STEPS[reachedIndex(task)]?.id ?? null;
}

/** 已走完的步骤数，用于打勾 */
export function doneThrough(task: TaskState | null): number {
  if (!task || task.status === "idle") return 0;
  if (task.status === "completed") return STEP_INDEX.result + 1;
  if (task.status === "failed" || task.status === "cancelled") return reachedIndex(task);

  if (task.status === "awaiting_script") return STEP_INDEX.script + 1;

  if (task.status === "awaiting_material" || task.status === "material_ready") {
    return task.status === "material_ready" ? STEP_INDEX.result : STEP_INDEX.material;
  }
  if (task.status === "running" && task.audio) {
    return task.material ? STEP_INDEX.result : STEP_INDEX.material;
  }

  const current = derivePhase(task);
  return current ? STEP_INDEX[current] : reachedIndex(task);
}

/** 最远到达的步骤，决定步骤条哪些可点回 */
export function reachedIndex(task: TaskState | null): number {
  if (!task || task.status === "idle") return 0;
  if (task.status === "completed") return STEP_INDEX.result;
  if (task.status === "failed" || task.status === "cancelled") {
    const started = (id: string) => {
      const stage = task.stages.find((entry) => entry.id === id);
      return Boolean(stage) && stage?.status !== "pending";
    };
    if (task.result || started("compose")) return STEP_INDEX.result;
    if (task.material || started("material")) return STEP_INDEX.material;
    if (task.audio || started("tts")) return STEP_INDEX.render;
    return task.transcript || started("split") ? STEP_INDEX.script : STEP_INDEX.input;
  }
  // 等待确认时也要能进下一步
  if (task.status === "awaiting_script") return STEP_INDEX.render;
  if (task.status === "awaiting_material") return STEP_INDEX.material;
  if (task.status === "material_ready") return STEP_INDEX.result;
  if (task.status === "running") {
    if (!scriptStagesDone(task)) return STEP_INDEX.script;
    if (!task.audio) return STEP_INDEX.render;
    return materialDone(task) ? STEP_INDEX.result : STEP_INDEX.material;
  }
  return STEP_INDEX.render;
}
