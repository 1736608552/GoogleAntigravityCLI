export type HagemiPetSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export type HagemiPetLang = 'zhs' | 'en';

export type HagemiChattiness = 'silent' | 'quiet' | 'normal' | 'chatty';

export interface HagemiSettings {
  /** 是否启用桌宠伴侣 */
  enabled: boolean;
  /** 桌宠显示尺寸：s (小 75%) | m (中 100%) | l (大 125%) */
  size: HagemiPetSize;
  /** 屏幕归一化相对位置坐标 [0..1] */
  position: {
    x: number;
    y: number;
  };
  /** 语音与台词语言偏好 */
  lang: HagemiPetLang;
  /** 互动与主动吐槽频率 */
  chattiness: HagemiChattiness;
  /** 是否开启小鱼干配额联动系统 */
  quotaFish: boolean;
  /** 贴边时是否自动半透明或微缩吸附 */
  dockingEnabled: boolean;
  /** 点击或抚摸音效 */
  soundEnabled: boolean;
}

export type HagemiState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'deepthink'
  | 'reading'
  | 'writing'
  | 'running'
  | 'searching'
  | 'drawing'
  | 'delegating'
  | 'compacting'
  | 'asking'
  | 'busy'
  | 'swamped'
  | 'tired'
  | 'exhausted'
  | 'resetSoon'
  | 'sleeping'
  | 'dizzy'
  | 'petted'
  | 'coaxed'
  | 'annoyed'
  | 'puffed'
  | 'redhot'
  | 'sulk'
  | 'forgiven'
  | 'happy'
  | 'proud'
  | 'oops'
  | 'surprised'
  | 'hum'
  | 'float'
  | 'stretch'
  | 'yawn'
  | 'gift'
  | 'bye';

export type HagemiGesture =
  | 'hop'
  | 'bounce'
  | 'spin'
  | 'shiver'
  | 'nod'
  | 'shake'
  | 'tailSwish'
  | 'lookAround'
  | 'gasp'
  | 'recoil'
  | 'squish'
  | 'drift'
  | 'flop'
  | 'earFlick';

export type HagemiBurst =
  | 'confetti'
  | 'sparkles'
  | 'hearts'
  | 'sweat'
  | 'steam'
  | 'fish'
  | 'notes'
  | 'dust';

export type HagemiQuotaLevel = 'ok' | 'half' | 'low' | 'critical' | 'empty';

export interface HagemiFacts {
  state: HagemiState;
  quota: HagemiQuotaLevel;
  stashLevel: number;
  stashLabel: string;
  subagents: number;
  hud?: Array<{ label: string; value: string; level?: number }>;
}

export interface HagemiBubbleMessage {
  text: string;
  mood?: 'happy' | 'smug' | 'angry' | 'proud' | 'sad' | 'surprised';
  ai?: boolean;
  durationMs?: number;
}
