import fs from "node:fs";
import path from "node:path";
import { workspacesDir } from "../paths.js";
import type { CardPrefs, GenerateOptions, LogLine, StageState, TaskState, TaskStatus } from "../types.js";

/** 快照写在工作目录下，重启后取最新的一个 */
const TASK_FILE = "_task.json";
/** 目录名格式 yyyyMMdd-HHmmss，重名补 -2、-3 */
const STAMP = /^\d{8}-\d{6}(-\d+)?$/;

export function taskFile(workspace: string): string {
  return path.join(workspace, TASK_FILE);
}

export function saveTaskState(state: TaskState): void {
  try {
    fs.writeFileSync(taskFile(state.workspace), JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error(`[task] 状态落盘失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 老快照没有这个字段，缺失或脏值都当作「没选过」 */
function normalizePrefs(raw: unknown): CardPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { accent?: unknown; chapterDurationSec?: unknown };
  const accent = typeof obj.accent === "string" && obj.accent.trim() ? obj.accent.trim().toLowerCase() : undefined;
  const sec = Number(obj.chapterDurationSec);
  const chapterDurationSec = Number.isFinite(sec) && sec >= 0.5 && sec <= 15 ? Math.round(sec * 10) / 10 : undefined;
  return accent || chapterDurationSec ? { accent, chapterDurationSec } : null;
}

function normalize(raw: unknown, name: string): TaskState | null {
  const obj = raw as Partial<TaskState> | null;
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.input !== "string" || !obj.options || typeof obj.options !== "object") return null;
  if (!Array.isArray(obj.stages) || typeof obj.status !== "string") return null;

  const now = new Date().toISOString();
  return {
    // 以目录名为准，搬目录后仍能对上
    id: name,
    input: obj.input,
    options: obj.options as GenerateOptions,
    workspace: path.join(workspacesDir(), name),
    status: obj.status as TaskStatus,
    stages: obj.stages as StageState[],
    logs: Array.isArray(obj.logs) ? (obj.logs as LogLine[]) : [],
    transcript: obj.transcript ?? null,
    audio: obj.audio ?? null,
    material: obj.material ?? null,
    cards: obj.cards ?? null,
    cardPrefs: normalizePrefs(obj.cardPrefs),
    result: typeof obj.result === "string" ? obj.result : null,
    error: typeof obj.error === "string" ? obj.error : null,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : now,
  };
}

/** 取最近一个含 _task.json 的工作目录 */
export function loadLatestTask(): TaskState | null {
  let names: string[];
  try {
    names = fs.readdirSync(workspacesDir());
  } catch {
    return null;
  }

  // 直接按字符串排会让 -10 排在 -2 前，需按时间戳 + 后缀号比较
  const stampOf = (name: string): string => name.slice(0, 15);
  const suffixOf = (name: string): number => Number(name.slice(16)) || 0;
  const candidates = names
    .filter((name) => STAMP.test(name))
    .sort((a, b) => stampOf(a).localeCompare(stampOf(b)) || suffixOf(a) - suffixOf(b))
    .reverse();

  for (const name of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(workspacesDir(), name, TASK_FILE), "utf-8")) as unknown;
      const state = normalize(data, name);
      if (state) return state;
    } catch {
      // 无快照或已损坏，看下一个
    }
  }
  return null;
}
