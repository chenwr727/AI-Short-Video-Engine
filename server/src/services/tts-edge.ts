import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { num, type AppConfig } from "../config.js";
import type { TtsRequest } from "./tts.js";
import { userError } from "../errors.js";

/** Edge 朗读，无需 Key，返回 24kHz mp3 */
export async function synthesizeEdge(cfg: AppConfig, req: TtsRequest): Promise<Buffer> {
  const speed = num(cfg.TTS_SPEED, 1);
  const tts = new MsEdgeTTS();
  const chunks: Buffer[] = [];

  try {
    await tts.setMetadata(req.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(req.text, speed === 1 ? undefined : { rate: speed });

    for await (const chunk of audioStream) {
      if (req.signal.aborted) throw new DOMException("已取消", "AbortError");
      chunks.push(Buffer.from(chunk as Buffer));
    }
  } finally {
    try {
      tts.close();
    } catch {
      // socket 已关闭
    }
  }

  if (chunks.length === 0) throw userError("edgeNoAudio", 500);
  return Buffer.concat(chunks);
}
