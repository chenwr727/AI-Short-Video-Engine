import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BeatList, CardBackdrop, OverlayPlate, popIn, riseIn, snapPx, springIn, type Beat } from "./card-kit";
import { wrapTitle } from "./text";

/**
 * 人物/实体名条卡。
 *
 * 新闻评论里最常出场的不是「画面」，而是「谁」——图库给不出具体人物，
 * 名条卡能把「谁 + 什么身份 + 一句核心判断」讲清楚。
 *
 * 形态（有无底图/是否透明）与排版（variant）互相独立：
 * 同一种排版既能出整段卡片，也能出透明信息层。
 */
export type PersonVariant = "plate" | "hero" | "compact";

export type PersonCardProps = {
  /** 主要人物或实体，如「黄仁勋」。统一走 title 字段，与其它卡片一致 */
  title: string;
  /** 身份/职务，如「英伟达 CEO」 */
  role?: string;
  /** 一句核心判断（没有逐条要点时用它） */
  line?: string;
  /**
   * 头像位上的字，1 个汉字。留空则用抽象人形标记。
   * 音译名（川普/马斯克）不该有字，中文名可以给姓氏。
   */
  avatar?: string;
  /** 逐条上屏的要点：到各自的秒数才出现，替代 line */
  beats?: Beat[];
  /** 左下角小标签 */
  label?: string;
  /** 右侧序号，传 0 隐藏 */
  index?: number;
  accent?: string;
  /** 底图（素材帧的 data URI）；传了就走「自带背景」形态 */
  bgImage?: string;
  /** 排版；缺省 plate。有底图/透明时 compact 更常用 */
  variant?: PersonVariant;
  /**
   * 只输出透明的信息层，不含任何背景。
   * 给 ffmpeg overlay 用：素材由原有管线渲染（保留运镜），信息层单独叠上去。
   */
  transparent?: boolean;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/**
 * 头像方块：主色描边 + 一个视觉标记，是「有人在说话」的锚点。
 *
 * 早先这里放名字首字，但音译名根本没有「首字」这回事：
 * 川普 → 「川」、贝森特 → 「贝」、马斯克 → 「马」，读起来像另一个人。
 * 即使中文名，取姓也和信息块里的全名对不上。
 *
 * 所以改成不依赖姓名的几何标记（竖条 + 圆点，像一张简化的发言人头像），
 * 永远不会错。avatar 显式给了才显示那个字（由 AI 判断是否适合，见草稿字段）。
 */
const Avatar: React.FC<{ avatar?: string; accent: string; side: number; progress: number }> = ({
  avatar,
  accent,
  side,
  progress,
}) => (
  <div
    style={{
      width: side,
      height: side,
      borderRadius: Math.round(side * 0.18),
      border: `${Math.max(2, Math.round(side * 0.03))}px solid ${accent}`,
      background: `linear-gradient(150deg, ${accent}26 0%, transparent 70%)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      ...popIn(progress, 0.72),
    }}
  >
    {avatar ? (
      <span style={{ color: accent, fontSize: Math.round(side * 0.48), fontWeight: 700, lineHeight: 1 }}>{avatar}</span>
    ) : (
      /* 无字兜底：一个「人」的抽象轮廓，比一个错的字更诚实 */
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(side * 0.1) }}>
        <div
          style={{
            width: Math.round(side * 0.2),
            height: Math.round(side * 0.2),
            borderRadius: 99,
            backgroundColor: accent,
          }}
        />
        <div
          style={{
            width: Math.round(side * 0.42),
            height: Math.round(side * 0.24),
            borderTopLeftRadius: Math.round(side * 0.2),
            borderTopRightRadius: Math.round(side * 0.2),
            backgroundColor: accent,
            opacity: 0.75,
          }}
        />
      </div>
    )}
  </div>
);

export const PersonCard: React.FC<PersonCardProps> = ({
  title: name,
  role = "",
  line = "",
  avatar = "",
  beats,
  label = "人物",
  index = 0,
  accent = "#ff5a3c",
  bgImage,
  variant = "plate",
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // 有底图或透明层 → 信息不能铺满画面，得留出素材
  const overlay = Boolean(bgImage) || transparent;
  const pad = Math.round(width * (overlay ? 0.075 : 0.1));
  const available = width - pad * 2;

  // compact 只对叠加形态有意义（要让出素材画面）；没底图的整段卡片退回 plate，免得白留一片空
  const hero = variant === "hero" && !overlay;
  const compact = variant === "compact" && overlay;

  const nameSize = Math.round(width * (hero ? 0.155 : compact ? 0.072 : overlay ? 0.088 : 0.115));
  /*
   * 名字是单行 nowrap，必须按实际可用宽度缩，不能给一个固定下限。
   * 早先写 max(0.55, 9/len)：9 个字时下限把它卡在 0.55，hero 版需要 1518px
   * 而可用只有 864px，名字直接顶出画面被裁掉。这里按字数算需要多宽，
   * 不够就等比缩到刚好放下（中文字宽≈字号，再加 1% 字距）。
   */
  const nameChars = Math.max(1, [...name].length);
  const nameFit = Math.min(1, available / (nameSize * nameChars * 1.01));
  // floor 而非 round：round 向上取整会多出 1px，正好把最后一个字挤出画面
  const finalNameSize = Math.max(12, Math.floor(nameSize * nameFit));
  const lineSize = Math.round(width * (hero ? 0.058 : compact ? 0.038 : overlay ? 0.046 : 0.052));
  const lineLines = line ? wrapTitle(line, Math.max(8, Math.floor(available / (lineSize * 1.05)))) : [];

  const avatarIn = springIn(frame, fps, 0);
  const nameIn = springIn(frame, fps, 6);
  const roleIn = springIn(frame, fps, 10);
  const ruleGrow = springIn(frame, fps, 13, "linear");
  // 整块信息层的入场：float 更软，不抢素材的戏
  const plateIn = springIn(frame, fps, 0, "float");

  const avatarSide = Math.round(width * (hero ? 0.26 : compact ? 0.1 : overlay ? 0.13 : 0.2));

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: Math.round(width * 0.035) }}>
        <Avatar avatar={avatar} accent={accent} side={avatarSide} progress={avatarIn} />
        {/*
          姓名与身份放在同一个块里：不设 minWidth:0，否则长身份会把 flex 压窄，
          「面临听证会审查与内部整顿的核心人物」这种会被挤成两行，姓名跟着错位。
          身份超长时按折行区宽度自然换行即可。
        */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div
            style={{
              color: "#f5f7ff",
              fontSize: finalNameSize,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              ...riseIn(nameIn, 26),
            }}
          >
            {name}
          </div>
          {role ? (
            <div
              style={{
                marginTop: Math.round(width * 0.012),
                color: accent,
                fontSize: Math.round(width * (hero ? 0.044 : compact ? 0.026 : overlay ? 0.031 : 0.038)),
                fontWeight: 500,
                letterSpacing: "0.04em",
                lineHeight: 1.35,
                ...riseIn(roleIn, 18),
              }}
            >
              {role}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          height: Math.max(3, Math.round(width * 0.005)),
          width: Math.round(width * (overlay ? 0.1 : 0.14)) * ruleGrow,
          backgroundColor: accent,
          marginTop: Math.round(width * 0.032),
          borderRadius: 99,
        }}
      />

      {/*
        有要点就逐条上屏：每条按旁白念到的时刻出现，整段 30 秒里画面一直有新东西。
        没有要点才退回「一句判断」的静态版式。
      */}
      {beats && beats.length > 0 ? (
        <BeatList beats={beats} accent={accent} width={width} size={lineSize} />
      ) : lineLines.length > 0 ? (
        <div style={{ marginTop: Math.round(width * 0.03) }}>
          {lineLines.map((text, i) => {
            const enter = springIn(frame, fps, 16 + i * 3);
            return (
              <div
                key={`${text}-${i}`}
                style={{
                  color: "rgba(245,247,255,0.9)",
                  fontSize: lineSize,
                  fontWeight: 400,
                  lineHeight: 1.42,
                  whiteSpace: "nowrap",
                  ...riseIn(enter, 18),
                }}
              >
                {text}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );

  return (
    <AbsoluteFill style={{ fontFamily: FONT, backgroundColor: transparent ? "transparent" : undefined }}>
      {overlay ? (
        <>
          {/*
            只有「自带背景」的整段卡片才铺底图。
            transparent 优先于 bgImage：透明层做完要叠到实拍素材上，
            这里再画一张静帧就等于把素材整幅盖掉了 —— 底图会变成死图。
          */}
          {bgImage && !transparent ? (
            <AbsoluteFill
              style={{
                backgroundImage: `url(${bgImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : null}
          {compact ? (
            /* 右下角小条：让素材画面尽量完整，信息只占一角 */
            <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end" }}>
              <div
                style={{
                  // 底板留出字幕带（y≈1105 起），小条只在其上
                  margin: `0 ${Math.round(pad * 0.6)}px ${Math.round(height * 0.45)}px`,
                  maxWidth: Math.round(width * 0.72),
                  padding: `${Math.round(width * 0.032)}px ${Math.round(width * 0.04)}px`,
                  borderRadius: Math.round(width * 0.03),
                  background: "linear-gradient(160deg, rgba(12,18,30,0.9) 0%, rgba(8,11,18,0.95) 100%)",
                  border: `${Math.max(1, Math.round(width * 0.0022))}px solid ${accent}55`,
                  boxShadow: `0 ${Math.round(width * 0.016)}px ${Math.round(width * 0.05)}px rgba(0,0,0,0.55)`,
                  opacity: plateIn,
                  transform: `translateY(${snapPx((1 - plateIn) * 40)}px)`,
                }}
              >
                {body}
              </div>
            </AbsoluteFill>
          ) : (
            <OverlayPlate accent={accent} progress={plateIn} width={width} height={height}>
              {body}
            </OverlayPlate>
          )}
        </>
      ) : (
        <>
          <CardBackdrop accent={accent} />
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              // hero 垂直居中更像封面；plate 靠上留出呼吸
              justifyContent: hero ? "center" : "flex-start",
              alignItems: "flex-start",
              padding: `${Math.round(height * (hero ? 0.1 : 0.17))}px ${pad}px ${Math.round(height * (hero ? 0.12 : 0.24))}px`,
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
          opacity: ruleGrow,
        }}
      >
        {label}
      </div>

      {index > 0 ? (
        <div
          style={{
            position: "absolute",
            right: pad,
            bottom: Math.round(height * (overlay ? 0.045 : 0.1)),
            color: `${accent}22`,
            fontSize: Math.round(width * 0.13),
            fontWeight: 700,
            lineHeight: 1,
            opacity: ruleGrow,
            transform: `translateX(${snapPx((1 - ruleGrow) * 20)}px)`,
          }}
        >
          {String(index).padStart(2, "0")}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
