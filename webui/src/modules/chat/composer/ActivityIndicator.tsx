import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '@/shared/ui';
import type { SessionActivity } from '@/shared/types';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  isInputFocused?: boolean;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['思考中', '处理中', '分析中', '生成中', '计算中', '思考中'];
const EXIT_ANIMATION_MS = 220;

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: a shimmering activity label, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 *
 * Rendered by chat's ChatComposer above the input so the user can see and
 * interrupt the in-flight turn without leaving the composer.
 */
export default function ActivityIndicator({ activity, onAbort, isInputFocused = false }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const fallbackStartedAtRef = useRef<number>(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      fallbackStartedAtRef.current = typeof activity.startedAt === 'number' && activity.startedAt > 0 ? activity.startedAt : Date.now();
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity]);

  const rawStartedAt = renderedActivity?.startedAt;
  const effectiveStartedAt = typeof rawStartedAt === 'number' && rawStartedAt > 0 ? rawStartedAt : fallbackStartedAtRef.current;

  useEffect(() => {
    if (!renderedActivity) {
      setElapsedSeconds(0);
      return;
    }

    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - effectiveStartedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [renderedActivity, effectiveStartedAt]);

  if (!renderedActivity) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const rawStatus = renderedActivity.statusText;
  let statusText = rawStatus;
  if (rawStatus) {
    const lower = rawStatus.toLowerCase().trim();
    if (lower.startsWith('think')) statusText = t('claudeStatus.actions.thinking', { defaultValue: '思考中' });
    else if (lower.startsWith('reason')) statusText = t('claudeStatus.actions.reasoning', { defaultValue: '思考中' });
    else if (lower.startsWith('process')) statusText = t('claudeStatus.actions.processing', { defaultValue: '处理中' });
    else if (lower.startsWith('analyz')) statusText = t('claudeStatus.actions.analyzing', { defaultValue: '分析中' });
    else if (lower.startsWith('work')) statusText = t('claudeStatus.actions.working', { defaultValue: '生成中' });
    else if (lower.startsWith('comput')) statusText = t('claudeStatus.actions.computing', { defaultValue: '计算中' });
  }
  const label = (statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
    .replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: `${seconds}秒` })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: `${minutes}分 ${seconds}秒` });
  const tabSurfaceClassName = [
    'chat-activity-tab inline-flex h-7 items-center rounded-full border bg-white/95 px-3 text-xs backdrop-blur-md transition-all duration-200 dark:bg-zinc-900/90',
    isInputFocused
      ? 'border-primary/25 shadow-sm'
      : 'border-black/[0.06] shadow-sm dark:border-white/[0.08]',
  ].join(' ');

  return (
    <div
      className={`pointer-events-none bg-transparent ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="flex items-end justify-between gap-2">
        <div className={`${tabSurfaceClassName} gap-2`}>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
          <Shimmer className="font-medium">{`${label}…`}</Shimmer>
          <span className="tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
        </div>

        {renderedActivity.canInterrupt && onAbort && (
          <button
            type="button"
            data-pet-anchor="stop"
            onClick={() => {
              setIsExiting(true);
              setTimeout(() => setRenderedActivity(null), 100);
              onAbort?.();
            }}
            className={`${tabSurfaceClassName} pointer-events-auto gap-1.5 text-muted-foreground hover:bg-card hover:text-destructive`}
            aria-label={t('claudeStatus.stop', { defaultValue: 'Stop' })}
          >
            <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>{t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
            <kbd className="hidden rounded border border-border/60 px-1 text-[10px] text-muted-foreground/70 sm:inline-block">
              esc
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
