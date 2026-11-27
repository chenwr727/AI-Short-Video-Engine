import type { ScriptKey } from "./script.zh";

/** script 命名空间的英文字典，键由 zh 侧约束。 */
export const script = {
  blankDefault: "Leave blank to use the default names",
  clearRestart: "Clear & restart",
  confirmedReadonly:
    "This script was confirmed and used for voiceover. This is the version from that moment (read-only).",
  confirming: "Your script is ready for review",
  deleteLine: "Delete this line",
  done: "Running — switches to the script page when done",
  fromSettings: "Default from preferences",
  guestLabel: "Guest name",
  hint: "Set the style and cast names, then hit Start. AI reads the content and writes the script, then waits here for your review.",
  hint2:
    "Edit lines directly, delete any you don't need, then continue to voice selection. Recording starts only after you confirm.",
  mainLabel: "Host name",
  needLine: "Keep at least one line",
  nextHint: "Next: pick a script style and cast, then writing starts after you confirm",
  nextTts: "Next: voice",
  regenerateConfirm:
    "Regenerating discards the current script (including unsaved edits), plus generated voiceover, footage and the final cut. Continue?",
  regenerateHint:
    "Discard the current script (including unsaved edits) and everything after it, then redo the whole flow with the content, style and cast above",
  regenerateHint2:
    "After changing style or cast above, Regenerate rewrites the whole script; the current script and everything after it are invalidated.",
  running: "AI is fetching the content and writing the script. It will stop here for review when done.",
  speakerGuest: "Guest",
  speakerMain: "Host",
  start: "Start writing",
  stopped: "Stopped. Fetching and writing save progress step by step — Continue picks up from the last finished step.",
  stopRunning: "Stop",
  styleLabel: "Script style",
  styleUnset: "No style selected",
  summary: "{title} · {n} sections",
  title: "Script style & cast",
  titleLabel: "Title",
  unnamed: "Untitled",
} satisfies Record<ScriptKey, string>;
