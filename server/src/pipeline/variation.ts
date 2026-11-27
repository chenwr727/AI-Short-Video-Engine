import { createHash } from "node:crypto";

/**
 * 视频级「外观种子」。
 *
 * 目的：同一条号的连续几条视频不该长得一模一样。
 * 之前运镜按 `plan.index % 4` 取模、配色永远用 palette[0]，于是每条视频的
 * 第 1 段都推、第 2 段都拉，画面骨架完全一致 —— 平台侧容易识别成重复内容。
 *
 * 做法：由种子决定「顺序」而不是「内容」。
 * 可选项还是那几套运镜/转场/配色，只是从各自的池子里按种子洗牌，
 * 保证：
 *   1. 样式仍然全部在白名单池内（不会出现没人验证过的视觉效果）；
 *   2. 同一份输入 + 同一个种子 → 结果完全一致，缓存与指纹照常有效；
 *   3. 不同视频（不同标题/种子）→ 洗牌结果不同。
 */

/** 从任意字符串派生一个稳定的 32 位无符号种子 */
export function seedFrom(text: string): number {
  const hash = createHash("sha1").update(text).digest();
  return hash.readUInt32BE(0);
}

/**
 * 确定性洗牌（Fisher-Yates，用种子驱动的线性同余发生器）。
 *
 * 不用 Math.random：那样每次运行结果不同，缓存永远命中不了，
 * 同一条视频重渲两次画面还会变 —— 这是不能接受的。
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  if (out.length <= 1) return out;
  // 线性同余：参数取自 Numerical Recipes，够用且完全确定
  let state = (seed || 1) >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * 按种子把段落序号映射到一个洗牌后的下标。
 *
 * 同一段（index 相同）在同一种子下永远得到同一个值，
 * 这样片段缓存仍然有效；换个种子就整体错位，运镜序列不再可预测。
 */
export function shuffledIndex(index: number, count: number, seed: number): number {
  if (count <= 1) return 0;
  const order = shuffle(
    Array.from({ length: count }, (_, i) => i),
    seed,
  );
  /*
   * 段落可能超过池子大小，循环取用（第 5 段回到第 1 个位置，但已是被打乱过的顺序）。
   * index 约定从 1 起；万一传了 0 或负数，取模会得到负下标拿到 undefined，
   * 这里折回 0，别让调用方拿到空值。
   */
  const at = (Math.floor(index) - 1) % count;
  return order[at < 0 ? 0 : at] as number;
}
