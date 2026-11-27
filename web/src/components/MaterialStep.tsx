import { Fragment, useEffect, useState } from "react";
import { applyInfoCard, cardStillUrl, clearInfoCard, materialPreviewUrl, rewriteCard, searchMaterial } from "../api";
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
        预览还没生成好，点这里重试
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
  const here = cardBusy?.paragraph === paragraph ? cardBusy.action : null;

  return (
    <div className="timeline-tile is-infocard">
      <CardStill id={spec.id} fingerprint={spec.fingerprint} />
      <div className="material-info">
        <div className="material-title">
          信息卡<span className="pill info">{spec.compositionId}</span>
        </div>
        <div className="material-tags">{spec.title}</div>
        <div className="material-meta">
          叠在第 {paragraph} 段素材上 · {Math.round(spec.durationSec)}s
        </div>
        <div className="material-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || here !== null}
            onClick={() => void onToInfoCard(paragraph)}
            title="重新让 AI 判断这段该用哪种卡"
          >
            {here === "apply" ? "生成中…" : "换信息卡"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || here !== null}
            onClick={() => void onDropInfoCard(paragraph)}
          >
            {here === "clear" ? "处理中…" : "取消信息卡"}
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
  const kindLabel = spec.kind === "intro" ? "片头" : spec.kind === "chapter" ? "章节" : "片尾";
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
          {spec.kind === "chapter" ? `第 ${spec.paragraph} 段前 · ` : ""}
          {spec.durationSec}s
        </div>
        <div className="material-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || working}
            onClick={() => void onSwap(spec.id)}
            title="让 AI 换个标题重新写这张卡"
          >
            {working ? "换文案中…" : "换一个"}
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
            第 {item.paragraph} 段{!item.infoCard && candidate && <span className="pill info">待替换</span>}
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
                title={item.infoCard ? "换掉底下这段实拍素材，信息卡保留" : "换一段素材"}
              >
                {searching === item.paragraph ? "检索中…" : "换一个"}
              </button>
              {!item.infoCard && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || cardBusy?.paragraph === item.paragraph}
                  onClick={() => void props.onToInfoCard(item.paragraph)}
                  title="按这段台词生成人物 / 对比 / 时间线 / 数据卡，叠在这段素材上"
                >
                  {cardBusy?.paragraph === item.paragraph && cardBusy.action === "apply" ? "生成中…" : "加信息卡"}
                </button>
              )}
              {candidate && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void props.onUndo(item.paragraph)}
                >
                  撤销
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
  /** 正在生成信息卡的段号，0 表示空闲 */
  /** 正在生成/撤销信息卡的段号与动作，null 表示空闲 */
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
      setNote({ text: "版式卡已换文案，成片会按新卡片重新合成" });
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
      setNote({ text: `第 ${paragraph} 段已改用信息卡，确认后进入合成` });
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
      setNote({ text: `第 ${paragraph} 段已恢复实拍素材` });
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
      if (list.length === 0) setNote({ text: `第 ${item.paragraph} 段没有检索到新的候选素材。` });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setSearching(0);
    }
  }

  function pick(item: MaterialItem, candidate: MaterialInfo) {
    onPickedChange({ ...picked, [item.paragraph]: candidate });
    setPanel(null);
    setNote({ text: `第 ${item.paragraph} 段已选好新素材，点「下一步：成片预览」后生效。` });
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
      title="素材确认"
      desc={
        manifest
          ? awaiting
            ? "每段都配好视频了：点开看看，不满意就换一个；确认后去「成片预览」设字幕与 BGM 再生成。"
            : "成片已生成，每段用的就是下面的素材。想换素材，点上面的「重新生成」按新来源重做。"
          : matching
            ? "正在按台词检索并下载素材，完成后会在这里逐段列出来。"
            : awaiting
              ? "配音已完成，点「开始匹配素材」，AI 会按每段台词找可用的视频素材。"
              : failed
                ? (task.error ?? "素材匹配没成功，可以换个来源重试。")
                : "配音还没完成，素材匹配会在配音结束后开始。"
      }
      fill
    >
      <ConfigSection
        title="生成配置"
        summary={`${sourceLabel} · ${resolutionLabel} · 片头 ${cardSec("introDurationSec") || 0}s`}
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
                片头 / 章节 / 片尾（秒）<span className="hint">0 = 不出</span>
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
                  title="片头时长，0 = 不出片头"
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
                  title="章节卡时长，0 = 不出章节卡"
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
                  title="片尾时长，0 = 不出片尾"
                  onChange={(event) => onCardPrefsChange?.({ outroDurationSec: clampSec(event.target.value) })}
                />
              </div>
              <span className="field-hint">依次为片头 / 章节 / 片尾</span>
            </div>

            <div className="field">
              <label htmlFor="material-source">素材来源</label>
              <Dropdown
                id="material-source"
                value={form.materialSource}
                options={(meta?.materialSources ?? []).map((option) => ({ value: option.id, label: option.label }))}
                onChange={(next) => onFormChange({ materialSource: next })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
              />
              <span className="field-hint">{sourceHint ?? "决定从哪个站检索"}</span>
            </div>

            <div className="field">
              <label htmlFor="resolution">分辨率</label>
              <Dropdown
                id="resolution"
                value={form.resolution}
                options={(meta?.resolutions ?? []).map((option) => ({ value: option.id, label: option.label }))}
                onChange={(next) => onFormChange({ resolution: next })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
              />
              <span className="field-hint">成片尺寸</span>
            </div>

            {/* 信息卡开关：与前三项同一行，用下拉而不是勾选框，和旁边的选择框对齐 */}
            <div className="field">
              <label htmlFor="auto-info-cards">信息卡</label>
              <Dropdown
                id="auto-info-cards"
                value={form.autoInfoCards === false ? "off" : "on"}
                options={[
                  { value: "on", label: "自动配置" },
                  { value: "off", label: "只出实拍" },
                ]}
                onChange={(next) => onFormChange({ autoInfoCards: next === "on" })}
                disabled={busy || pending || (!editable && !canMatchAgain)}
                title="逐段判断哪几段适合做成人物 / 对比 / 时间线 / 数据卡，适合的自动生成并叠在素材上"
              />
              <span className="field-hint">叠加在素材上，不替换画面</span>
            </div>
          </div>
          <p className="field-hint">
            {manifest
              ? "改完上面的设置，点「重新生成」会按新设置重做素材；已匹配的素材与成片会一起作废。"
              : canMatchAgain
                ? cancelled
                  ? "已停止，之前匹配出来的素材不完整。点「继续」接着补齐没匹配的段落。"
                  : "上次匹配没成功。可以换个素材来源或分辨率，再点「用新来源重新匹配」。"
                : "点「开始匹配素材」后按这个配置一次跑完：片头 → 逐段素材 → 信息卡。"}
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
                      <span>第 {item.paragraph} 段</span>
                      <span className="para-hint">
                        {chapter ? `章节卡「${chapter.title}」` : "无章节卡"} · 素材{" "}
                        {Math.round((picked[item.paragraph] ?? item).duration)}s
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
          <p className="hint">素材还没匹配出来。</p>
        ) : null}

        {note && <p className={`hint${note.bad ? " hint-warn" : ""}`}>{note.text}</p>}
        {failed && (
          <div className="alert">
            {task.error ??
              (task.status === "cancelled"
                ? "已停止。已下好的素材留在本地，点「继续」只补没完成的段落。"
                : "匹配素材失败")}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        {matching && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            停止匹配
          </button>
        )}
        {(manifest || matching) && !matching && (
          <button className="secondary" type="button" disabled={busy} onClick={() => onMatch(true)}>
            重新生成
          </button>
        )}
        {awaiting && !manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            开始匹配素材
          </button>
        )}
        {awaiting && manifest && (
          <button className="primary" type="button" disabled={busy} onClick={() => onConfirm(replacements)}>
            {(() => {
              const next = nextLabel ?? "下一步：成片预览";
              return replacements.length > 0 ? `${next}（已换 ${replacements.length} 段）` : next;
            })()}
          </button>
        )}
        {task.status === "completed" && (
          <button className="primary" type="button" disabled={busy} onClick={onBack}>
            返回成片预览
          </button>
        )}

        {/* 停止后按原来源补齐 */}
        {cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={onRetry}>
            继续
          </button>
        )}
        {canMatchAgain && !cancelled && (
          <button className="primary" type="button" disabled={busy} onClick={() => onMatch()}>
            用新来源重新匹配
          </button>
        )}
        {failed && !manifest && task.status === "failed" && (
          <button className={canMatchAgain ? "secondary" : "primary"} type="button" disabled={busy} onClick={onRetry}>
            重试失败步骤
          </button>
        )}
      </div>
    </Panel>
  );
}
