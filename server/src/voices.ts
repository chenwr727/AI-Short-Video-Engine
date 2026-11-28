import type { Bilingual } from "./i18n.js";
import type { TtsEngine } from "./types.js";

export interface VoiceDef {
  id: string;
  /** 双语：下发给前端时按请求语言展开 */
  label: Bilingual;
}

/** 内置音色表：发音人是中文的，英文名只用拼音 + 语气/性别做说明 */
export const EDGE_VOICES: VoiceDef[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: { zh: "晓晓（女声·温柔）", en: "Xiaoxiao (gentle, F)" } },
  { id: "zh-CN-YunxiNeural", label: { zh: "云希（男声·阳光）", en: "Yunxi (sunny, M)" } },
  { id: "zh-CN-YunyangNeural", label: { zh: "云扬（男声·新闻）", en: "Yunyang (newscast, M)" } },
  { id: "zh-CN-XiaoyiNeural", label: { zh: "晓伊（女声·活泼）", en: "Xiaoyi (lively, F)" } },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: { zh: "晓北（东北·女声）", en: "Xiaobei (northeastern, F)" } },
];

export const COSY_VOICES: VoiceDef[] = [
  { id: "longwan_v3", label: { zh: "龙婉（细腻柔声·女）", en: "Longwan (soft-spoken, F)" } },
  { id: "longcheng_v3", label: { zh: "龙橙（智慧青年·男）", en: "Longcheng (smart young man, M)" } },
  { id: "longxiaochun_v3", label: { zh: "龙小淳（知性积极·女）", en: "Longxiaochun (bright, F)" } },
  { id: "longanyang_v3", label: { zh: "龙安洋（阳光男孩·男）", en: "Longanyang (sunny boy, M)" } },
  { id: "longanhuan_v3", label: { zh: "龙安欢（欢脱元气·女）", en: "Longanhuan (bubbly, F)" } },
  { id: "longze_v3", label: { zh: "龙泽（温暖元气·男）", en: "Longze (warm and energetic, M)" } },
  { id: "longanwen_v3", label: { zh: "龙安温（优雅知性·女）", en: "Longanwen (elegant, F)" } },
  { id: "longanlang_v3", label: { zh: "龙安朗（清爽利落·男）", en: "Longanlang (crisp and clear, M)" } },
  { id: "loongbella_v3", label: { zh: "Bella（精准干练·女）", en: "Bella (crisp and professional, F)" } },
  { id: "longshuo_v3", label: { zh: "龙硕（博才干练·男）", en: "Longshuo (knowledgeable and capable, M)" } },
];

export const SEED_VOICES: VoiceDef[] = [
  { id: "zh_female_xiaohe_uranus_bigtts", label: { zh: "小何（自然亲切·女）", en: "Xiaohe (natural and warm, F)" } },
  { id: "zh_male_m191_uranus_bigtts", label: { zh: "云舟（通用·男）", en: "Yunzhou (all-purpose, M)" } },
  { id: "zh_female_vv_uranus_bigtts", label: { zh: "Vivi（情感丰富·女）", en: "Vivi (expressive, F)" } },
  { id: "zh_male_dayi_uranus_bigtts", label: { zh: "大壹（视频配音·男）", en: "Dayi (video voice-over, M)" } },
  {
    id: "zh_female_shuangkuaisisi_uranus_bigtts",
    label: { zh: "爽快思思（爽朗活泼·女）", en: "Sisi (bright and lively, F)" },
  },
  { id: "zh_male_shaonianzixin_uranus_bigtts", label: { zh: "少年梓辛（少年感·男）", en: "Zixin (youthful, M)" } },
  { id: "zh_female_tianmeixiaoyuan_uranus_bigtts", label: { zh: "甜美小源（甜美·女）", en: "Xiaoyuan (sweet, F)" } },
  { id: "zh_male_sunwukong_uranus_bigtts", label: { zh: "猴哥（戏剧感·男）", en: "Houge (dramatic, M)" } },
  {
    id: "zh_female_linjianvhai_uranus_bigtts",
    label: { zh: "邻家女孩（亲切·女）", en: "Girl-next-door (friendly, F)" },
  },
  {
    id: "zh_male_ruyayichen_uranus_bigtts",
    label: { zh: "儒雅逸辰（儒雅成熟·男）", en: "Yichen (refined and mature, M)" },
  },
];

export function voicesFor(engine: TtsEngine): VoiceDef[] {
  if (engine === "edge") return EDGE_VOICES;
  if (engine === "seedtts") return SEED_VOICES;
  return COSY_VOICES;
}
