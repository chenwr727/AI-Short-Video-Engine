import type { StageKey } from "./stage.zh";

/** stage 命名空间的英文字典，键由 zh 侧约束。 */
export const stage = {
  cards: "Building cards",
  compose: "Compositing",
  connecting: "Connecting…",
  count: " ({n} entries)",
  fetch: "Fetching content",
  hasError: "Has errors",
  material: "Matching footage",
  noLog: "No log yet",
  openSettings: "Open preferences…",
  rewrite: "Rewriting script",
  split: "Splitting lines",
  "summary.cards": "{n} cards",
  "summary.chars": "{n} chars",
  "summary.missingCards": " / {n} cards missing",
  "summary.sections": "{n} sections",
  "summary.sectionsSeconds": "{n} sections / {sec}s",
  "summary.sectionsSentences": "{n} sections / {sent} lines",
  tts: "Synthesizing voice",
  write: "Drafting",
} satisfies Record<StageKey, string>;
