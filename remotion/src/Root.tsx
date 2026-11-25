import { Composition } from "remotion";
import { ChapterCard, type ChapterCardProps } from "./ChapterCard";
import { ChapterSplit } from "./ChapterSplit";
import { OutroCard, type OutroCardProps } from "./OutroCard";
import { OutroMinimal } from "./OutroMinimal";
import { QuoteCard, type QuoteCardProps } from "./QuoteCard";
import { SubtitleLayer, type SubtitleLayerProps } from "./SubtitleLayer";
import { TitleCard, type TitleCardProps } from "./TitleCard";
import { TitleHero } from "./TitleHero";

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
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="ChapterCard"
      component={ChapterCard}
      width={chapterDefaults.width}
      height={chapterDefaults.height}
      fps={chapterDefaults.fps}
      durationInFrames={chapterDefaults.durationInFrames}
      defaultProps={chapterDefaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="QuoteCard"
      component={QuoteCard}
      width={quoteDefaults.width}
      height={quoteDefaults.height}
      fps={quoteDefaults.fps}
      durationInFrames={quoteDefaults.durationInFrames}
      defaultProps={quoteDefaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="OutroCard"
      component={OutroCard}
      width={outroDefaults.width}
      height={outroDefaults.height}
      fps={outroDefaults.fps}
      durationInFrames={outroDefaults.durationInFrames}
      defaultProps={outroDefaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
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
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="ChapterSplit"
      component={ChapterSplit}
      width={chapterDefaults.width}
      height={chapterDefaults.height}
      fps={chapterDefaults.fps}
      durationInFrames={chapterDefaults.durationInFrames}
      defaultProps={chapterDefaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="OutroMinimal"
      component={OutroMinimal}
      width={outroDefaults.width}
      height={outroDefaults.height}
      fps={outroDefaults.fps}
      durationInFrames={outroDefaults.durationInFrames}
      defaultProps={outroDefaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
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
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.durationInFrames,
      })}
    />
  </>
);
