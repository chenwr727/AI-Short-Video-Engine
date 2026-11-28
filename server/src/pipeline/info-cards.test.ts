import assert from "node:assert/strict";
import test from "node:test";
import {
  avatarChar,
  cardFingerprint,
  cleanCardText,
  compareTimes,
  draftInfoToSpec,
  resolveBeats,
  resolveQuote,
  type DraftInfoCard,
} from "./cards.js";

const ACCENT = "#ff5a3c";

/** 造一整张合法的对比卡 */
const compareDraft: DraftInfoCard = {
  template: "CompareCard",
  title: "两个人的选择",
  left: { name: "贝森特", stance: "立刻改口" },
  right: { name: "鲁比奥", stance: "选择沉默" },
};

test("白名单之外的信息卡模板一律丢弃", () => {
  assert.equal(draftInfoToSpec({ template: "TitleCard" }, ACCENT, 5, 2), null);
  assert.equal(draftInfoToSpec({ template: "EvilCard" }, ACCENT, 5, 2), null);
  assert.equal(draftInfoToSpec({}, ACCENT, 5, 2), null);
});

/**
 * 变体只是换排版，字段校验必须和基类完全一致。
 * 这些测试防的是「加了变体后漏走校验」——那会让半张卡通过。
 */
test("人物卡变体与基类共用同一套字段校验", () => {
  const good = { template: "PersonCard", title: "黄仁勋", role: "英伟达 CEO", line: "回归离谱" };
  for (const template of ["PersonCard", "PersonCardHero", "PersonCardCompact"]) {
    const spec = draftInfoToSpec({ ...good, template }, ACCENT, 5, 2);
    assert.ok(spec, `${template} 应当通过`);
    assert.equal(spec.compositionId, template);
    // 缺 role 与 line 时，变体也必须被丢掉
    assert.equal(draftInfoToSpec({ template, title: "只有名字" }, ACCENT, 5, 2), null, `${template} 只有名字不该通过`);
  }
});

test("对比卡变体与基类共用校验：缺一侧仍然丢掉", () => {
  for (const template of ["CompareCard", "CompareCardStacked"]) {
    const spec = draftInfoToSpec({ ...compareDraft, template }, ACCENT, 5, 2, ["#ff5a3c", "#3b82f6"]);
    assert.ok(spec, `${template} 应当通过`);
    assert.equal(spec.compositionId, template);
    const broken = { ...compareDraft, template, right: undefined };
    assert.equal(draftInfoToSpec(broken, ACCENT, 5, 2), null, `${template} 缺右栏不该通过`);
  }
});

test("数据卡变体与基类共用校验：没有主数字仍然丢掉", () => {
  for (const template of ["StatCard", "StatCardSplit"]) {
    const spec = draftInfoToSpec({ template, stat: { value: "32%" } }, ACCENT, 5, 2);
    assert.ok(spec, `${template} 应当通过`);
    assert.equal(spec.compositionId, template);
    assert.equal(draftInfoToSpec({ template, stat: {} }, ACCENT, 5, 2), null, `${template} 没有数字不该通过`);
  }
});

test("四种基类都能出卡，变体不改变内容字段", () => {
  const hero = draftInfoToSpec(
    { template: "PersonCardHero", title: "川普", role: "美国总统", line: "亲自出马" },
    ACCENT,
    5,
    2,
  );
  const plain = draftInfoToSpec(
    { template: "PersonCard", title: "川普", role: "美国总统", line: "亲自出马" },
    ACCENT,
    5,
    2,
  );
  assert.equal(hero?.title, plain?.title);
  assert.equal(hero?.role, plain?.role);
  assert.equal(hero?.line, plain?.line);
  // 但 id 与 compositionId 必须不同，否则缓存会互相顶掉
  assert.notEqual(hero?.id, plain?.id);
});

test("对比卡缺任一侧都不成立", () => {
  assert.ok(draftInfoToSpec(compareDraft, ACCENT, 5, 2));

  const noLeft = { ...compareDraft, left: undefined };
  assert.equal(draftInfoToSpec(noLeft, ACCENT, 5, 2), null);

  const emptyStance = { ...compareDraft, right: { name: "鲁比奥", stance: "  " } };
  assert.equal(draftInfoToSpec(emptyStance, ACCENT, 5, 2), null);
});

test("对比卡保留备注，并清理超长文本", () => {
  const spec = draftInfoToSpec(
    { ...compareDraft, left: { name: "贝森特", stance: "立刻改口", note: "权力全靠川普" } },
    ACCENT,
    5,
    2,
  );
  assert.ok(spec?.compare);
  assert.equal(spec.compare.left.note, "权力全靠川普");

  // 上限 24 字：模型给的立场常在 20-30 字，截太短会把语义砍断
  const long = draftInfoToSpec(
    { ...compareDraft, left: { name: "贝森特", stance: "这是一个特别特别长的立场描述不该整句塞进来而且还继续往下写" } },
    ACCENT,
    5,
    2,
  );
  assert.ok(long?.compare);
  // 没标点可断时会补一个省略号，所以比上限多 1 个字
  assert.ok([...long.compare.left.stance].length <= 25, `立场被截断到 24 字内，实际 ${long.compare.left.stance}`);
  assert.ok(long.compare.left.stance.endsWith("…"), "硬切时补省略号，提示下文还有");
});

test("时间线少于两个节点就退回，因为构不成先后", () => {
  const one = draftInfoToSpec(
    { template: "TimelineCard", timeline: [{ time: "周一", text: "开始游说" }] },
    ACCENT,
    5,
    2,
  );
  assert.equal(one, null);

  const two = draftInfoToSpec(
    {
      template: "TimelineCard",
      title: "时间线",
      timeline: [
        { time: "周一", text: "开始游说" },
        { time: "周三", text: "川普出面" },
      ],
    },
    ACCENT,
    5,
    2,
  );
  assert.ok(two?.timeline);
  assert.equal(two.timeline.length, 2);
});

test("时间线节点缺时间或缺内容会被剔除", () => {
  const spec = draftInfoToSpec(
    {
      template: "TimelineCard",
      timeline: [
        { time: "周一", text: "开始游说" },
        { time: "", text: "没有时间" },
        { time: "周三", text: "川普出面" },
      ],
    },
    ACCENT,
    5,
    2,
  );
  assert.ok(spec?.timeline);
  assert.equal(spec.timeline.length, 2, "残缺节点应被剔除而不是原样保留");
});

test("数据卡没有主数字就不出", () => {
  assert.equal(draftInfoToSpec({ template: "StatCard", stat: { value: "" } }, ACCENT, 5, 2), null);
  assert.equal(draftInfoToSpec({ template: "StatCard" }, ACCENT, 5, 2), null);

  const ok = draftInfoToSpec(
    { template: "StatCard", title: "占比", stat: { value: "32%", note: "股市是家庭财富支柱" } },
    ACCENT,
    5,
    2,
  );
  assert.equal(ok?.stat?.value, "32%");
  assert.equal(ok?.stat?.bars, undefined, "没给柱状数据时不该凭空造");
});

test("数据卡的柱子过滤掉非正数与空标签", () => {
  const spec = draftInfoToSpec(
    {
      template: "StatCard",
      stat: {
        value: "32%",
        bars: [
          { label: "股票", value: 32 },
          { label: "", value: 10 },
          { label: "房产", value: 0 },
        ],
      },
    },
    ACCENT,
    5,
    2,
  );
  assert.ok(spec?.stat?.bars);
  assert.equal(spec.stat.bars.length, 1);
  assert.equal(spec.stat.bars[0]?.label, "股票");
});

test("柱子超过 4 根：尾部合并成「其他」，不静默丢弃", () => {
  /*
   * 旁白可能念了 6 个数。以前直接 slice(0,4) 把后两根扔掉 ——
   * 画面只有 4 根，也没交代剩下两项去哪了，数据卡的可信度就没了。
   */
  const spec = draftInfoToSpec(
    {
      template: "StatCard",
      title: "家庭财富构成",
      stat: {
        value: "32%",
        bars: [
          { label: "股票", value: 32 },
          { label: "房产", value: 28 },
          { label: "现金", value: 14 },
          { label: "债券", value: 9 },
          { label: "黄金", value: 7 },
          { label: "其他资产", value: 5 },
        ],
      },
    },
    ACCENT,
    5,
    2,
  );
  const bars = spec?.stat?.bars ?? [];
  assert.equal(bars.length, 4, "最多 4 根");
  // 前 3 根保留明细，第 4 根是尾部合计：债券 9 + 黄金 7 + 其他资产 5 = 21
  assert.equal(bars[0]?.label, "股票");
  assert.equal(bars[1]?.label, "房产");
  assert.equal(bars[2]?.label, "现金");
  assert.equal(bars[3]?.label, "其他");
  assert.equal(bars[3]?.value, 21);
  assert.equal(bars[3]?.hint, "3 项合计");
});

test("柱子正好 4 根：原样保留，不生成「其他」", () => {
  const spec = draftInfoToSpec(
    {
      template: "StatCard",
      stat: {
        value: "32%",
        bars: [
          { label: "股票", value: 32 },
          { label: "房产", value: 28 },
          { label: "现金", value: 14 },
          { label: "债券", value: 9 },
        ],
      },
    },
    ACCENT,
    5,
    2,
  );
  const bars = spec?.stat?.bars ?? [];
  assert.equal(bars.length, 4);
  assert.equal(bars[3]?.label, "债券");
});

test("人物卡必须同时有身份或判断，只有名字不成立", () => {
  assert.equal(draftInfoToSpec({ template: "PersonCard", title: "黄仁勋" }, ACCENT, 5, 2), null);
  const ok = draftInfoToSpec({ template: "PersonCard", title: "黄仁勋", role: "英伟达 CEO" }, ACCENT, 5, 2);
  assert.equal(ok?.title, "黄仁勋");
  assert.equal(ok?.role, "英伟达 CEO");
});

test("生成的卡片带段号与稳定 id，便于去重与缓存", () => {
  const a = draftInfoToSpec(compareDraft, ACCENT, 5, 3);
  const b = draftInfoToSpec(compareDraft, ACCENT, 5, 3);
  assert.equal(a?.id, b?.id);
  assert.equal(a?.paragraph, 3);
  assert.equal(a?.kind, "info");
  assert.equal(a?.durationSec, 5);
});

/**
 * 回归：早期按字数硬切，出现「贝森特 vs 鲁比奥：改口与」这种半句话。
 * 现在优先在标点处断开，保住语义完整。
 */
test("超长文案优先按标点断句，不硬切", () => {
  const spec = draftInfoToSpec(
    {
      template: "CompareCard",
      // 中性标题且明显超过 20 字上限，用来验证断句；避开「标题不能复述人名」的规则
      title: "改口与沉默：同一件事上两个完全不同位置的人各自的选择",
      left: { name: "贝森特", stance: "没有根基，老板一发话就改口" },
      right: { name: "鲁比奥", stance: "国会根基深，沉默更有信息" },
    },
    ACCENT,
    5,
    3,
  );
  assert.ok(spec?.title);
  assert.ok([...spec.title].length <= 20, `超上限：${spec.title}`);
  assert.equal(spec.title, "改口与沉默", "应在冒号处断开，而不是切成 20 字");
});

/**
 * 回归：模型爱写「贝森特 vs 鲁比奥」当标题，而下面两栏已经各有一个同样的名字，
 * 卡片上会出现三次，看着像排版错误。
 */
test("对比卡标题不复述左右人名", () => {
  const spec = draftInfoToSpec(
    {
      template: "CompareCard",
      title: "贝森特 vs 鲁比奥：改口与沉默",
      left: { name: "贝森特", stance: "立刻改口" },
      right: { name: "鲁比奥", stance: "选择沉默" },
    },
    ACCENT,
    5,
    3,
  );
  assert.ok(spec?.title);
  assert.ok(!spec.title.includes("贝森特"), `标题不该出现左栏人名：${spec.title}`);
  assert.ok(!spec.title.includes("鲁比奥"), `标题不该出现右栏人名：${spec.title}`);
});

test("对比卡标题不重复时原样保留", () => {
  const spec = draftInfoToSpec(
    {
      template: "CompareCard",
      title: "两种反应",
      left: { name: "贝森特", stance: "立刻改口" },
      right: { name: "鲁比奥", stance: "选择沉默" },
    },
    ACCENT,
    5,
    3,
  );
  assert.equal(spec?.title, "两种反应");
});

/**
 * 对比卡右栏的对照色此前是个死字段：组件有默认值、渲染也读了，
 * 但后端从来不给它赋值，于是主色怎么改右栏都死守默认蓝。
 */
test("对比卡右栏要有与左栏相反的冷暖色", () => {
  const palette = [ACCENT, "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
  const spec = draftInfoToSpec(compareDraft, ACCENT, 5, 2, palette);
  assert.ok(spec?.rightAccent, "右栏必须拿到一个颜色");
  assert.notEqual(spec.rightAccent.toLowerCase(), ACCENT.toLowerCase(), "右栏不能和左栏同色");
  // 主色是暖橙，右栏应当落在冷色区
  assert.equal(spec.rightAccent, "#3b82f6");
});

test("主色是冷色时，右栏改取暖色", () => {
  const cool = "#3b82f6";
  const palette = [cool, ACCENT, "#22c55e", "#eab308", "#a855f7", "#f97316"];
  const spec = draftInfoToSpec(compareDraft, cool, 5, 2, palette);
  assert.ok(spec?.rightAccent);
  assert.notEqual(spec.rightAccent.toLowerCase(), cool.toLowerCase());
  // 不再死守蓝色，改成一个暖色
  assert.equal(spec.rightAccent, ACCENT);
});

test("色板为空也不崩，右栏仍有颜色", () => {
  const spec = draftInfoToSpec(compareDraft, ACCENT, 5, 2);
  assert.ok(spec?.rightAccent);
  assert.notEqual(spec.rightAccent.toLowerCase(), ACCENT.toLowerCase());
});

/**
 * normalizeSpec 会把主色收敛进色板。右栏不能跟着被收敛 ——
 * 否则主色一旦落在色板外，左右两栏会同时变成 palette[0]，对比卡变成同色。
 */
test("归一化主色时不把右栏对照色也吞掉", () => {
  const palette = ["#ff5a3c", "#3b82f6", "#22c55e"];
  const spec = draftInfoToSpec(compareDraft, "#ff5a3c", 5, 2, palette);
  assert.equal(spec?.rightAccent, "#3b82f6");
});

/**
 * 头像字：早先取姓名首字，于是「川普」显示成「川」、「贝森特」显示成「贝」。
 * 音译名没有姓氏，这是错的。现在只有模型显式给出、且是单个汉字时才用。
 */
test("头像字只接受单个汉字", () => {
  assert.equal(avatarChar("黄"), "黄");
  assert.equal(avatarChar(" 张 "), "张");
  // 音译名的首字不该被当成姓
  assert.equal(avatarChar(""), "");
  assert.equal(avatarChar("川普"), "", "两个字的姓名不能直接当头像字");
  assert.equal(avatarChar("A"), "", "非汉字不接受");
  assert.equal(avatarChar("1"), "", "数字不接受");
  assert.equal(avatarChar("？"), "", "占位符不接受");
  assert.equal(avatarChar(undefined), "");
  assert.equal(avatarChar(null), "");
});

test("中文名给姓氏则用字，音译名留空则无字", () => {
  const chinese = draftInfoToSpec(
    { template: "PersonCard", title: "黄仁勋", avatar: "黄", role: "英伟达 CEO", line: "回归离谱" },
    ACCENT,
    5,
    2,
  );
  assert.equal(chinese?.avatar, "黄");

  const translated = draftInfoToSpec(
    { template: "PersonCard", title: "川普", avatar: "", role: "美国总统", line: "亲自出马" },
    ACCENT,
    5,
    2,
  );
  assert.equal(translated?.avatar, undefined, "音译名不该有头像字");

  // 模型硬给两个字也必须被拒
  const wrong = draftInfoToSpec(
    { template: "PersonCard", title: "川普", avatar: "川普", role: "美国总统", line: "亲自出马" },
    ACCENT,
    5,
    2,
  );
  assert.equal(wrong?.avatar, undefined);
});

test("头像字进指纹：改了头像必须重渲", () => {
  const withA = draftInfoToSpec(
    { template: "PersonCard", title: "黄仁勋", avatar: "黄", role: "CEO", line: "x" },
    ACCENT,
    5,
    2,
  );
  const withB = draftInfoToSpec(
    { template: "PersonCard", title: "黄仁勋", avatar: "仁", role: "CEO", line: "x" },
    ACCENT,
    5,
    2,
  );
  assert.ok(withA && withB);
  // draftInfoToSpec 还没算指纹（normalizeSpec 才做），这里直接比指纹函数
  assert.notEqual(cardFingerprint(withA, 1080, 1920, 24), cardFingerprint(withB, 1080, 1920, 24));
});

// ——— 逐条上屏（beats） ———

const SENTENCES = [
  { text: "总统亲自下场，一个一个去说服董事会里的人。", start: 0.7 },
  { text: "这已经不是他第一次这么干了。", start: 4.9 },
  { text: "股市跌成那样，他自己手里的股票也在跟着亏钱。", start: 8.9 },
];

test("台词片段能对齐到分句，忽略标点与空白", () => {
  assert.equal(resolveQuote("总统亲自下场", SENTENCES), 0.7);
  assert.equal(resolveQuote("他 自己 手里的股票", SENTENCES), 8.9);
  // 片段落在句子中间也要对上
  assert.equal(resolveQuote("跟着亏钱", SENTENCES), 8.9);
});

test("对不上的片段返回 null，不猜时间", () => {
  assert.equal(resolveQuote("他从没这么干过", SENTENCES), null);
  assert.equal(resolveQuote("", SENTENCES), null);
  assert.equal(resolveQuote("总", SENTENCES), null);
});

test("要点按时间排序，对不上的丢掉", () => {
  const beats = [
    { text: "股价也在亏", quote: "手里的股票也在跟着亏钱" },
    { text: "亲自出马", quote: "总统亲自下场" },
    { text: "不存在的一条", quote: "这段台词里根本没有" },
  ];
  const resolved = resolveBeats(beats, SENTENCES);
  assert.deepEqual(
    resolved?.map((b) => b.text),
    ["亲自出马", "股价也在亏"],
  );
  assert.equal(resolved?.[0]?.at, 0.7);
  assert.equal(resolved?.[1]?.at, 8.9);
});

test("只剩一条要点就整组丢掉：一条单独出现等于把静态卡推迟一秒", () => {
  assert.equal(resolveBeats([{ text: "亲自出马", quote: "总统亲自下场" }], SENTENCES), undefined);
  assert.equal(resolveBeats(undefined, SENTENCES), undefined);
  assert.equal(resolveBeats([{ text: "A", quote: "总统" }], []), undefined);
});

test("人物卡的要点要过校验：至少两条、单条不超 12 字", () => {
  const draft: DraftInfoCard = {
    template: "PersonCard",
    title: "川普",
    role: "美国总统",
    beats: [
      { text: "亲自出马逐个说服董事会的所有人", quote: "总统亲自下场" },
      { text: "股价也在亏", quote: "手里的股票也在跟着亏钱" },
    ],
  };
  const spec = draftInfoToSpec(draft, ACCENT, 5, 2);
  assert.equal(spec?.beats?.length, 2);
  // 12 字上限，截断时末尾补一个「…」占位，所以实际最多 13 个字符
  assert.ok([...(spec?.beats?.[0]?.text ?? "")].length <= 13, spec?.beats?.[0]?.text ?? "");

  // 只有一条要点：不成立，退回静态的一句判断
  const [firstBeat] = draft.beats ?? [];
  const single = draftInfoToSpec({ ...draft, beats: [firstBeat!] }, ACCENT, 5, 2);
  assert.equal(single?.beats, undefined);

  // 片段太短会误匹配到别的句子，直接丢
  const shortQuote = draftInfoToSpec(
    {
      ...draft,
      beats: [
        { text: "甲", quote: "总" },
        { text: "乙", quote: "股" },
      ],
    },
    ACCENT,
    5,
    2,
  );
  assert.equal(shortQuote?.beats, undefined);
});

test("对比卡两栏的台词定位要落库", () => {
  const spec = draftInfoToSpec(
    {
      ...compareDraft,
      left: { name: "贝森特", stance: "立刻改口", quote: "总统亲自下场" },
      right: { name: "鲁比奥", stance: "选择沉默" },
    },
    ACCENT,
    5,
    3,
  );
  assert.equal(spec?.compare?.left.quote, "总统亲自下场");
  assert.equal(spec?.compare?.right.quote, undefined);
});

test("卡面文案变了，指纹就要变（否则改了没反应）", () => {
  const base = draftInfoToSpec(compareDraft, ACCENT, 5, 2)!;
  const changed = draftInfoToSpec({ ...compareDraft, left: { name: "贝森特", stance: "装作没听见" } }, ACCENT, 5, 2)!;
  const fp = (spec: typeof base) => cardFingerprint(spec, 1080, 1920, 24);
  assert.notEqual(fp(base), fp(changed));
});

// ——— 对比卡两栏的出现时序 ———

const pair = (lq: string, rq: string) => ({
  left: { name: "贝森特", stance: "立刻改口", quote: lq },
  right: { name: "鲁比奥", stance: "选择沉默", quote: rq },
});

test("两栏都对齐上：左栏不晚于右栏", () => {
  const t = compareTimes(pair("总统亲自下场", "跟着亏钱"), SENTENCES);
  assert.equal(t?.left, 0.7);
  assert.equal(t?.right, 8.9);
});

test("模型把两栏台词的顺序写反了：仍按时间先后，不按模型给的左右", () => {
  /*
   * 卡片讲的是「A 却 B」，视觉上必须先亮 A。模型经常把 quote 填反，
   * 照搬会让右栏先出现，读起来是反的。
   */
  const t = compareTimes(pair("跟着亏钱", "总统亲自下场"), SENTENCES);
  assert.equal(t?.left, 0.7);
  assert.equal(t?.right, 8.9);
});

test("只对齐上一栏：另一栏错开 0.4 秒，不重叠", () => {
  const onlyLeft = compareTimes(pair("总统亲自下场", "对不上的台词"), SENTENCES);
  assert.equal(onlyLeft?.left, 0.7);
  assert.equal(onlyLeft?.right, 1.1);

  const onlyRight = compareTimes(pair("对不上的台词", "跟着亏钱"), SENTENCES);
  assert.equal(onlyRight?.right, 8.9);
  assert.equal(onlyRight?.left, 8.5);
});

test("全程对不上：返回 undefined，卡片退回静态版式", () => {
  assert.equal(compareTimes(pair("没有这句", "也没有这句"), SENTENCES), undefined);
  assert.equal(compareTimes(undefined, SENTENCES), undefined);
  assert.equal(compareTimes(pair("总统亲自下场", "跟着亏钱"), []), undefined);
});

/**
 * 回归：硬切分支补的省略号本身占一个字，正文仍按 max 切会变成 max+1 字。
 * 标题上限 14 时多出的那一字在窄卡片上就是换行。
 */
test("字数硬切后加上省略号，结果仍不超过上限", () => {
  const long = "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸";
  for (const max of [3, 4, 8, 12, 14]) {
    const out = cleanCardText(long, max);
    const len = [...out].length;
    assert.ok(len <= max, `max=${max} 却输出了 ${len} 字：${out}`);
    assert.ok(out.endsWith("…"), `截断后应带省略号：${out}`);
  }
  // 正好等于上限时不截断，也就不该补省略号
  assert.equal(cleanCardText(long, 20), long);
});

// ——— 溯源校验：卡面内容必须指得回台词 ———

const GROUND_P6 = [
  "那不怕核心机密被带走？",
  "怕，但不许用竞业锁人。",
  "那靠什么防？",
  "靠保密协议和专利。",
  "走法律途径，不锁人。",
  "所以是换了个笼子，门开着。",
  "对，能走，但东西不能拿。",
].join(" ");

test("对比卡两侧都引不到原句时整张丢掉", () => {
  assert.equal(draftInfoToSpec(compareDraft, ACCENT, 5, 6, [], GROUND_P6), null);

  const ok = draftInfoToSpec(
    {
      template: "CompareCard",
      title: "锁人还是锁秘密",
      left: { name: "竞业锁人", stance: "人走不了", quote: "不许用竞业锁人" },
      right: { name: "保密协议与专利", stance: "能走但东西不能拿", quote: "靠保密协议和专利" },
    },
    ACCENT,
    5,
    6,
    [],
    GROUND_P6,
  );
  assert.ok(ok?.compare);
});

test("对比卡只有一侧有出处也不成立", () => {
  const spec = draftInfoToSpec(
    {
      template: "CompareCard",
      title: "两种反应",
      left: { name: "雇主", stance: "纸作废", quote: "不许用竞业锁人" },
      right: { name: "员工", stance: "能告", quote: "这句台词里根本没有" },
    },
    ACCENT,
    5,
    6,
    [],
    GROUND_P6,
  );
  assert.equal(spec, null);
});

test("过短的引用不构成出处", () => {
  const spec = draftInfoToSpec(
    {
      template: "CompareCard",
      title: "两派",
      left: { name: "甲", stance: "甲", quote: "这" },
      right: { name: "乙", stance: "乙", quote: "对" },
    },
    ACCENT,
    5,
    6,
    [],
    GROUND_P6,
  );
  assert.equal(spec, null);
});

test("时间线节点指不回原句的被剔除，剩不到两条整张丢弃", () => {
  const ground = "五七年他八个手下集体跑路。出去创办了仙童。仙童后来分裂，跑出了Intel和AMD。";

  const oneLeft = draftInfoToSpec(
    {
      template: "TimelineCard",
      title: "从肖克利到Intel",
      timeline: [
        { time: "1957", text: "八人出走", quote: "五七年他八个手下集体跑路" },
        { time: "编的", text: "编的节点", quote: "这句话台词里没有" },
      ],
    },
    ACCENT,
    5,
    3,
    [],
    ground,
  );
  assert.equal(oneLeft, null, "只剩一条节点构不成先后，整张退回实拍");

  const two = draftInfoToSpec(
    {
      template: "TimelineCard",
      title: "从肖克利到Intel",
      timeline: [
        { time: "1957", text: "八人出走", quote: "五七年他八个手下集体跑路" },
        { time: "之后", text: "创办仙童", quote: "出去创办了仙童" },
      ],
    },
    ACCENT,
    5,
    3,
    [],
    ground,
  );
  assert.equal(two?.timeline?.length, 2);
});

test("人物卡没有能对上原句的判断，整张不出", () => {
  const ground = "好家伙，裂变出半个芯片业。整条链子七十年没断过。";

  assert.equal(
    draftInfoToSpec(
      { template: "PersonCard", title: "黄仁勋", role: "英伟达 CEO", line: "亲自出马" },
      ACCENT,
      5,
      4,
      [],
      ground,
    ),
    null,
  );

  const ok = draftInfoToSpec(
    { template: "PersonCard", title: "黄仁勋", role: "英伟达 CEO", line: "亲自出马", lineQuote: "裂变出半个芯片业" },
    ACCENT,
    5,
    4,
    [],
    ground,
  );
  assert.ok(ok, "有能对上的出处就应当通过");
});

test("要点里指不回原句的那条被丢掉，剩一条就整组不上屏", () => {
  const ground = "总统亲自下场，一个一个去说服董事会里的人。股市跌成那样，他自己手里的股票也在跟着亏钱。";
  const spec = draftInfoToSpec(
    {
      template: "PersonCard",
      title: "川普",
      role: "美国总统",
      line: "亲自出马",
      lineQuote: "总统亲自下场",
      beats: [
        { text: "亲自出马", quote: "总统亲自下场" },
        { text: "编的要点", quote: "这句话台词里没有" },
      ],
    },
    ACCENT,
    5,
    1,
    [],
    ground,
  );
  assert.equal(spec?.beats, undefined);
});

test("不传 ground 时行为不变：历史和测试调用不受影响", () => {
  assert.ok(draftInfoToSpec(compareDraft, ACCENT, 5, 2));
});
