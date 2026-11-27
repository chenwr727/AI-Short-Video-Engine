import type { TtsKey } from "./tts.zh";

/** tts 命名空间的英文字典，键由 zh 侧约束。 */
export const tts = {
  available: "Available: {list}",
  characters: "{n} characters",
  defaultEngine: "Default engine",
  engine: "Voice engine",
  engineDoubao: "Doubao Seed-TTS",
  engineEdge: "Edge voices",
  hint: "Synthesizes voiceover sentence by sentence. Intermediates are saved to disk, so cache hits are reused.",
  hint2: "Pick a voice per character. After you confirm, voiceover, footage matching and compositing run in order.",
  hintSetup:
    "Voiceover hasn't started. Confirm voice and speed, then hit Start. Finished sentences stay on disk, so an interruption only fills in the gaps.",
  nextMaterial: "Next: footage",
  paragraph: "Section {n}",
  paragraphMeta: "{sec}s · {n} lines",
  play: "Play",
  playAll: "Play section",
  regenerateConfirm: "Regenerating discards the generated voiceover, plus matched footage and the final cut. Continue?",
  regenerateHint:
    "After changing voice or speed, Regenerate redos the voiceover; matched footage and the final cut are invalidated too.",
  running: "Rendering segments → joining → mixing. Switches to the final cut when done.",
  settings: "Voice settings",
  speed: "{v}× speed",
  speedLabel: "Speed",
  speedOriginal: "1.0× (original)",
  start: "Start voice generation",
  startShort: "Start voiceover",
  stopAll: "Stop all",
  stopped: "Stopped. Finished steps are already on disk — Continue picks up where it left off.",
  stoppedScript: "Stopped, but the script is written. Continue runs the rest without redoing finished steps.",
  title: "Voice generation",
  total: "Total voiceover {sec}s · {n} sections · {model}",
  voice: "Voice & speed",
} satisfies Record<TtsKey, string>;
