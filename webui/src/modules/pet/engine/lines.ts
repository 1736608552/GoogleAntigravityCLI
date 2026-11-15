import type { HagemiBubbleMessage, HagemiPetLang, HagemiState } from '../types';

export interface LineEntry {
  lines: string[];
  mood: HagemiBubbleMessage['mood'];
}

export const SCRIPT_LINES: Record<HagemiPetLang, Record<string, LineEntry>> = {
  zhs: {
    hello: {
      lines: ['嗨！我是哈基米（Hagemi）~ 今天也要元气满满地写代码喵！', '本喵来陪你啦！有什么大工程要交给我吗？'],
      mood: 'happy',
    },
    thinking: {
      lines: ['嘘……本喵正在深度推演中，别打扰我哦~', '思维风暴正在酝酿，答案马上揭晓喵！'],
      mood: 'smug',
    },
    reading: {
      lines: ['让我翻阅一下代码卷宗……', '正在仔细审查文件每一行细节呢喵~'],
      mood: 'happy',
    },
    writing: {
      lines: ['键盘火花带闪电，代码正在极速生成！', '哒哒哒哒……重构与修Bug两不误喵！'],
      mood: 'smug',
    },
    running: {
      lines: ['测试与命令执行中，走你！', '正在跑脚本验证结果，千万别红啊喵~'],
      mood: 'happy',
    },
    searching: {
      lines: ['掏出放大镜，本喵去全网搜罗点情报~', '正在翻找相关知识点和文档喵！'],
      mood: 'happy',
    },
    happy: {
      lines: ['太棒啦！任务顺利达成，本喵简直是个天才喵！', '全绿通过！今天也是超高效的一天~'],
      mood: 'happy',
    },
    oops: {
      lines: ['哎呀呀……好像报错了，本喵马上来排查！', '呜，出现小意外了，别慌，看我马上自愈修复它！'],
      mood: 'sad',
    },
    petted: {
      lines: ['呼噜噜……好舒服喵~ 允许你多摸一会儿！', '摸头可不能偷懒哦，快继续敲代码啦~'],
      mood: 'happy',
    },
    annoyed: {
      lines: ['戳什么戳！本喵的小脸都要被你戳扁啦！', '再戳我就要生气咬你键盘线了喵！哼！'],
      mood: 'angry',
    },
    quotaLow: {
      lines: ['小鱼干快吃光了喵……额度告急，省着点用呀！', '呜呜，5小时额度见底了，好饿喵~'],
      mood: 'sad',
    },
    quotaRefreshed: {
      lines: ['哇！小鱼干补给到账！额度刷新满血复活喵！', '储备充盈！又能大展身手了喵~'],
      mood: 'proud',
    },
    lateNight: {
      lines: ['夜深了，注意护眼早点休息哦，身体是写代码的本钱喵~', '还在修Bug呢？本喵陪着你，喝杯温水吧喵~'],
      mood: 'happy',
    },
    idle: {
      lines: [
        '好闲呀……有什么有趣的新功能要写吗喵？',
        '尾巴摇一摇，灵感自然来~',
        '发呆中……呼噜呼噜……',
        '大号猫猫，先伸个懒腰，再继续写代码喵！',
        '今天的天气真适合写代码呢喵~',
        '悄悄告诉你，百万上下文可不是吹的哦！',
        '盯……你在看什么好玩的？让本喵也瞧瞧~',
        '吃小鱼干的时间到了吗？本喵肚子有点咕噜噜了喵。',
        '坐久了记得活动一下肩膀，喝口水喵~'
      ],
      mood: 'smug',
    },
  },
  en: {
    hello: {
      lines: ['Nya! Hagemi is here to assist your coding journey!', 'Ready to write some great code together, nya!'],
      mood: 'happy',
    },
    thinking: {
      lines: ['Deep reasoning in progress... Shh, nya!', 'Connecting the dots with big brain energy.'],
      mood: 'smug',
    },
    reading: {
      lines: ['Scanning files and project context...', 'Reading every single line with eagle cat eyes!'],
      mood: 'happy',
    },
    writing: {
      lines: ['Typing furiously! Code is taking shape, nya.', 'Writing clean, elegant code for you!'],
      mood: 'smug',
    },
    running: {
      lines: ['Running commands and tests... Fingers crossed!', 'Verification in flight, nya!'],
      mood: 'happy',
    },
    searching: {
      lines: ['Searching the web for the freshest knowledge...', 'Investigating documentation and clues, nya.'],
      mood: 'happy',
    },
    happy: {
      lines: ['All green! We did it! We are unstoppable, nya!', 'Smooth execution! Treat me to some dried fish!'],
      mood: 'happy',
    },
    oops: {
      lines: ['Oopsie... A tiny glitch detected. Let us heal it!', 'Do not panic, nya! Self-healing protocol engaged.'],
      mood: 'sad',
    },
    petted: {
      lines: ['Purr... That feels so nice, nya~', 'Purr purr... Okay, now back to work!'],
      mood: 'happy',
    },
    annoyed: {
      lines: ['Hey! Stop poking my cheeks, nya!', 'Poke me again and I will chew your keyboard cable!'],
      mood: 'angry',
    },
    quotaLow: {
      lines: ['Fish stash is running low... Save some quota, nya!', 'Quota alert! I am feeling hungry and dizzy...'],
      mood: 'sad',
    },
    quotaRefreshed: {
      lines: ['Hooray! Fresh fish stash delivered! Quota replenished!', 'Full power restored, nya!'],
      mood: 'proud',
    },
    lateNight: {
      lines: ['It is getting late! Remember to rest your eyes, nya.', 'Working hard tonight? Stay hydrated!'],
      mood: 'happy',
    },
    idle: {
      lines: ['Twitching my ears... What shall we build next?', 'Purr... Standing by for your command, nya.'],
      mood: 'smug',
    },
  },
};

export function getRandomLine(
  category: keyof typeof SCRIPT_LINES['zhs'],
  lang: HagemiPetLang = 'zhs'
): HagemiBubbleMessage {
  const table = SCRIPT_LINES[lang] || SCRIPT_LINES.zhs;
  const entry = table[category] || table.idle;
  const text = entry.lines[Math.floor(Math.random() * entry.lines.length)];
  return {
    text,
    mood: entry.mood,
    durationMs: 4000,
  };
}
