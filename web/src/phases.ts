import type { TaskState } from "./types";

/** 前端向导的五步；与后端阶段（stages）是映射关系，不是一一对应 */
export type Phase = "input" | "script" | "render" | "material" | "result";

export interface StepDef {
  id: Phase;
  label: string;
  desc: string;
}

export const STEPS: StepDef[] = [
  { id: "input", label: "文案脚本", desc: "输入内容与参数" },
  { id: "script", label: "剧本生成", desc: "AI 写稿 · 人工确认" },
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

/** 剧本阶段的四个后端子步骤 */
export const SCRIPT_STAGE_IDS = ["fetch", "write", "rewrite", "split"];

/** 配音合成页的子步骤：只做配音 */
export const RENDER_STAGE_IDS = ["tts"];

/** 素材确认页的子步骤：匹配素材（含手动更换） */
export const MATERIAL_STAGE_IDS = ["material"];

/** 成片预览页的子步骤 */
export const COMPOSE_STAGE_IDS = ["compose"];

/** 剧本子步骤是否都已结束（命中缓存时是 skipped） */
export function scriptStagesDone(task: TaskState): boolean {
  const stages = task.stages.filter((stage) => SCRIPT_STAGE_IDS.includes(stage.id));
  return stages.length > 0 && stages.every((stage) => stage.status === "done" || stage.status === "skipped");
}

/** 素材是否已匹配出来（含缓存命中） */
export function materialDone(task: TaskState): boolean {
  if (task.material) return true;
  const stage = task.stages.find((entry) => entry.id === "material");
  return stage?.status === "done" || stage?.status === "skipped";
}

/** 任务当前应该停留在哪一步；failed / cancelled 交给用户自己选 */
export function derivePhase(task: TaskState | null): Phase | null {
  if (!task) return null;
  switch (task.status) {
    case "completed":
      return "result";
    case "awaiting_script":
      return "script";
    case "awaiting_material":
      // 配音刚完成、素材还没匹配：停在第三步让人试听，匹配了才去第四步
      return task.material ? "material" : "render";
    case "running":
      if (!scriptStagesDone(task)) return "script";
      if (!task.audio) return "render";
      // 配音完成后，匹配素材与合成分别在第四、第五步进行
      return materialDone(task) ? "result" : "material";
    // 素材已定稿、成片还没生成：停在第五步等用户设渲染参数
    case "material_ready":
      return "result";
    case "script_confirmed":
    case "tts_ready":
      return "render";
    default:
      return null;
  }
}

/** 已到达的最远步骤下标，决定步骤条哪些可以点回去 */
export function reachedIndex(task: TaskState | null): number {
  if (!task || task.status === "idle") return 0;
  if (task.status === "completed") return STEP_INDEX.result;
  if (task.status === "failed" || task.status === "cancelled") {
    // 失败时也按"跑到哪一步"算，别让已经开始的步骤看起来还没到
    const started = (id: string) => {
      const stage = task.stages.find((entry) => entry.id === id);
      return Boolean(stage) && stage?.status !== "pending";
    };
    if (task.result || started("compose")) return STEP_INDEX.result;
    if (task.material || started("material")) return STEP_INDEX.material;
    if (task.audio || started("tts")) return STEP_INDEX.render;
    return task.transcript || started("split") ? STEP_INDEX.script : STEP_INDEX.input;
  }
  // 等待确认时也要能进下一步：配音设置 / 素材确认就在后面那一屏
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
