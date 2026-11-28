import { Fragment, useEffect, useState } from "react";
import { applyInfoCard, cardStillUrl, clearInfoCard, materialPreviewUrl, rewriteCard, searchMaterial } from "../api";
import { useT } from "../i18n";
import { MATERIAL_STAGE_IDS } from "../phases";
import type { CardPrefs, CardSpec, MaterialInfo, MaterialItem, MaterialManifest, Meta, TaskState } from "../types";
import { Dropdown } from "./Dropdown";
import { ConfigSection, Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";
import type { RenderFormState } from "./stepTypes";

interface MaterialStepProps {
  task: TaskState;
  busy: boolean;
  error: string;
  /** 手动换过的素材，放在上层以免切步骤丢失 */
  picked: Record<number, MaterialInfo>;
  onPickedChange: (next: Record<number, MaterialInfo>) => void;
  onConfirm: (items: (MaterialInfo & { paragraph: number })[]) => void;
  /** force 表示已匹配过也重来 */
  onMatch: (force?: boolean) => void;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
  /** 已完成任务回看时，从这里进成片预览 */
  onNext: () => void;
  meta: Meta | null;
  form: RenderFormState;
  onFormChange: (patch: Partial<RenderFormState>) => void;
  /** 换信息卡这类操作直接返回新状态，用它刷新页面数据 */
  onStateChange: (state: TaskState) => void;
  /** 启用版式阶段时，确认按钮指向「成片预览」 */
  nextLabel?: string;
  /** 版式参数：与素材一起确认，确认时一并落库 */
  cardPrefs?: CardPrefs;
  onCardPrefsChange?: (patch: Partial<CardPrefs>) => void;
  /** 版式清单，用来回显每类卡当前时长 */
  cards?: TaskState["cards"];
  cardDefaults?: Meta["cardDefaults"];
}

/**
 * 信息卡静帧。
 *
 * 静帧是懒生成的：第一次请求时后端才现渲染，一张要 6 秒上下。
 * 这里失败重试 4 次、每次等待递增 —— 后端是排队渲染的，立刻重试只会
 * 挤在同一条队伍前面一路空转。正常情况生成信息卡时后端已把静帧渲好，
 * 这里是命中文件，重试只是给「换卡后 / 渲染失败过」兜底。
 */
const STILL_RETRIES = 4;

function CardStill({ id, fingerprint }: { id: string; fingerprint?: string }) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  /** 重试用尽后等用户点一下再试，避免一直显示占位没法救 */
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [id, fingerprint]);

  if (failed) {
    return (
      <button
        className="material-video card-still-empty"
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt(0);
          // 换一个查询串，让浏览器重新发请求而不是复用失败结果
          setReload((prev) => prev + 1);
        }}
      >
        {t("material.previewRetry")}
      </button>
    );
  }

  const bust = attempt > 0 || reload > 0 ? `${fingerprint ? "&" : "?"}r=${attempt + reload}` : "";

  return (
    <img
      className="material-video"
      src={`${cardStillUrl(id, fingerprint)}${bust}`}
      alt=""
      onError={() => {
        if (attempt < STILL_RETRIES) {
          // 递增等待：后端是排队渲染的，立刻重试只会挤在同一条队伍前面
          const wait = 1500 * (attempt + 1);
          setTimeout(() => setAttempt((prev) => prev + 1), wait);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

/**
 * 信息卡（叠在某段素材上的那一层）单独占一格。
 *
 * 早先塞在段落格内部，导致那一格比同行的片头/章节卡高出一大截，
 * 3 列网格的高低差全乱。拆成独立格子后每格高度只由自己的内容决定。
 */
function InfoCardTile({
  spec,
  paragraph,
  busy,
  cardBusy,
  onToInfoCard,
  onDropInfoCard,
}: {
  spec: CardSpec;
  paragraph: number;
  busy: boolean;
  /** 正在忙的段号与动作：只有被点的那一个按钮显示进度，另一个保持原文案 */
  cardBusy: { paragraph: number; action: "apply" | "clear" } | null;
  onToInfoCard: (paragraph: number, template?: string) => Promise<void>;
  onDropInfoCard: (paragraph: number) => Promise<void>;
}) {
  const t = useT();
  const here = cardBusy?.paragraph === paragraph ? cardBusy.action : null;

  return (
    <div className="timeline-tile is-infocard">
      <CardStill id={spec.id} fingerprint={spec.fingerprint} />
      <div className="material-info">
        <div className="material-title">
          {t("material.cardLabel")}
          <span className="pill info">{spec.compositionId}</span>
        </div>
        <div className="material-tags">{spec.title}</div>
        <div className="material-meta">
          {t("material.overlayMeta", { n: paragraph, sec: Math.round(spec.durationSec) })}
        </div>
        <div className="material-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || here !== null}
            onClick={() => void onToInfoCard(paragraph)}
            title={t("material.rejudgeCard")}
          >
            {here === "apply" ? t("common.generating") : t("material.changeCard")}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || here !== null}
            onClick={() => void onDropInfoCard(paragraph)}
          >
            {here === "clear" ? t("common.processing") : t("material.clearCard")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 版式卡（片头 / 章节 / 片尾）在时间线网格里的一格。
 *
 * 和素材格同宽同高，这样「哪张卡插在哪一段前面」能一眼看出来；
 * 底图用服务端已渲好的静帧，和最终成片里那张卡是同一份产物。
 * landscape 决定用 16:9 还是 9:16 的框，和成片画幅一致。
 */
function CardTile({
  spec,
  landscape,
  busy,
  swapping,
  onSwap,
}: {
  spec: CardSpec;
  landscape: boolean;
  busy: boolean;
  /** 正在换文案的卡片 id，0 表示空闲 */
  swapping: string;
  onSwap: (id: string) => Promise<void>;
}) {
  const t = useT();
  const kindLabel =
    spec.kind === "intro" ? t("material.intro") : spec.kind === "chapter" ? t("material.chapter") : t("material.outro");
  const working = swapping === spec.id;
  return (
    <div className={`timeline-tile is-card kind-${spec.kind}${landscape ? " is-landscape" : ""}`}>
      <CardStill id={spec.id} fingerprint={spec.fingerprint} />
      <div className="material-info">
        <div className="material-title">
          {kindLabel}
          <span className="pill info">{spec.compositionId}</span>
        </div>
        <div className="material-tags">{spec.title}</div>
        <div className="material-meta">
          {spec.kind === "chapter" ? `${t("material.beforeSection", { n: spec.paragraph ?? 0 })} · ` : ""}
          {spec.durationSec}s
        </div>
        <div className="material-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || working}
            onClick={() => void onSwap(spec.id)}
            title={t("material.changeCardHint")}
          >
            {working ? t("material.changeCardRunning") : t("material.changeOne")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MaterialTileProps {
  item: MaterialItem;
  candidate?: MaterialInfo;
  manifest: MaterialManifest;
  awaiting: boolean;
  busy: boolean;
  searching: number;
  cardBusy: { paragraph: number; action: "apply" | "clear" } | null;
  panel: { paragraph: number; list: MaterialInfo[] } | null;
  onFindMore: (item: MaterialItem) => Promise<void>;
  onToInfoCard: (paragraph: number, template?: string) => Promise<void>;
  onDropInfoCard: (paragraph: number) => Promise<void>;
  onUndo: (paragraph: number) => void;
  onPick: (item: MaterialItem, entry: MaterialInfo) => void;
}

/**
 * 段落素材格：实拍 + 叠在它上面的信息卡。
 *
 * 信息卡拆成紧随其后的独立格子返回（而不是嵌在里面），
 * 否则这一格会比同行的片头/章节卡高一截，3 列网格的高低差全乱。
 */
function MaterialTile(props: MaterialTileProps) {
  const t = useT();
  const { item, candidate, manifest, awaiting, busy, searching, cardBusy, panel } = props;
  const preview = candidate ? candidate.url : materialPreviewUrl(item.paragraph, item.url);
  const info = candidate ?? item;
  // 按素材自身画幅决定框型：竖屏素材用 9:16，横屏用 16:9，不裁画面
  const landscape = info.width > info.height;

  return (
    <>
      <div className={`timeline-tile is-material${landscape ? " is-landscape" : ""}`}>
        {item.infoCard ? (
          <video
            className="material-video"
            src={materialPreviewUrl(item.paragraph, item.url)}
            controls
            preload="metadata"
            playsInline
          />
        ) : (
          <video className="material-video" src={preview} controls preload="metadata" playsInline />
        )}
        <div className="material-info">
          <div className="material-title">
            {t("material.paragraph", { n: item.paragraph })}
            {!item.infoCard && candidate && <span className="pill info">{t("material.pendingReplace")}</span>}
          </div>
          <div className="material-tags">{info.tags || `#${info.id}`}</div>
          <div className="material-meta">
            {info.duration}s · {info.width}×{info.height} · {manifest.source}
          </div>
          {/*
          按钮不跟着信息卡一起消失：信息卡默认开启，几乎每段都有卡，
          早先把「换一个」放在 !item.infoCard 里面，等于素材按钮全体失踪。
          「换一个」换的是底下的实拍素材，有卡时同样需要。
        */}
          {awaiting && (
            <div className="material-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy || searching === item.paragraph}
                onClick={() => void props.onFindMore(item)}
                title={item.infoCard ? t("material.changeClipTitle") : t("material.changeClip")}
              >
                {searching === item.paragraph ? t("common.searching") : t("material.changeOne")}
              </button>
              {!item.infoCard && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || cardBusy?.paragraph === item.paragraph}
                  onClick={() => void props.onToInfoCard(item.paragraph)}
                  title={t("material.cardHint")}
                >
                  {cardBusy?.paragraph === item.paragraph && cardBusy.action === "apply"
                    ? t("common.generating")
                    : t("material.addCard")}
                </button>
              )}
              {candidate && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void props.onUndo(item.paragraph)}
                >
                  {t("material.undo")}
                </button>
              )}
            </div>
          )}
        </div>

        {panel?.paragraph === item.paragraph && panel.list.length > 0 && (
          <div className="candidates">
            {panel.list.map((entry) => (
              <button
                className="candidate"
                type="button"
                key={entry.url}
                disabled={busy}
                onClick={() => props.onPick(item, entry)}
                title={entry.tags || `#${entry.id}`}
              >
                {entry.imageUrl ? (
                  <img src={entry.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className="candidate-empty" />
                )}
                <span className="candidate-meta">
                  {entry.duration}s · {entry.width}×{entry.height}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 信息卡单独一格，紧跟在段落后面 */}
      {item.infoCard && (
        <InfoCardTile
          spec={item.infoCard}
          paragraph={item.paragraph}
          busy={busy}
          cardBusy={cardBusy}
          onToInfoCard={props.onToInfoCard}
          onDropInfoCard={props.onDropInfoCard}
        />
      )}
    </>
  );
}

/** 第四步：选来源与分辨率 → 匹配素材 → 逐段确认 */
export function MaterialStep(props: MaterialStepProps) {
  const {
    task,
    busy,
    error,
    picked,
    onPickedChange,
    onConfirm,
    onMatch,
    onRetry,
    onCancel,
    onBack,
    onNext,
    meta,
    form,
    onFormChange,
    onStateChange,
    nextLabel,
    cardPrefs,
    onCardPrefsChange,
    cards,
    cardDefaults,
  } = props;
  const t = useT();
  const manifest = task.material;
  const awaiting = task.status === "awaiting_material" || task.status === "material_ready";
  const editable = awaiting || task.status === "completed";
  // running 也可能是 compose 在跑
  const materialStage = task.stages.find((stage) => stage.id === "material");
  const matching = task.status === "running" && materialStage?.status === "running";
  const pending = task.status === "running";
  const failed = task.status === "failed" || task.status === "cancelled";
  const cancelled = task.status === "cancelled";
  // 失败或停止且无素材时，允许换来源重来
  const canMatchAgain = failed && !manifest && Boolean(task.audio);

  const stepStage: StepStage = failed
    ? "failed"
    : matching || (pending && !manifest)
      ? "running"
      : manifest
        ? "ready"
        : "setup";
  const layout = stepLayout(stepStage, Boolean(manifest));

  const sourceHint = meta?.materialSources.find((option) => option.id === form.materialSource)?.description;
  const sourceLabel =
    meta?.materialSources.find((option) => option.id === form.materialSource)?.label ?? form.materialSource;
  const resolutionLabel = meta?.resolutions.find((option) => option.id === form.resolution)?.label ?? form.resolution;

  /*
   * 版式卡的画幅跟成片一致：成片是竖屏，卡片就是 9:16。
   * 版式清单本身的 width/height 不在前端类型里，直接用成片分辨率判断。
   */
  const cardLandscape = (task.options.height ?? 0) < (task.options.width ?? 0);

  const [panel, setPanel] = useState<{ paragraph: number; list: MaterialInfo[] } | null>(null);
  const [searching, setSearching] = useState(0);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  /** 正在生成或撤销信息卡的段号与动作，null 表示空闲 */
  const [cardBusy, setCardBusy] = useState<{ paragraph: number; action: "apply" | "clear" } | null>(null);
  /** 正在换文案的版式卡 id，空串表示空闲 */
  const [swapping, setSwapping] = useState("");

  /** 让 AI 换一张版式卡的标题（服务端会顺带作废旧成片） */
  async function swapCard(id: string) {
    setSwapping(id);
    setNote(null);
    try {
      const next = await rewriteCard(id, "text");
      onStateChange(next);
      setNote({ text: t("material.cardRewritten") });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setSwapping("");
    }
  }

  /** 把这一段换成信息卡：不传模板时由模型判断该段适合哪种 */
  async function toInfoCard(paragraph: number, template?: string) {
    setCardBusy({ paragraph, action: "apply" });
    setNote(null);
    try {
      const next = await applyInfoCard(paragraph, template);
      onStateChange(next);
      setNote({ text: t("material.cardApplied", { n: paragraph }) });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setCardBusy(null);
    }
  }

  /** 撤掉信息卡，回到实拍 */
  async function dropInfoCard(paragraph: number) {
    setCardBusy({ paragraph, action: "clear" });
    try {
      const next = await clearInfoCard(paragraph);
      onStateChange(next);
      setNote({ text: t("material.cardCleared", { n: paragraph }) });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setCardBusy(null);
    }
  }

  const replacements = Object.entries(picked).map(([paragraph, candidate]) => ({
    ...candidate,
    paragraph: Number(paragraph),
  }));

  async function findMore(item: MaterialItem) {
    setSearching(item.paragraph);
    setNote(null);
    try {
      const list = await searchMaterial(item.paragraph, item.searchTerms);
      setPanel({ paragraph: item.paragraph, list });
      if (list.length === 0) setNote({ text: t("material.noNewClip", { n: item.paragraph }) });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setSearching(0);
    }
  }

  function pick(item: MaterialItem, candidate: MaterialInfo) {
    onPickedChange({ ...picked, [item.paragraph]: candidate });
    setPanel(null);
    setNote({ text: t("material.newClip", { n: item.paragraph }) });
  }

  function undo(paragraph: number) {
    const next = { ...picked };
    delete next[paragraph];
    onPickedChange(next);
  }

  /**
   * 卡片时长回显。
   *
   * 已生成版式时以清单里的实际值为准（用户可能在某张卡上单独改过），
   * 还没生成时用本次任务记住的参数，最后落到设置页默认值。
   * 同类卡取值不一时返回空串，避免谎报成某一个数。
   */
  function cardSec(key: "introDurationSec" | "chapterDurationSec" | "outroDurationSec"): string {
    const kind = key === "introDurationSec" ? "intro" : key === "chapterDurationSec" ? "chapter" : "outro";
    const own = cards?.items.filter((item) => item.kind === kind).map((item) => item.durationSec) ?? [];
    if (cards) {
      if (own.length === 0) return "0";
      const first = own[0];
      return own.every((sec) => sec === first) ? String(first) : "";
    }
    const fallback =
      key === "introDurationSec"
        ? cardDefaults?.introSec
        : key === "chapterDurationSec"
          ? cardDefaults?.chapterSec
          : cardDefaults?.outroSec;
    return String(cardPrefs?.[key] ?? fallback ?? 0);
  }

  /** 留空表示不改，避免每删一个字符就下发一次 */
  function clampSec(raw: string): number {
    if (!raw.trim()) return 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(15, Math.round(parsed * 10) / 10);
  }

  return (
    <Panel
      title={t("material.title")}
      desc={
        manifest
          ? awaiting
            ? t("material.hintDone")
            : t("result.hint")
          : matching
            ? t("material.searching")
            : awaiting
              ? t("material.ready")
              : failed
                ? (task.error ?? t("material.failed"))
                : t("material.needTts")
      }
      fill
    >
      <ConfigSection
        title={t("material.config")}
        summary={`${sourceLabel} · ${resolutionLabel} · ${t("material.intro")} ${cardSec("introDurationSec") || 0}s`}
        open={layout.configOpen}
        resetKey={stepStage}
      >
        {/*
          一行四项，按生成顺序从左到右：片头 → 素材来源 → 分辨率 → 信息卡。
          之前信息卡单独占一行，多出一块空白还打断了「一次配完」的读法；
          它和前面三项一样只是个开关，并进同一行即可。
        */}
        <div className="field-group">
          <div className="row row-4 config-flow">
            <div className="field">
              <label htmlFor="card-intro-sec">
                {t("material.durations")}
                <span className="hint">{t("material.zeroNoShow")}</span>
              </label>
              <div className="card-sec-row">
                <input
                  id="card-intro-sec"
                  className="text-input"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={cardSec("introDurationSec")}
                  disabled={busy || pending || !onCardPrefsChange}
                  title={t("material.introHint")}
                  onChange={(event) => onCardPrefsChange?.({ introDurationSec: clampSec(event.target.value) })}
                />
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={cardSec("chapterDurationSec")}
                  disabled={busy || pending || !onCardPrefsChange}
                  title={t("material.chapterHint")}
                  onChange={(event) => onCardPrefsChange?.({ chapterDurationSec: clampSec(event.target.value) })}
                />
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={cardSec("outroDurationSec")}
                  disabled={busy || pending || !onCardPrefsChange}
                  title={t("material.outroDuration")}
                  onChange={(event) => onCardPrefsChange?.({ outroDurationSec: clampSec(event.target.value) })}
                />
              </div>
              <span className="field-hint">{t("material.orderHint")}</span>
            </div>

            <div className="field">
              <label htmlFor="material-source">{t("material.source")}</label>
              <Dropdown
                id="material-source"
                value={form.materialSource}
                options={(meta?.materialSources ?? []).map((option) => ({ value: option.id, label: option.label }))}
                onChange={(next) => onFormChange({ materialSource: next })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
              />
              <span className="field-hint">{sourceHint ?? t("material.sourceHint")}</span>
            </div>

            <div className="field">
              <label htmlFor="resolution">{t("material.resolution")}</label>
              <Dropdown
                id="resolution"
                value={form.resolution}
                options={(meta?.resolutions ?? []).map((option) => ({ value: option.id, label: option.label }))}
                onChange={(next) => onFormChange({ resolution: next })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
              />
              <span className="field-hint">{t("material.size")}</span>
            </div>

            {/* 信息卡开关：与前三项同一行，用下拉而不是勾选框，和旁边的选择框对齐 */}
            <div className="field">
              <label htmlFor="auto-info-cards">{t("material.infoCard")}</label>
              <Dropdown
                id="auto-info-cards"
                value={form.autoInfoCards === false ? "off" : "on"}
                options={[
                  { value: "on", label: t("material.autoCards") },
                  { value: "off", label: t("material.onlyReal") },
                ]}
                onChange={(next) => onFormChange({ autoInfoCards: next === "on" })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
                title={t("material.cardAutoHint")}
              />
              <span className="field-hint">{t("material.overlayOnly")}</span>
            </div>
          </div>
          <p className="field-hint">
            {manifest
              ? t("material.regenerateHint")
              : canMatchAgain
                ? cancelled
                  ? t("material.stopped")
                  : t("material.failedDetail")
                : t("material.runHint")}
          </p>
        </div>
      </ConfigSection>

      <div className="panel-scroll">
        <StageList stages={task.stages.filter((stage) => MATERIAL_STAGE_IDS.includes(stage.id))} />

        <LogPanel
          logs={task.logs}
          stages={MATERIAL_STAGE_IDS}
          since={task.runStartedAt}
          collapsible
          expanded={layout.logOpen}
          tall={layout.logOpen}
        />

        {layout.showResult && manifest ? (
          <>
            {/*
              版式与素材按成片播放顺序混排成一个网格。
              早先版式单独占一块横条，和下面的素材对不上号 ——
              用户看不出「第 3 段前」到底插在哪，也不知道卡片有几张进成片。
              现在按时间线铺开：片头 → 第 1 段 → 第 2 段前的章节卡 → 第 2 段 → …
            */}
            <div className="timeline-grid">
              {cards?.items
                .filter((spec) => spec.kind === "intro")
                .map((spec) => (
                  <CardTile
                    key={spec.id}
                    spec={spec}
                    landscape={cardLandscape}
                    busy={busy}
                    swapping={swapping}
                    onSwap={swapCard}
                  />
                ))}

              {manifest.items.map((item) => {
                const chapter = cards?.items.find(
                  (spec) => spec.kind === "chapter" && spec.paragraph === item.paragraph,
                );
                return (
                  <Fragment key={item.paragraph}>
                    {/*
                      段落分隔条。
                      3 列网格按行拍平后段落边界完全看不出来（片头 / 第 1 段 / 信息卡 /
                      章节 / 第 2 段…排下来像一串同级卡片），
                      每段前插一条通栏标题，把「这一段从哪开始」标出来。
                    */}
                    <div className="timeline-para">
                      <span className="para-num">{item.paragraph}</span>
                      <span>{t("material.paragraph", { n: item.paragraph })}</span>
                      <span className="para-hint">
                        {chapter ? t("material.chapterCard", { title: chapter.title }) : t("material.noChapter")} ·{" "}
                        {t("material.clipLabel")} {Math.round((picked[item.paragraph] ?? item).duration)}s
                      </span>
                    </div>
                    {chapter && (
                      <CardTile
                        spec={chapter}
                        landscape={cardLandscape}
                        busy={busy}
                        swapping={swapping}
                        onSwap={swapCard}
                      />
                    )}
                    <MaterialTile
                      item={item}
                      candidate={picked[item.paragraph]}
                      manifest={manifest}
                      awaiting={awaiting}
                      busy={busy}
                      searching={searching}
                      cardBusy={cardBusy}
                      panel={panel}
                      onFindMore={findMore}
                      onToInfoCard={toInfoCard}
                      onDropInfoCard={dropInfoCard}
                      onUndo={undo}
                      onPick={pick}
                    />
                  </Fragment>
                );
              })}
              {cards?.items
                .filter((spec) => spec.kind === "outro")
                .map((spec) => (
                  <CardTile
                    key={spec.id}
                    spec={spec}
                    landscape={cardLandscape}
                    busy={busy}
                    swapping={swapping}
                    onSwap={swapCard}
                  />
                ))}
            </div>
          </>
        ) : stepStage === "setup" ? (
          <p className="hint">{t("material.notMatched")}</p>
        ) : null}

        {note && <p className={`hint${note.bad ? " hint-warn" : ""}`}>{note.text}</p>}
        {failed && (
          <div className="alert">
            {task.error ?? (task.status === "cancelled" ? t("material.stopped") : t("error.match"))}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </button>
        {matching && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            {t("material.stopMatch")}
          </button>
        )}
        {(manifest || matching) && !matching && (
          <button className="secondary" type="button" disabled={busy} onClick={() => onMatch(true)}>
            {t("common.regenerate")}
          </button>
        )}
        {awaiting && !manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            {t("material.startMatch")}
          </button>
        )}
        {awaiting && manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onConfirm(replacements)}>
            {(() => {
              const next = nextLabel ?? t("material.nextHint");
              return replacements.length > 0 ? t("material.nextSwapped", { next, n: replacements.length }) : next;
            })()}
          </button>
        )}
        {task.status === "completed" && (
          <button className="primary" type="button" disabled={busy} onClick={onNext}>
            {t("material.backToRender")}
          </button>
        )}

        {/* 停止后按原来源补齐 */}
        {cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={onRetry}>
            {t("common.continue")}
          </button>
        )}
        {canMatchAgain && !cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            {t("material.rematch")}
          </button>
        )}
        {failed && !manifest && task.status === "failed" && (
          <button className={canMatchAgain ? "secondary" : "primary"} type="button" disabled={busy} onClick={onRetry}>
            {t("common.retry")}
          </button>
        )}
      </div>
    </Panel>
  );
}
