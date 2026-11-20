import { Composition } from "remotion";
import { ChapterCard, type ChapterCardProps } from "./ChapterCard";
import { ChapterSplit } from "./ChapterSplit";
import { OutroCard, type OutroCardProps } from "./OutroCard";
import { OutroMinimal } from "./OutroMinimal";
import { QuoteCard, type QuoteCardProps } from "./QuoteCard";
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
  </>
);
