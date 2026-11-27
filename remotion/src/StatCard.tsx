import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BeatList, CardBackdrop, OverlayPlate, riseIn, snapPx, springIn, type Beat } from "./card-kit";

/**
 * 数据卡。
 *
 * 新闻评论里「跌了 12%」「占家庭财富的三成」这类信息，念出来观众记不住，
 * 用一个放大的数字 + 柱状对比，冲击力强得多。
 */
export type StatBar = {
  label: string;
  value: number;
  hint?: string;
};

/** 主数字与其配套信息，后端把这些字段摊平成一个 stat 对象 */
export type StatPayload = {
  /** 主数字，如「12%」「1.4 万亿」 */
  value: string;
  /** 数字前的说明，如「家庭财富占比」 */
  caption?: string;
  /** 数字下方的一句结论 */
  note?: string;
  /** 可选对比条：给 2-4 项，用于「A vs B」的占比 */
  bars?: StatBar[];
};

export type StatCardProps = {
  title?: string;
  stat?: StatPayload;
  /** 逐条上屏的要点：到各自的秒数才出现，替代 note */
  beats?: Beat[];
  label?: string;
  accent?: string;
  /** 底图（素材帧的 data URI）；传了就走「叠加」形态 */
  bgImage?: string;
  /**
   * 排版：
   *   stack  —— 数字在上、柱状在下（默认，数字最有冲击力）
   *   split  —— 数字在左、柱状在右（横向，画面更扁，适合带底图时）
   */
  variant?: StatVariant;
  /** 只输出透明的信息层，不含背景，给 ffmpeg overlay 用 */
  transparent?: boolean;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

const MAX_BARS = 4;
const EMPTY_STAT: StatPayload = { value: "—" };

export type StatVariant = "stack" | "split";

export const StatCard: React.FC<StatCardProps> = ({
  stat = EMPTY_STAT,
  beats,
  label = "数据",
  accent = "#ff5a3c",
  bgImage,
  variant = "stack",
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const overlay = Boolean(bgImage) || transparent;
  const pad = Math.round(width * (overlay ? 0.075 : 0.1));
  const split = variant === "split";

  const { value, caption = "", note = "", bars = [] } = stat;
  const list = bars.slice(0, MAX_BARS);
  const max = Math.max(...list.map((b) => Math.abs(b.value)), 1);

  const captionIn = springIn(frame, fps, 0);
  const valueIn = springIn(frame, fps, 4);
  const noteIn = springIn(frame, fps, 12);
  const plateIn = springIn(frame, fps, 0, "float");

  // 数字轻微上浮收束，读起来有「落定」的感觉
  const settle = interpolate(frame, [4, 30], [1.06, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // 数字长度自适应：字符越多字号越小；split 时数字只占一侧，字号收小
  const rawSize = width * (split ? 0.16 : overlay ? 0.2 : 0.27);
  const fit = Math.min(1, Math.max(0.42, 6 / Math.max(1, [...value].length)));
  const valueSize = Math.round(rawSize * fit);

  /* 左半：主数字与说明；split 时与柱状并排，stack 时上下排列 */
  const headBlock = (
    <>
      {caption ? (
        <div
          style={{
            color: "rgba(245,247,255,0.55)",
            fontSize: Math.round(width * 0.032),
            letterSpacing: "0.14em",
            marginBottom: Math.round(width * 0.024),
            ...riseIn(captionIn, 12),
          }}
        >
          {caption}
        </div>
      ) : null}

      <div
        style={{
          color: accent,
          fontSize: valueSize,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          transform: `scale(${settle.toFixed(4)})`,
          transformOrigin: "left center",
          opacity: valueIn,
        }}
      >
        {value}
      </div>

      {beats && beats.length > 0 ? (
        <BeatList beats={beats} accent={accent} width={width} size={Math.round(width * (overlay ? 0.04 : 0.046))} />
      ) : note ? (
        <div
          style={{
            marginTop: Math.round(width * (overlay ? 0.03 : 0.045)),
            color: "rgba(245,247,255,0.82)",
            fontSize: Math.round(width * (overlay ? 0.036 : 0.042)),
            lineHeight: 1.45,
            ...riseIn(noteIn, 12),
          }}
        >
          {note}
        </div>
      ) : null}
    </>
  );

  /* 右半：柱状对比 */
  const barsBlock =
    list.length > 0 ? (
      <div
        style={{
          marginTop: split ? 0 : Math.round(width * (overlay ? 0.05 : 0.09)),
          display: "flex",
          flexDirection: "column",
          gap: Math.round(width * (overlay ? 0.028 : 0.038)),
          // split 时柱状占右侧固定宽度，左侧数字才有空间
          ...(split ? { flex: 1, minWidth: 0 } : {}),
        }}
      >
        {list.map((bar, i) => {
          const grow = springIn(frame, fps, 16 + i * 5, "linear");
          const ratio = Math.abs(bar.value) / max;
          const color = i === 0 ? accent : "rgba(255,255,255,0.25)";

          return (
            <div key={`${bar.label}-${i}`}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: Math.round(width * 0.014),
                  opacity: grow,
                  transform: `translateY(${snapPx((1 - grow) * 8)}px)`,
                }}
              >
                <span style={{ color: "rgba(245,247,255,0.75)", fontSize: Math.round(width * 0.033) }}>
                  {bar.label}
                </span>
                <span
                  style={{
                    color: i === 0 ? accent : "rgba(245,247,255,0.5)",
                    fontSize: Math.round(width * 0.032),
                    fontWeight: 600,
                  }}
                >
                  {/*
                    没给 hint 就只显示数值。这里原来补了一个 `%`：
                    数据卡不一定是占比（黄金 7 盎司、用户 1200 人），
                    硬加百分号会把真实数据说错，比不显示单位更糟。
                  */}
                  {bar.hint ?? String(bar.value)}
                </span>
              </div>
              <div
                style={{
                  height: Math.max(6, Math.round(width * 0.014)),
                  width: "100%",
                  backgroundColor: "rgba(255,255,255,0.07)",
                  borderRadius: 99,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(ratio * grow * 100).toFixed(2)}%`,
                    backgroundColor: color,
                    borderRadius: 99,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    ) : null;

  const body = split ? (
    /* 左右并排：数字在左、柱状在右 */
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(width * 0.06) }}>
      <div style={{ flexShrink: 0, maxWidth: Math.round(width * 0.44) }}>{headBlock}</div>
      {barsBlock}
    </div>
  ) : (
    <>
      {headBlock}
      {barsBlock}
    </>
  );

  return (
    <AbsoluteFill style={{ fontFamily: FONT, backgroundColor: transparent ? "transparent" : undefined }}>
      {overlay ? (
        <>
          {/* transparent 优先于 bgImage：透明层不能自带底图，否则会盖掉素材 */}
          {bgImage && !transparent ? (
            <AbsoluteFill
              style={{
                backgroundImage: `url(${bgImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : null}
          <OverlayPlate accent={accent} progress={plateIn} width={width} height={height}>
            {body}
          </OverlayPlate>
        </>
      ) : (
        <>
          <CardBackdrop accent={accent} origin="30% 26%" />
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              padding: `${Math.round(height * 0.2)}px ${pad}px ${Math.round(height * 0.26)}px`,
            }}
          >
            {body}
          </AbsoluteFill>
        </>
      )}
      <div
        style={{
          position: "absolute",
          left: pad,
          bottom: Math.round(height * (overlay ? 0.06 : 0.12)),
          color: "rgba(255,255,255,0.45)",
          fontSize: Math.round(width * 0.026),
          letterSpacing: "0.24em",
          opacity: captionIn,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
