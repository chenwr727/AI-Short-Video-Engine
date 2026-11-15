import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export const repoRoot = path.resolve(__dirname, "..", "..");

export function serverDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(repoRoot, "server");
}

export function webDistDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(repoRoot, "web", "dist");
}

/**
 * 二进制目录：打包态是 resources/bin；
 * 开发态优先用 build/bin（`npm run ffmpeg` 会把 ffmpeg 与 ffprobe 一起放进去），
 * 只有它不存在时才退回 ffmpeg-static——那个包里没有 ffprobe。
 */
export function binDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin");

  const staged = path.join(repoRoot, "desktop", "build", "bin");
  const hasFfprobe = ["ffprobe.exe", "ffprobe"].some((name) => fs.existsSync(path.join(staged, name)));
  if (hasFfprobe) return staged;

  return path.join(repoRoot, "desktop", "node_modules", "ffmpeg-static");
}

export function userDataDir(): string {
  return app.getPath("userData");
}

/** 运行期数据（工作目录、成片、素材缓存）：打包态落在应用数据目录，开发态留在 server/data */
export function runtimeDataDir(): string {
  return app.isPackaged ? path.join(userDataDir(), "data") : path.join(serverDir(), "data");
}

let portableRoot: string | null = null;

export function isPortable(): boolean {
  return portableRoot !== null;
}

function dirWritable(dir: string): boolean {
  const probe = path.join(dir, `.aisv-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "1");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 依据 exe 同级 portable.txt 切换免安装模式；目录不可写时回退到默认数据目录 */
export function setupPortableMode(): void {
  if (!app.isPackaged) return;
  try {
    const exeDir = path.dirname(app.getPath("exe"));
    if (!fs.existsSync(path.join(exeDir, "portable.txt"))) return;
    if (!dirWritable(exeDir)) {
      console.warn(`[desktop] 检测到 portable.txt 但应用目录不可写，回退到默认数据目录：${exeDir}`);
      return;
    }
    const target = path.join(exeDir, "UserData");
    fs.mkdirSync(target, { recursive: true });
    app.setPath("userData", target);
    portableRoot = exeDir;
    console.log(`[desktop] 免安装模式已启用，数据目录：${target}`);
  } catch (e) {
    console.warn("[desktop] 免安装模式检测失败：", e);
  }
}
