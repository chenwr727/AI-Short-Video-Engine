/** 步骤页从上到下是「配置 → 日志 → 结果」，这里按阶段决定三块的状态 */
export type StepStage = "setup" | "running" | "ready" | "failed";

export interface StepLayout {
  configOpen: boolean;
  logOpen: boolean;
  showResult: boolean;
}

/** setup = 还没开跑，running = 生成中，ready = 跑完待确认/已完成，failed = 失败或停止 */
export function stepLayout(stage: StepStage, hasResult = false): StepLayout {
  if (stage === "setup") return { configOpen: true, logOpen: false, showResult: false };
  if (stage === "running") return { configOpen: false, logOpen: true, showResult: false };
  // 失败时日志保持展开，方便直接看报错
  if (stage === "failed") return { configOpen: false, logOpen: true, showResult: hasResult };
  return { configOpen: false, logOpen: false, showResult: true };
}
