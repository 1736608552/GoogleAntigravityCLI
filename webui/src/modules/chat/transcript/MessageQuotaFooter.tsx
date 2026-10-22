import React, { memo, useState, useMemo, useEffect } from 'react';
import { Zap, Sparkles, Bot, RefreshCw, User } from 'lucide-react';
import type { ChatMessage, AntigravityQuotaSnapshot, LLMProvider } from '@/shared/types';
import { useAntigravityQuota, formatDynamicCountdown } from '@/modules/chat/hooks/useAntigravityQuota';

export function formatPreciseTimeTag(str?: string | null): string {
  if (!str) return '即将重置';
  const s = String(str).trim();
  if (s === '即将重置' || s.includes('即将') || s.includes('计算中') || s.includes('查询中')) return '即将重置';
  
  // 1. Chinese day + hour: "6天 23小时" / "6天"
  const mDayHour = s.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
  if (mDayHour) {
    const d = mDayHour[1];
    const h = mDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }
  
  // 2. Chinese hour + min: "4小时 59分钟" / "4小时" / "59分钟"
  const mHourMin = s.match(/(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?/);
  if (mHourMin && (mHourMin[1] || mHourMin[2])) {
    const h = mHourMin[1];
    const m = mHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  // 3. English day + hour: "6 days, 23 hours"
  const mEngDayHour = s.match(/(\d+)\s*days?(?:\s*,?\s*(\d+)\s*hours?)?/i);
  if (mEngDayHour) {
    const d = mEngDayHour[1];
    const h = mEngDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }

  // 4. English hour + min: "4 hours, 35 minutes" / "4h 35m"
  const mEngHourMin = s.match(/(?:(\d+)\s*(?:hours?|h))?\s*,?\s*(?:(\d+)\s*(?:min(?:ute)?s?|m))?/i);
  if (mEngHourMin && (mEngHourMin[1] || mEngHourMin[2])) {
    const h = mEngHourMin[1];
    const m = mEngHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  return s;
}

export function formatModelDisplayName(modelId?: string | null): string {
  if (!modelId) return 'Gemini 3.8 Flash';
  const raw = String(modelId).replace(/^models\//, '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('3.8') && lower.includes('flash')) return 'Gemini 3.8 Flash';
  if (lower.includes('3.7') && lower.includes('flash')) return 'Gemini 3.7 Flash';
  if (lower.includes('3.6') && lower.includes('flash')) return 'Gemini 3.6 Flash';
  if (lower.includes('3.1') && lower.includes('pro')) return 'Gemini 3.1 Pro';
  if (lower.includes('2.5') && lower.includes('flash')) return 'Gemini 2.5 Flash';
  if (lower.includes('2.5') && lower.includes('pro')) return 'Gemini 2.5 Pro';
  if (lower.includes('2.0') && lower.includes('flash')) return 'Gemini 2.0 Flash';
  if (lower.includes('2.0') && lower.includes('pro')) return 'Gemini 2.0 Pro';
  if (lower.includes('claude-sonnet-4-6') || lower.includes('4-6-sonnet') || lower.includes('4.6-sonnet') || lower.includes('4.6 sonnet')) return 'Claude Sonnet 4.6';
  if (lower.includes('claude-opus-4-6') || lower.includes('4-6-opus') || lower.includes('4.6-opus') || lower.includes('4.6 opus')) return 'Claude Opus 4.6';
  if (lower.includes('claude-3-7-sonnet') || lower.includes('3.7-sonnet') || lower.includes('3.7 sonnet')) return 'Claude 3.7 Sonnet';
  if (lower.includes('claude-3-5-sonnet') || lower.includes('3.5-sonnet') || lower.includes('3.5 sonnet')) return 'Claude 3.5 Sonnet';
  if (lower.includes('claude-3-5-haiku') || lower.includes('3.5-haiku') || lower.includes('3.5 haiku')) return 'Claude 3.5 Haiku';
  if (lower.includes('gpt-oss-120b') || lower.includes('gpt-oss') || lower.includes('gpt_oss')) return 'GPT-OSS 120B';
  if (lower.includes('gpt-4o-mini') || lower.includes('gpt4o-mini')) return 'GPT-4o Mini';
  if (lower.includes('gpt-4o') || lower.includes('gpt4o')) return 'GPT-4o';
  if (lower.includes('o3-mini')) return 'o3-mini';
  if (lower.includes('o1')) return 'o1';

  return raw
    .split(/[-_]/)
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''))
    .join(' ');
}

type MessageQuotaFooterProps = {
  message: ChatMessage;
  provider?: LLMProvider | string;
};

const MessageQuotaFooter: React.FC<MessageQuotaFooterProps> = ({ message, provider }) => {
  const isAntigravity = provider === 'antigravity' || message.provider === 'antigravity';

  const rawSnap = (message.quotaSnapshot || message.meta?.quotaSnapshot) as any;
  const actualSnap: AntigravityQuotaSnapshot | null =
    rawSnap && typeof rawSnap === 'object' && 'data' in rawSnap && rawSnap.data
      ? rawSnap.data
      : rawSnap;

  const targetEmail = actualSnap?.accountEmail;
  const { quota: liveQuota, loading, isRefreshing, refreshQuota } = useAntigravityQuota(targetEmail);

  // Tick every 10 seconds to update dynamic countdowns (e.g. 4h 59m -> 4h 58m)
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // 1. Resolve quota snapshot: message snapshot first, then fallback to liveQuota
  const rawLive = liveQuota as any;
  const actualLiveQuota: AntigravityQuotaSnapshot | null =
    rawLive && typeof rawLive === 'object' && 'data' in rawLive && rawLive.data
      ? rawLive.data
      : rawLive;
  const activePoolSource = actualLiveQuota || actualSnap;

  // If not Antigravity and no quotaSnapshot, do not render
  if (!activePoolSource && !isAntigravity) {
    return null;
  }

  // 2. Resolve model name & series: check message -> meta -> snap -> localStorage -> fallback
  const storedModel =
    typeof window !== 'undefined'
      ? localStorage.getItem(`${provider || message.provider || 'antigravity'}-model`)
      : null;

  const resolvedModelId =
    message.model ||
    message.meta?.model ||
    actualSnap?.model ||
    actualLiveQuota?.model ||
    (typeof message.toolInput === 'object' && (message.toolInput as any)?.model) ||
    storedModel ||
    (isAntigravity ? 'gemini-3.8-flash' : '');

  const rawModel = String(resolvedModelId).toLowerCase();

  const isClaude = rawModel.includes('claude');
  const isGpt = rawModel.includes('gpt') || rawModel.includes('o1') || rawModel.includes('o3') || rawModel.includes('oss');
  const isGemini = !isClaude && !isGpt;

  const modelDisplayName = formatModelDisplayName(resolvedModelId);

  // 3. Resolve tokens & duration
  const contentStr = String(message.content || '');
  const cleanLen = contentStr.replace(/[\u200b\s]/g, '').length;
  const estimatedTokens = Math.max(1, Math.round(cleanLen / 3.2));
  const tokens = message.tokens || message.meta?.tokens || actualSnap?.tokens || (cleanLen > 0 ? estimatedTokens : null);
  const duration = message.duration || message.meta?.duration || actualSnap?.duration;

  // 4. Resolve strictly separated pool metrics:
  // Gemini model -> ONLY Gemini pools (Gemini 5h + Gemini 周度)
  // Third-party model (Claude / GPT) -> ONLY Third-party pools (Claude 5h + Claude 周度)
  // 核心原则：100% 优先实时 Live Quota；若尚未加载完成才降级采用消息历史快照
  const livePool5h = isGemini ? actualLiveQuota?.gemini5h : actualLiveQuota?.claude5h;
  const livePoolWeekly = isGemini ? actualLiveQuota?.geminiWeekly : actualLiveQuota?.claudeWeekly;

  const snapPool5h = isGemini ? actualSnap?.gemini5h : actualSnap?.claude5h;
  const snapPoolWeekly = isGemini ? actualSnap?.geminiWeekly : actualSnap?.claudeWeekly;

  const pool5h = livePool5h || snapPool5h;
  const poolWeekly = livePoolWeekly || snapPoolWeekly;

  const h5Pct = typeof pool5h?.percent === 'number'
    ? pool5h.percent
    : (typeof activePoolSource?.percent === 'number' ? activePoolSource.percent : 100);
  const h5ResetStr = formatDynamicCountdown(pool5h?.resetTime, pool5h?.resetsIn || activePoolSource?.resetsIn, true, h5Pct);
  const h5ResetTag = formatPreciseTimeTag(h5ResetStr);
  const pool5hLabel = isGemini ? 'Gemini 5h' : isGpt ? 'GPT 5h' : 'Claude 5h';

  const h5DisplayTag = h5ResetTag;

  // 3色物理分段进度条各段充盈比例 (红区: 0%~20% / 黄区: 20%~50% / 绿区: 50%~100%)
  const redFill = Math.min(100, Math.max(0, (h5Pct / 20) * 100));
  const amberFill = Math.min(100, Math.max(0, ((h5Pct - 20) / 30) * 100));
  const greenFill = Math.min(100, Math.max(0, ((h5Pct - 50) / 50) * 100));

  const isSafeZone = h5Pct >= 50;
  const isWarningZone = h5Pct >= 20 && h5Pct < 50;
  const isDangerZone = h5Pct < 20;

  const zoneTag = isSafeZone ? '安全' : isWarningZone ? '注意' : '告急';
  const zoneTitle = isSafeZone
    ? '🟢 安全绿区 (50%~100%)：5小时持续回满，完全不伤周额度'
    : isWarningZone
    ? '🟡 警戒黄区 (20%~50%)：消耗过半，请注意控制高频调用节奏'
    : '🔴 告急红区 (0%~20%)：逼近周硬顶风控线，建议切换备用模型';

  const weeklyPct = typeof poolWeekly?.percent === 'number' ? poolWeekly.percent : 100;
  const weeklyResetStr = formatDynamicCountdown(poolWeekly?.resetTime, poolWeekly?.resetsIn, false, weeklyPct);
  const weeklyResetTag = formatPreciseTimeTag(weeklyResetStr);
  const poolWeeklyLabel = isGemini ? 'Gemini周' : isGpt ? 'GPT周' : 'Claude周';
  const weeklyDisplayTag = weeklyResetTag;

  const displayEmail = targetEmail || actualLiveQuota?.accountEmail;

  return (
    <>
      <div className="mt-2.5 flex flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/35 p-2 sm:px-3 sm:py-1.5 text-xs text-muted-foreground transition-colors hover:border-border/90 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between sm:gap-x-3">
        {/* Row 1 on mobile / Left on desktop: Model tag, tokens, duration, account email, and mobile refresh button */}
        <div className="flex items-center justify-between gap-2 min-w-0 sm:justify-start">
          <div className="inline-flex min-w-0 items-center gap-1.5 font-medium flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold border ${
                isClaude
                  ? 'border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : isGpt
                  ? 'border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isClaude ? (
                <Sparkles className="h-3 w-3 shrink-0" />
              ) : isGpt ? (
                <Bot className="h-3 w-3 shrink-0" />
              ) : (
                <Zap className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate max-w-[120px] sm:max-w-none">{modelDisplayName}</span>
            </span>

            {tokens != null && tokens > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono text-[11px] text-muted-foreground">{tokens.toLocaleString()} tokens</span>
              </>
            )}

            {duration != null && duration > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono text-[11px] text-muted-foreground/80">{duration}s</span>
              </>
            )}

            {displayEmail && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span
                  className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/85 border border-border/40 max-w-[130px] sm:max-w-[200px]"
                  title={`对应 Google 账号: ${displayEmail} (每次对话完成及手动刷新均实时拉取 Google 官方云端数据)`}
                >
                  <User className="h-2.5 w-2.5 shrink-0 opacity-70" />
                  <span className="truncate">{displayEmail}</span>
                </span>
              </>
            )}
          </div>

          {/* Quick Refresh Button for mobile (top-right, never overlaps badges) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void refreshQuota(true, displayEmail);
            }}
            disabled={loading || isRefreshing}
            className="sm:hidden inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all shrink-0"
            title={`点击向 Google 官方云端实时刷新额度${displayEmail ? ` (${displayEmail})` : ''}`}
          >
            <RefreshCw className={`h-3 w-3 ${loading || isRefreshing ? 'animate-spin text-primary' : ''}`} />
          </button>
        </div>

        {/* Row 2 on mobile / Right on desktop: Model-specific Quota Badges + Desktop Quick Refresh */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2">
          <div
            onClick={(e) => {
              e.stopPropagation();
              void refreshQuota(true, displayEmail);
            }}
            className="flex flex-wrap cursor-pointer items-center gap-1.5 sm:gap-2 rounded-lg py-0.5 transition-all hover:opacity-90 active:scale-95"
            title={`${zoneTitle} · 实时额度: ${h5Pct}% (${h5ResetStr ? `${h5ResetStr} 恢复` : '正常'})${displayEmail ? ` · 账号: ${displayEmail}` : ''} · 点击实时刷新`}
          >
            {/* 100% 真实模型配额胶囊 (带 50% 与 20% 刻度标记线) */}
            <div
              className={`inline-flex items-center gap-1 sm:gap-1.5 rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap shrink-0 border ${
                isDangerZone
                  ? 'border-rose-500/35 bg-rose-500/10 hover:border-rose-500/60'
                  : isWarningZone
                  ? 'border-amber-500/35 bg-amber-500/10 hover:border-amber-500/60'
                  : isClaude
                  ? 'border-purple-500/25 bg-purple-500/5 hover:border-purple-500/50'
                  : isGpt
                  ? 'border-blue-500/25 bg-blue-500/5 hover:border-blue-500/50'
                  : 'border-emerald-500/25 bg-emerald-500/5 hover:border-emerald-500/50'
              }`}
            >
              <span className={`text-[10.5px] font-medium whitespace-nowrap ${
                isDangerZone
                  ? 'text-rose-600 dark:text-rose-400'
                  : isWarningZone
                  ? 'text-amber-600 dark:text-amber-400'
                  : isClaude ? 'text-purple-600 dark:text-purple-400' : isGpt ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {isGemini ? 'Gemini 实时额度' : isGpt ? 'GPT 实时额度' : 'Claude 实时额度'}
              </span>

              {/* 3色物理分段进度条：0~20% 告急红区 / 20~50% 警戒黄区 / 50~100% 充裕绿区 */}
              <div
                className="flex items-center gap-0.5 h-2 w-14 sm:w-20 shrink-0 p-0.5 rounded-full bg-muted/90 border border-border/60"
                title={`3色分段刻度：红区(0%~20% 告急) / 黄区(20%~50% 警戒) / 绿区(50%~100% 充裕) · 当前剩余 ${h5Pct}%`}
              >
                {/* 危险红段 (0%~20%，权重2) */}
                <div className="relative flex-[2] h-full rounded-full bg-rose-500/20 overflow-hidden" title="危险段(0%~20%)">
                  <div
                    className="h-full bg-rose-500 transition-all duration-300 rounded-full"
                    style={{ width: `${redFill}%` }}
                  />
                </div>

                {/* 预警黄段 (20%~50%，权重3) */}
                <div className="relative flex-[3] h-full rounded-full bg-amber-500/20 overflow-hidden" title="预警段(20%~50%)">
                  <div
                    className="h-full bg-amber-400 transition-all duration-300 rounded-full"
                    style={{ width: `${amberFill}%` }}
                  />
                </div>

                {/* 安全绿段 (50%~100%，权重5) */}
                <div className="relative flex-[5] h-full rounded-full bg-emerald-500/20 overflow-hidden" title="安全段(50%~100%)">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${greenFill}%` }}
                  />
                </div>
              </div>

              <span className={`font-mono font-semibold text-[10.5px] ${
                isDangerZone
                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                  : isWarningZone
                  ? 'text-amber-600 dark:text-amber-400'
                  : h5Pct < 100
                  ? isClaude ? 'text-purple-600 dark:text-purple-400' : isGpt ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'
                  : 'text-foreground'
              }`}>
                {h5Pct}%
              </span>

              {/* 极简安全状态标记徽章 */}
              <span className={`px-1 py-0.2 rounded text-[9px] font-semibold leading-none ${
                isSafeZone
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : isWarningZone
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              }`}>
                {zoneTag}
              </span>

              <span className="font-mono text-[9.5px] text-muted-foreground/75">({h5DisplayTag})</span>
            </div>
          </div>

          {/* Quick Refresh Button on desktop */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void refreshQuota(true, displayEmail);
            }}
            disabled={loading || isRefreshing}
            className="hidden sm:inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all shrink-0"
            title={`点击向 Google 官方云端实时刷新额度${displayEmail ? ` (${displayEmail})` : ''}`}
          >
            <RefreshCw className={`h-3 w-3 ${loading || isRefreshing ? 'animate-spin text-primary' : ''}`} />
          </button>
        </div>
      </div>
    </>
  );
};

export default memo(MessageQuotaFooter);
