/** 按字符宽度断行，英文单词尽量不切断 */
function breakLines(text: string, perLine: number): string[] {
  const tokens = text.match(/[A-Za-z0-9]+|\s+|[^\sA-Za-z0-9]/g) ?? [];
  const lines: string[] = [];
  let line = "";

  for (const token of tokens) {
    const next = line + token;
    if (Array.from(next.trim()).length > perLine && line.trim()) {
      lines.push(line.trim());
      line = token.trimStart();
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line.trim());

  return lines.filter(Boolean).slice(0, 5);
}

/**
 * 第一遍按容器宽度断行；如果断出来行数偏多而每行都吃不饱，
 * 按平均字数再断一次，避免出现「9/9/5/5」这种难看的分布。
 */
export function wrapTitle(text: string, perLine: number): string[] {
  const first = breakLines(text, perLine);
  if (first.length < 2) return first;

  const total = first.reduce((sum, line) => sum + Array.from(line).length, 0);
  const ideal = Math.ceil(total / first.length);

  if (ideal >= perLine) return avoidPunctuationStart(balance(first));

  const second = breakLines(text, ideal);
  return avoidPunctuationStart(balance(second.length >= 2 ? second : first));
}

/** 中文避头尾：标点不能出现在行首，把上一行最后一个字带下来 */
function avoidPunctuationStart(lines: string[]): string[] {
  const bad = /^[，。、；：！？）》」』】…—·]/;

  for (let i = 1; i < lines.length; i++) {
    const current = lines[i] ?? "";
    const prev = lines[i - 1] ?? "";
    if (!bad.test(current) || prev.length <= 1) continue;

    lines[i - 1] = prev.slice(0, -1);
    lines[i] = prev.slice(-1) + current;
  }

  return lines;
}

/** 最后一行只剩一两个字会很难看，把上一行的字挪下来凑匀 */
function balance(lines: string[]): string[] {
  if (lines.length < 2) return lines;

  const last = lines[lines.length - 1] ?? "";
  const prev = lines[lines.length - 2] ?? "";
  if (!last || last.length >= (prev.length + last.length) * 0.34) return lines;

  const target = Math.ceil((prev.length + last.length) / 2);
  const move = prev.length - target;
  if (move <= 0) return lines;

  lines[lines.length - 2] = prev.slice(0, target);
  lines[lines.length - 1] = prev.slice(target) + last;
  return lines;
}
