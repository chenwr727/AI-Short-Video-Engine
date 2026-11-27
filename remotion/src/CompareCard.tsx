import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CardBackdrop, OverlayPlate, riseIn, snapPx, springIn } from "./card-kit";
import { wrapTitle } from "./text";

/**
 * 立场对比卡。
 *
 * 新闻评论里大量内容是「A 这么做，B 却那样做」（贝森特立即改口、鲁比奥选择沉默），
 * 空镜表达不了这种对立关系。
 *
 * 有 bgImage 时素材做底、信息缩进玻璃板；否则是纯设计卡。
 */
export type CompareVariant = "columns" | "stacked";

export type CompareSide = {
  name: string;
  stance: string;
  note?: string;
};

export type CompareCardProps = {
  /** 顶部标题，如「两个人的选择」 */
  title?: string;
  /** 左右两栏；后端把 compare 摊平后按 left/right 传入 */
  left?: CompareSide;
  right?: CompareSide;
  label?: string;
  accent?: string;
  /** 右栏主色，默认比 accent 冷一档，形成对照 */
  rightAccent?: string;
  /** 底图（素材帧的 data URI）；传了就走「叠加」形态 */
  bgImage?: string;
  /** 排版；缺省 columns */
  variant?: CompareVariant;
  /**
   * 左右两栏各自的出现时刻（秒），由台词里对应的人物那一句算出来。
   * 缺省就按固定错位出场 —— 至少还有先后，不会同时砸出来。
   */
  compareAt?: { left: number; right: number };
  /** 只输出透明的信息层，不含背景，给 ffmpeg overlay 用 */
  transparent?: boolean;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

const FALLBACK_SIDE: CompareSide = { name: "", stance: "" };

/** 单侧栏位：姓名 + 立场 + 说明 */
const Column: React.FC<{
  name: string;
  note?: string;
  color: string;
  align: "left" | "right";
  appear: number;
  width: number;
  stanceLines: string[];
  overlay: boolean;
  /** 堆叠排版用更小的字号基准；字号统一由 stanceFontSize 算，不在这里重算 */
  stacked?: boolean;
}> = ({ name, note, color, align, appear, width, stanceLines, overlay, stacked = false }) => {
  const nameSize = Math.round(width * (stacked ? (overlay ? 0.038 : 0.042) : overlay ? 0.042 : 0.048));
  const stanceSize = stanceFontSize(width, stacked, overlay);
  const noteSize = Math.round(width * 0.03);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : "flex-end",
        textAlign: align,
        ...riseIn(appear, 34),
      }}
    >
      <div style={{ color, fontSize: nameSize, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
        {name}
      </div>
      <div
        style={{
          marginTop: Math.round(width * 0.022),
          color: "#f5f7ff",
          fontSize: stanceSize,
          fontWeight: 700,
          lineHeight: 1.18,
          whiteSpace: "nowrap",
        }}
      >
        {stanceLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {note ? (
        <div
          style={{
            marginTop: Math.round(width * 0.022),
            color: "rgba(245,247,255,0.55)",
            fontSize: noteSize,
            lineHeight: 1.45,
            whiteSpace: "nowrap",
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

/**
 * 立场文案的字号。
 *
 * 外层用它算每行折几个字，Side 组件用它渲染 —— 两处必须同源，
 * 各写一遍迟早会漂移，折行结果和实际字号对不上就会溢出。
 */
const stanceFontSize = (width: number, stacked: boolean, overlay: boolean): number =>
  Math.round(width * (stacked ? (overlay ? 0.052 : 0.062) : overlay ? 0.058 : 0.072));

export const CompareCard: React.FC<CompareCardProps> = ({
  title = "",
  left = FALLBACK_SIDE,
  right = FALLBACK_SIDE,
  label = "对比",
  accent = "#ff5a3c",
  rightAccent = "#3b82f6",
  bgImage,
  variant = "columns",
  compareAt,
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const overlay = Boolean(bgImage) || transparent;
  const pad = Math.round(width * (overlay ? 0.075 : 0.1));
  const stacked = variant === "stacked";

  const stanceSize = stanceFontSize(width, stacked, overlay);
  /*
   * 每行字数取决于栏宽：
   *   columns —— 左右各占一半，扣掉中缝与间距
   *   stacked —— 整行可用，能放更长的立场文案（这是它存在的理由）
   */
  const columnWidth = stacked ? width - pad * 2 : (width - pad * 2 - Math.round(width * 0.05)) / 2;
  const perLine = Math.max(3, Math.floor(columnWidth / (stanceSize * 1.02)));
  const leftLines = wrapTitle(left.stance, perLine);
  const rightLines = wrapTitle(right.stance, perLine);

  // 有台词定位就跟旁白走：讲到谁，谁才出现；没有就按固定错位
  const leftDelay = compareAt ? Math.round(compareAt.left * fps) : 6;
  const rightDelay = compareAt ? Math.round(compareAt.right * fps) : 12;

  const titleIn = springIn(frame, fps, 0);
  const leftIn = springIn(frame, fps, leftDelay);
  const rightIn = springIn(frame, fps, rightDelay);
  const divider = springIn(frame, fps, Math.max(leftDelay, rightDelay), "linear");
  const plateIn = springIn(frame, fps, 0, "float");

  const body = (
    <>
      {title ? (
        <div
          style={{
            color: "rgba(245,247,255,0.62)",
            fontSize: Math.round(width * 0.032),
            letterSpacing: "0.16em",
            marginBottom: Math.round(width * (overlay ? 0.05 : 0.08)),
            ...riseIn(titleIn, 14),
          }}
        >
          {title}
        </div>
      ) : null}

      {stacked ? (
        /*
         * 上下堆叠：两栏各占一行，中间一条横线。
         * 好处是每栏能拿满可用宽度，立场文案不用被挤成窄柱；
         * 代价是占高更多，所以字号相应收小。
         */
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
          <Column
            name={left.name}
            note={left.note}
            color={accent}
            align="left"
            appear={leftIn}
            width={width}
            stanceLines={leftLines}
            overlay={overlay}
            stacked
          />

          <div
            style={{
              height: Math.max(2, Math.round(width * 0.004)),
              margin: `${Math.round(width * 0.035)}px 0`,
              background: "linear-gradient(to right, transparent, rgba(255,255,255,0.22), transparent)",
              transform: `scaleX(${divider})`,
              transformOrigin: "center",
            }}
          />

          <Column
            name={right.name}
            note={right.note}
            color={rightAccent}
            align="left"
            appear={rightIn}
            width={width}
            stanceLines={rightLines}
            overlay={overlay}
            stacked
          />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "stretch", gap: Math.round(width * 0.04) }}>
          <Column
            name={left.name}
            note={left.note}
            color={accent}
            align="left"
            appear={leftIn}
            width={width}
            stanceLines={leftLines}
            overlay={overlay}
          />

          {/* 中缝：一条渐隐竖线，把两边隔开又不显生硬 */}
          <div
            style={{
              width: Math.max(2, Math.round(width * 0.004)),
              background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.22), transparent)",
              transform: `scaleY(${divider})`,
              transformOrigin: "center",
              flexShrink: 0,
            }}
          />

          <Column
            name={right.name}
            note={right.note}
            color={rightAccent}
            align="right"
            appear={rightIn}
            width={width}
            stanceLines={rightLines}
            overlay={overlay}
          />
        </div>
      )}
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
          <CardBackdrop accent={accent} origin="50% 30%" />
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
          opacity: divider,
          transform: `translateY(${snapPx((1 - divider) * 10)}px)`,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
