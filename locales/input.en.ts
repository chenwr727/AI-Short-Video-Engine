import type { InputKey } from "./input.zh";

/** input 命名空间的英文字典，键由 zh 侧约束。 */
export const input = {
  afterScript:
    "The script is written but not confirmed. Editing the content and hitting Regenerate rewrites it entirely; to change only the style or cast, go to Script.",
  chars: "{n} chars",
  hint: "Paste a web link or the article text. Next you pick a script style and cast, then start generation manually.",
  label: "Content (URL or text)",
  needContent: "Add a link or some text first",
  nextHint: "Next: script",
  placeholder: "e.g. https://example.com/article — or paste the article text",
  regenerateHint: "Discard the current script and everything after it, then redo the whole flow with the content above",
  subHint:
    "Paste an article link (the text is fetched automatically) or the text itself. The more specific, the closer the script.",
} satisfies Record<InputKey, string>;
