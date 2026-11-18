// 复制 ffmpeg 到 build/bin，打包后由主进程并入 PATH 并告知后端；
// 不带 ffprobe，体积相当且后端已用 ffmpeg 兜底。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(here, "..", "build", "bin");

const isWin = process.platform === "win32";
const suffix = isWin ? ".exe" : "";

fs.mkdirSync(binDir, { recursive: true });

/** 在 PATH 中查找可执行文件 */
function fromSystemPath(name) {
  const exts = isWin ? [suffix, ".cmd", ".bat", ""] : [suffix];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir.trim());

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // 不存在则跳过
      }
    }
  }
  return null;
}

// 依赖包自带的 ffmpeg 版本过旧，统一取 gyan.dev essentials，缓存到 build/.cache
const cacheDir = path.join(here, "..", "build", ".cache");
const ESSENTIALS_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
/** 固定版本以保证构建可复现 */
const ESSENTIALS_VERSION = "9.0.2";

function pairFromEssentials() {
  const exeOf = (name) => path.join(cacheDir, name + ".exe");
  if (fs.existsSync(exeOf("ffmpeg"))) return cacheDir;

  const zipFile = path.join(cacheDir, `ffmpeg-${ESSENTIALS_VERSION}-essentials.zip`);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    // 下载中断会留下半截 zip，小于 50 MB 视为残缺
    const zipOk = fs.existsSync(zipFile) && fs.statSync(zipFile).size > 50 * 1024 * 1024;
    if (!zipOk) {
      console.log(`[ffmpeg] 下载 ffmpeg ${ESSENTIALS_VERSION} essentials 构建（约 110 MB）…`);
      // -sS 隐藏进度保留错误；--retry 应对镜像断流
      const r = spawnSync(
        "curl",
        [
          "-sS",
          "-L",
          "--fail",
          "--retry",
          "3",
          "--retry-all-errors",
          "--connect-timeout",
          "20",
          "--max-time",
          "1800",
          "-o",
          zipFile,
          ESSENTIALS_URL,
        ],
        { stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error(`下载失败（curl 退出码 ${r.status}）`);
    }

    // Windows 自带的 tar 能解 zip
    const out = path.join(cacheDir, "_unzip");
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const u = spawnSync("tar", ["-xf", zipFile, "-C", out], { stdio: "inherit" });
    if (u.status !== 0) throw new Error(`解压失败（tar 退出码 ${u.status}）`);

    const inner = fs
      .readdirSync(out)
      .map((d) => path.join(out, d, "bin"))
      .find((d) => fs.existsSync(path.join(d, "ffmpeg.exe")));
    if (!inner) throw new Error("解压后找不到 bin 目录");

    fs.copyFileSync(path.join(inner, "ffmpeg.exe"), exeOf("ffmpeg"));
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(zipFile, { force: true });
    console.log(`[ffmpeg] ${ESSENTIALS_VERSION} essentials 就绪：${cacheDir}`);
    return cacheDir;
  } catch (e) {
    console.warn(`[ffmpeg] 取 essentials 构建失败：${e?.message ?? e}`);
    // 清掉半截 zip，避免下次误判为已下载
    try {
      fs.rmSync(zipFile, { force: true });
    } catch {
      // 清理失败可忽略
    }
    return null;
  }
}

const pairDir = isWin ? pairFromEssentials() : null;

/** 解析二进制来源：环境变量 → 同目录配对 → 依赖包自带 → 系统 PATH */
function resolveBinary(name, pkgPath, envKey, pairDir) {
  const fromEnv = process.env[envKey];
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv;
    console.warn(`[ffmpeg] ${envKey} 指向的文件不存在：${fromEnv}`);
  }

  if (pairDir) {
    const paired = path.join(pairDir, name + suffix);
    if (fs.existsSync(paired)) return paired;
  }

  if (pkgPath && fs.existsSync(pkgPath)) return pkgPath;

  const fromPath = fromSystemPath(name);
  if (fromPath) {
    console.warn(`[ffmpeg] ${name} 依赖包内缺失，改用系统 PATH：${fromPath}`);
    return fromPath;
  }

  return null;
}

function copyOne(src, name, envKey) {
  if (!src) {
    console.error(
      `[ffmpeg] 找不到 ${name}。请任选其一：\n` +
        `  1) 设置环境变量 ${envKey}=<可执行文件绝对路径>\n` +
        `  2) 安装系统 ${name} 并加入 PATH（Windows: winget install Gyan.FFmpeg）\n` +
        `  3) 重新安装依赖以触发 ffmpeg-static 下载：cd desktop && npm rebuild ffmpeg-static\n` +
        `  4) 确保能访问 gyan.dev 以便自动下载 essentials 构建`,
    );
    process.exitCode = 1;
    return;
  }
  const dest = path.join(binDir, name + suffix);

  // 已是最新则跳过
  try {
    const [srcStat, destStat] = [fs.statSync(src), fs.statSync(dest)];
    if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
      console.log(`[ffmpeg] ${name} 已是最新，跳过`);
      return;
    }
  } catch {
    // 目标不存在则直接复制
  }

  fs.copyFileSync(src, dest);
  if (!isWin) fs.chmodSync(dest, 0o755);
  console.log(`[ffmpeg] ${name} -> ${dest}`);
}

const ffmpegPath = resolveBinary("ffmpeg", safeRequire("ffmpeg-static"), "FFMPEG_BIN", pairDir);

copyOne(ffmpegPath, "ffmpeg", "FFMPEG_BIN");

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ffmpeg] 完成：${binDir}`);

/** 依赖包缺二进制时 require 可能抛错，统一容错 */
function safeRequire(idOrFn) {
  try {
    return typeof idOrFn === "function" ? idOrFn() : require(idOrFn);
  } catch {
    return null;
  }
}
