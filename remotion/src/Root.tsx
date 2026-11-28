import { Composition } from "remotion";
import { ChapterCard, type ChapterCardProps } from "./ChapterCard";
import { ChapterSplit } from "./ChapterSplit";
import { CompareCard, type CompareCardProps } from "./CompareCard";
import { OutroCard, type OutroCardProps } from "./OutroCard";
import { OutroMinimal } from "./OutroMinimal";
import { PersonCard, type PersonCardProps } from "./PersonCard";
import { QuoteCard, type QuoteCardProps } from "./QuoteCard";
import { StatCard, type StatCardProps } from "./StatCard";
import { SubtitleLayer, type SubtitleLayerProps } from "./SubtitleLayer";
import { TimelineCard, type TimelineCardProps } from "./TimelineCard";
import { TitleCard, type TitleCardProps } from "./TitleCard";
import { TitleHero } from "./TitleHero";

/**
 * 所有卡片的画幅/帧率/时长都由 props 决定，Studio 只做预览。
 * 16 个 Composition 共用同一段计算，不必各写一遍。
 */
const calculateMetadata = ({ props }: { props: Record<string, unknown> }) => ({
  width: props.width as number,
  height: props.height as number,
  fps: props.fps as number,
  durationInFrames: props.durationInFrames as number,
});

const titleDefaults: TitleCardProps = {
  title: "标题示例",
  subtitle: "",
  label: "",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 48,
};

const outroDefaults: OutroCardProps = {
  title: "关注我，下期见",
  handle: "@你的账号",
  subtitle: "",
  label: "下期见",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 72,
};

const quoteDefaults: QuoteCardProps = {
  quote: "没有合适素材时，用一句观点撑住画面",
  label: "观点",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 96,
};

const chapterDefaults: ChapterCardProps = {
  title: "这一段要讲什么",
  index: 2,
  total: 6,
  label: "PART",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 48,
};

/* defaultProps 留空壳：漏传的字段会被印到成片上 */
const personDefaults: PersonCardProps = {
  title: "",
  role: "",
  line: "",
  label: "人物",
  index: 1,
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 60,
};

const compareDefaults: CompareCardProps = {
  title: "",
  left: { name: "", stance: "" },
  right: { name: "", stance: "" },
  label: "对比",
  accent: "#ff5a3c",
  rightAccent: "#3b82f6",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 72,
};

const timelineDefaults: TimelineCardProps = {
  title: "",
  timeline: [],
  label: "时间线",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 84,
};

const statDefaults: StatCardProps = {
  stat: { value: "", bars: [] },
  label: "数据",
  accent: "#ff5a3c",
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 72,
};

/** 字幕层的参数全部来自后端，这里只给一份能让 Studio 打开的最小样例 */
const subtitleDefaults: SubtitleLayerProps = {
  cues: [{ lines: ["字幕层示例", "第二行"], start: 0, end: 2, style: "Subtitle" }],
  width: 1080,
  height: 1920,
  fps: 24,
  durationInFrames: 48,
  fontName: "Microsoft YaHei",
  subtitleSize: 72,
  titleSize: 101,
  subtitleMarginV: 639,
  titleMarginV: 0,
  marginL: 108,
  marginR: 108,
  subtitleOutline: 3,
  titleOutline: 5.1,
  subtitleShadow: 2,
  titleShadow: 3.4,
  shadowColour: "&H80000000",
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="TitleCard"
      component={TitleCard}
      width={titleDefaults.width}
      height={titleDefaults.height}
      fps={titleDefaults.fps}
      durationInFrames={titleDefaults.durationInFrames}
      defaultProps={titleDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="ChapterCard"
      component={ChapterCard}
      width={chapterDefaults.width}
      height={chapterDefaults.height}
      fps={chapterDefaults.fps}
      durationInFrames={chapterDefaults.durationInFrames}
      defaultProps={chapterDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="QuoteCard"
      component={QuoteCard}
      width={quoteDefaults.width}
      height={quoteDefaults.height}
      fps={quoteDefaults.fps}
      durationInFrames={quoteDefaults.durationInFrames}
      defaultProps={quoteDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="OutroCard"
      component={OutroCard}
      width={outroDefaults.width}
      height={outroDefaults.height}
      fps={outroDefaults.fps}
      durationInFrames={outroDefaults.durationInFrames}
      defaultProps={outroDefaults}
      calculateMetadata={calculateMetadata}
    />
    {/* 备选版式：同一套 props，AI 和用户都可以换 */}
    <Composition
      id="TitleHero"
      component={TitleHero}
      width={titleDefaults.width}
      height={titleDefaults.height}
      fps={titleDefaults.fps}
      durationInFrames={titleDefaults.durationInFrames}
      defaultProps={titleDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="ChapterSplit"
      component={ChapterSplit}
      width={chapterDefaults.width}
      height={chapterDefaults.height}
      fps={chapterDefaults.fps}
      durationInFrames={chapterDefaults.durationInFrames}
      defaultProps={chapterDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="OutroMinimal"
      component={OutroMinimal}
      width={outroDefaults.width}
      height={outroDefaults.height}
      fps={outroDefaults.fps}
      durationInFrames={outroDefaults.durationInFrames}
      defaultProps={outroDefaults}
      calculateMetadata={calculateMetadata}
    />
    {/* 人物/实体名条：新闻评论里「谁在说话」比空镜更准确 */}
    <Composition
      id="PersonCard"
      component={PersonCard}
      width={personDefaults.width}
      height={personDefaults.height}
      fps={personDefaults.fps}
      durationInFrames={personDefaults.durationInFrames}
      defaultProps={personDefaults}
      calculateMetadata={calculateMetadata}
    />
    {/* 变体：同一组件换排版，用独立 id 让后端按白名单选 */}
    <Composition
      id="PersonCardHero"
      component={PersonCard}
      width={personDefaults.width}
      height={personDefaults.height}
      fps={personDefaults.fps}
      durationInFrames={personDefaults.durationInFrames}
      defaultProps={{ ...personDefaults, variant: "hero" as const }}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="PersonCardCompact"
      component={PersonCard}
      width={personDefaults.width}
      height={personDefaults.height}
      fps={personDefaults.fps}
      durationInFrames={personDefaults.durationInFrames}
      defaultProps={{ ...personDefaults, variant: "compact" as const }}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="CompareCardStacked"
      component={CompareCard}
      width={compareDefaults.width}
      height={compareDefaults.height}
      fps={compareDefaults.fps}
      durationInFrames={compareDefaults.durationInFrames}
      defaultProps={{ ...compareDefaults, variant: "stacked" as const }}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="StatCardSplit"
      component={StatCard}
      width={statDefaults.width}
      height={statDefaults.height}
      fps={statDefaults.fps}
      durationInFrames={statDefaults.durationInFrames}
      defaultProps={{ ...statDefaults, variant: "split" as const }}
      calculateMetadata={calculateMetadata}
    />
    {/* 新闻评论信息卡：对比 / 时间线 / 数据 */}
    <Composition
      id="CompareCard"
      component={CompareCard}
      width={compareDefaults.width}
      height={compareDefaults.height}
      fps={compareDefaults.fps}
      durationInFrames={compareDefaults.durationInFrames}
      defaultProps={compareDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="TimelineCard"
      component={TimelineCard}
      width={timelineDefaults.width}
      height={timelineDefaults.height}
      fps={timelineDefaults.fps}
      durationInFrames={timelineDefaults.durationInFrames}
      defaultProps={timelineDefaults}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="StatCard"
      component={StatCard}
      width={statDefaults.width}
      height={statDefaults.height}
      fps={statDefaults.fps}
      durationInFrames={statDefaults.durationInFrames}
      defaultProps={statDefaults}
      calculateMetadata={calculateMetadata}
    />
    {/* 透明字幕层：输出 VP9 + alpha，合流时 overlay 到成片上 */}
    <Composition
      id="SubtitleLayer"
      component={SubtitleLayer}
      width={subtitleDefaults.width}
      height={subtitleDefaults.height}
      fps={subtitleDefaults.fps}
      durationInFrames={subtitleDefaults.durationInFrames}
      defaultProps={subtitleDefaults}
      calculateMetadata={calculateMetadata}
    />
  </>
);
