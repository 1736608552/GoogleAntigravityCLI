import * as React from 'react';
import { BrainIcon, ChevronDownIcon, ChevronRightIcon, LanguagesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Shimmer } from '@/shared/ui';
import { useReasoningBlockTranslate, isMostlyChinese } from '../hooks/useReasoningTranslate';
import ReasoningTranslateDialog from '../composer/ReasoningTranslateDialog';

/* ─── Context ────────────────────────────────────────────────────── */

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = React.useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

/* ─── Reasoning (root) ───────────────────────────────────────────── */

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export type ReasoningProps = {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
} & React.HTMLAttributes<HTMLDivElement>;

/** Discloses an assistant turn's reasoning text; used by MessageComponent. */
export const Reasoning = React.memo<ReasoningProps>(
  ({
    className,
    isStreaming = false,
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const isExplicitlyClosed = defaultOpen === false;

    // Controllable open state
    const [internalOpen, setInternalOpen] = React.useState(resolvedDefaultOpen);
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;
    const setIsOpen = React.useCallback(
      (next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      },
      [isControlled, onOpenChange]
    );

    // Duration tracking
    const [duration, setDuration] = React.useState<number | undefined>(durationProp);
    const hasEverStreamedRef = React.useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = React.useState(false);
    const startTimeRef = React.useRef<number | null>(null);

    // Sync external duration prop
    React.useEffect(() => {
      if (durationProp !== undefined) setDuration(durationProp);
    }, [durationProp]);

    // Track streaming start/end for duration
    React.useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming]);

    // Auto-open when streaming starts
    React.useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

    // Auto-close after streaming ends
    React.useEffect(() => {
      if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);
        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const contextValue = React.useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          open={isOpen}
          onOpenChange={setIsOpen}
          className={cn('not-prose', className)}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);
Reasoning.displayName = 'Reasoning';

/* ─── ReasoningTrigger ───────────────────────────────────────────── */

export type ReasoningTriggerProps = {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number): React.ReactNode => {
  if (isStreaming || duration === 0) {
    return <Shimmer>思考中...</Shimmer>;
  }
  if (duration === undefined) {
    return <p>思考了几秒</p>;
  }
  return <p>思考了 {duration} 秒</p>;
};

/** Toggle of Reasoning, used by MessageComponent. */
export const ReasoningTrigger = React.memo<ReasoningTriggerProps>(
  ({
    className,
    children,
    getThinkingMessage,
    ...props
  }) => {
    const { t } = useTranslation('chat');
    const { isStreaming, isOpen, duration } = useReasoning();

    const thinkingContent = React.useMemo(() => {
      if (getThinkingMessage) {
        return getThinkingMessage(isStreaming, duration);
      }
      if (isStreaming || duration === 0) {
        return <Shimmer>{t('thinking.title', { defaultValue: '思考中...' })}</Shimmer>;
      }
      if (duration === undefined) {
        return <p>{t('thinking.thoughtForFewSeconds', { defaultValue: '思考了几秒' })}</p>;
      }
      return <p>{t('thinking.thoughtForSeconds', { count: duration, defaultValue: `思考了 ${duration} 秒` })}</p>;
    }, [getThinkingMessage, isStreaming, duration, t]);

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="h-4 w-4" />
            {thinkingContent}
            <ChevronDownIcon
              className={cn(
                'h-4 w-4 transition-transform',
                isOpen ? 'rotate-180' : 'rotate-0'
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);
ReasoningTrigger.displayName = 'ReasoningTrigger';

/* ─── ReasoningContent ───────────────────────────────────────────── */

export type ReasoningContentProps = {
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>;

/** Body of Reasoning, used by MessageComponent. */
export const ReasoningContent = React.memo<ReasoningContentProps>(
  ({ className, children, ...props }) => (
    <CollapsibleContent
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
);
ReasoningContent.displayName = 'ReasoningContent';

/* ─── ReasoningTranslatedBody (中文增量翻译与原文折叠) ─────────────────── */

export type ReasoningTranslatedBodyProps = {
  rawText: string;
  isStreaming?: boolean;
  className?: string;
  renderContent?: (text: string) => React.ReactNode;
};

export const ReasoningTranslatedBody = React.memo<ReasoningTranslatedBodyProps>(
  ({ rawText, isStreaming = false, className, renderContent }) => {
    const { translatedText, isTranslating } = useReasoningBlockTranslate(rawText, isStreaming);
    const [showOriginal, setShowOriginal] = React.useState(false);
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);

    const hasTranslation = Boolean(
      translatedText &&
      translatedText.trim() !== rawText.trim() &&
      isMostlyChinese(translatedText)
    );
    const displayText = hasTranslation ? translatedText! : rawText;

    return (
      <div className={cn('space-y-2', className)}>
        {hasTranslation ? (
          <div className="flex items-center justify-between text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <div className="flex items-center gap-1.5">
              <LanguagesIcon className="h-3 w-3" />
              <span>已实时翻译为中文呈现</span>
              {isTranslating && <span className="animate-pulse">（翻译更新中...）</span>}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsDialogOpen(true);
              }}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors px-1"
            >
              设置
            </button>
          </div>
        ) : !isMostlyChinese(rawText) ? (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1">
            <span>英文推理过程</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsDialogOpen(true);
              }}
              className="flex items-center gap-1 text-xs text-primary hover:underline transition-colors"
            >
              <LanguagesIcon className="h-3 w-3" />
              <span>翻译设置</span>
            </button>
          </div>
        ) : null}

        {renderContent ? (
          renderContent(displayText)
        ) : (
          <div className="whitespace-pre-wrap">{displayText}</div>
        )}

        {/* 展开/收起英文原文 */}
        {hasTranslation && (
          <div className="mt-3 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowOriginal(!showOriginal);
              }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <ChevronRightIcon
                className={cn('h-3.5 w-3.5 transition-transform duration-200', showOriginal && 'rotate-90')}
              />
              <span>{showOriginal ? '收起英文原文' : `展开英文原文 (${rawText.length} 字符)`}</span>
            </button>

            {showOriginal && (
              <div className="mt-2 rounded-md bg-muted/40 border border-border/50 p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap select-text leading-relaxed">
                {rawText}
              </div>
            )}
          </div>
        )}

        <ReasoningTranslateDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      </div>
    );
  }
);
ReasoningTranslatedBody.displayName = 'ReasoningTranslatedBody';
