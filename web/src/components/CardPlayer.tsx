import { Player } from "@remotion/player";
import { ChapterCard } from "@cards/ChapterCard";
import { ChapterSplit } from "@cards/ChapterSplit";
import { OutroCard } from "@cards/OutroCard";
import { OutroMinimal } from "@cards/OutroMinimal";
import { QuoteCard } from "@cards/QuoteCard";
import { TitleCard } from "@cards/TitleCard";
import { TitleHero } from "@cards/TitleHero";
import type { ComponentType } from "react";
import type { CardSpec } from "../types";

type LooseComponent = ComponentType<Record<string, unknown>>;

/** key 必须与 server/src/card-templates.ts 的白名单一致 */
const COMPONENTS: Record<string, LooseComponent> = {
  TitleCard: TitleCard as unknown as LooseComponent,
  TitleHero: TitleHero as unknown as LooseComponent,
  ChapterCard: ChapterCard as unknown as LooseComponent,
  ChapterSplit: ChapterSplit as unknown as LooseComponent,
  OutroCard: OutroCard as unknown as LooseComponent,
  OutroMinimal: OutroMinimal as unknown as LooseComponent,
  QuoteCard: QuoteCard as unknown as LooseComponent,
};

const FALLBACK_BY_KIND: Record<CardSpec["kind"], string> = {
  intro: "TitleCard",
  chapter: "ChapterCard",
  outro: "OutroCard",
  quote: "QuoteCard",
};

interface Props {
  spec: CardSpec;
  width: number;
  height: number;
  fps: number;
  total: number;
  durationSec?: number;
}

export function CardPlayer({ spec, width, height, fps, total, durationSec }: Props) {
  const seconds = durationSec ?? spec.durationSec;
  const durationInFrames = Math.max(1, Math.round(seconds * fps));
  const Component = COMPONENTS[spec.compositionId] ?? COMPONENTS[FALLBACK_BY_KIND[spec.kind]] ?? COMPONENTS.TitleCard;

  return (
    <Player
      component={Component}
      inputProps={{
        title: spec.title,
        quote: spec.title,
        label: spec.label,
        subtitle: "",
        handle: spec.handle ?? "",
        accent: spec.accent,
        index: spec.paragraph ?? 1,
        total: Math.max(total, spec.paragraph ?? 1),
        width,
        height,
        fps,
        durationInFrames,
      }}
      durationInFrames={durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={fps}
      // 百分比高度在 aspect-ratio 容器里会量成 0，只能用 inset 撑开
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      // 第 0 帧文字全透明，起播点后移到动画收尾处
      initialFrame={Math.round(durationInFrames * 0.62)}
      loop
      autoPlay
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      acknowledgeRemotionLicense
    />
  );
}
