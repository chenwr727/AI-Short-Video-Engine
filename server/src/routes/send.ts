import fs from "node:fs";
import type { FastifyReply } from "fastify";

export interface SendFileOptions {
  contentType: string;
  /** 传了则带 Content-Disposition */
  downloadName?: string;
}

/** 支持 HTTP Range，非法范围返回 416 */
export function sendFileWithRange(
  reply: FastifyReply,
  file: string,
  rangeHeader: string | undefined,
  options: SendFileOptions,
): FastifyReply {
  const stat = fs.statSync(file);
  reply.header("Content-Type", options.contentType);
  reply.header("Accept-Ranges", "bytes");

  if (options.downloadName) {
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`);
  }

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
    }

    const safeEnd = Math.min(end, stat.size - 1);
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${safeEnd}/${stat.size}`);
    reply.header("Content-Length", safeEnd - start + 1);
    return reply.send(fs.createReadStream(file, { start, end: safeEnd }));
  }

  reply.header("Content-Length", stat.size);
  return reply.send(fs.createReadStream(file));
}

/** 按扩展名返回 MIME，未知按二进制流 */
export function mimeOf(file: string): string {
  switch (file.slice(file.lastIndexOf(".")).toLowerCase()) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}
