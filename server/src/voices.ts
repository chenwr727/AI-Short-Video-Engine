import type { TtsEngine } from "./types.js";

export interface VoiceDef {
  id: string;
  label: string;
}

/** 内置音色表 */
export const EDGE_VOICES: VoiceDef[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（女声·温柔）" },
  { id: "zh-CN-YunxiNeural", label: "云希（男声·阳光）" },
  { id: "zh-CN-YunyangNeural", label: "云扬（男声·新闻）" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（女声·活泼）" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（东北·女声）" },
];

export const COSY_VOICES: VoiceDef[] = [
  { id: "longwan_v3", label: "龙婉（细腻柔声·女）" },
  { id: "longcheng_v3", label: "龙橙（智慧青年·男）" },
  { id: "longxiaochun_v3", label: "龙小淳（知性积极·女）" },
  { id: "longanyang_v3", label: "龙安洋（阳光男孩·男）" },
  { id: "longanhuan_v3", label: "龙安欢（欢脱元气·女）" },
  { id: "longze_v3", label: "龙泽（温暖元气·男）" },
  { id: "longanwen_v3", label: "龙安温（优雅知性·女）" },
  { id: "longanlang_v3", label: "龙安朗（清爽利落·男）" },
  { id: "loongbella_v3", label: "Bella（精准干练·女）" },
  { id: "longshuo_v3", label: "龙硕（博才干练·男）" },
];

export const SEED_VOICES: VoiceDef[] = [
  { id: "zh_female_xiaohe_uranus_bigtts", label: "小何（自然亲切·女）" },
  { id: "zh_male_m191_uranus_bigtts", label: "云舟（通用·男）" },
  { id: "zh_female_vv_uranus_bigtts", label: "Vivi（情感丰富·女）" },
  { id: "zh_male_dayi_uranus_bigtts", label: "大壹（视频配音·男）" },
  { id: "zh_female_shuangkuaisisi_uranus_bigtts", label: "爽快思思（爽朗活泼·女）" },
  { id: "zh_male_shaonianzixin_uranus_bigtts", label: "少年梓辛（少年感·男）" },
  { id: "zh_female_tianmeixiaoyuan_uranus_bigtts", label: "甜美小源（甜美·女）" },
  { id: "zh_male_sunwukong_uranus_bigtts", label: "猴哥（戏剧感·男）" },
  { id: "zh_female_linjianvhai_uranus_bigtts", label: "邻家女孩（亲切·女）" },
  { id: "zh_male_ruyayichen_uranus_bigtts", label: "儒雅逸辰（儒雅成熟·男）" },
];

export function voicesFor(engine: TtsEngine): VoiceDef[] {
  if (engine === "edge") return EDGE_VOICES;
  if (engine === "seedtts") return SEED_VOICES;
  return COSY_VOICES;
}
