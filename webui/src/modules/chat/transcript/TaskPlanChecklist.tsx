import React, { memo, useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle, Quote } from 'lucide-react';

export type TaskPlanItem = {
  id: string;
  status: 'completed' | 'in_progress' | 'pending' | 'failed';
  text: string;
};

type TaskPlanChecklistProps = {
  /** Raw markdown content or task block */
  content: string;
  /** Optional callback when user clicks quote action */
  onQuote?: (text: string) => void;
  className?: string;
};

const TASK_LINE_REGEX = /^[-*]?\s*(?:(\d+)\.\s*)?\[([ xX/!>✓✔oO\-]?)\]\s*(.*)$/;

/**
 * Extracts structured task plan items from markdown text.
 * Returns null if the text does not contain a coherent checklist.
 */
export function extractTaskPlanItems(content: string): TaskPlanItem[] | null {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split('\n');
  const items: TaskPlanItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const match = trimmed.match(TASK_LINE_REGEX);
    if (match) {
      const mark = (match[2] || '').trim();
      const rawText = match[3] || '';
      // Clean leading markdown formatting
      const text = rawText.replace(/^[*_~`]+|[*_~`]+$/g, '').trim();

      if (!text) continue;

      let status: TaskPlanItem['status'] = 'pending';
      if (/^[xX✓✔]$/.test(mark)) {
        status = 'completed';
      } else if (/^[/oO>]$/.test(mark)) {
        status = 'in_progress';
      } else if (mark === '!') {
        status = 'failed';
      } else if (text.startsWith('正在') || text.startsWith('进行中') || text.includes('中...')) {
        status = 'in_progress';
      }

      items.push({
        id: `task-item-${items.length}-${i}`,
        status,
        text,
      });
    }
  }

  // Only consider it a valid plan checklist if there are at least 2 structured task items
  return items.length >= 2 ? items : null;
}

/**
 * Modern Task Plan Checklist Card (Cursor / Claude Code style)
 * Displays interactive task progress card with smooth visual badges and quick actions.
 */
export const TaskPlanChecklist = memo(({ content, onQuote, className = '' }: TaskPlanChecklistProps) => {
  const items = useMemo(() => extractTaskPlanItems(content), [content]);

  if (!items || items.length === 0) {
    return null;
  }

  const completedCount = items.filter((item) => item.status === 'completed').length;
  const progressPercent = Math.round((completedCount / items.length) * 100);

  const handleQuoteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onQuote) {
      const summaryText = items
        .map((item) => {
          const mark = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]';
          return `- ${mark} ${item.text}`;
        })
        .join('\n');
      onQuote(summaryText);
    }
  };

  return (
    <div
      className={`relative my-3 overflow-hidden rounded-xl border border-border/70 bg-card/75 p-3.5 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-border/90 hover:shadow-md dark:bg-zinc-900/80 ${className}`}
    >
      {/* Top Header / Progress Bar */}
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            任务执行清单 ({completedCount}/{items.length})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-medium text-muted-foreground">
            {progressPercent}%
          </span>
          {onQuote && (
            <button
              type="button"
              onClick={handleQuoteClick}
              title="引用任务清单到输入框"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Quote className="h-3 w-3" />
              <span>引用</span>
            </button>
          )}
        </div>
      </div>

      {/* Task Items List */}
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const isCompleted = item.status === 'completed';
          const isInProgress = item.status === 'in_progress';
          const isFailed = item.status === 'failed';

          return (
            <div
              key={item.id}
              className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                isInProgress
                  ? 'bg-primary/10 font-medium text-foreground'
                  : isCompleted
                  ? 'text-muted-foreground'
                  : 'text-foreground/90'
              }`}
            >
              {/* Status Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 transition-transform duration-200" />
                ) : isInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : isFailed ? (
                  <XCircle className="h-4 w-4 text-rose-500" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/50" />
                )}
              </div>

              {/* Task Text */}
              <span
                className={`flex-1 text-xs leading-relaxed sm:text-sm ${
                  isCompleted ? 'line-through opacity-75' : ''
                } ${isInProgress ? 'font-medium text-primary-foreground/90 dark:text-primary-foreground' : ''}`}
              >
                {item.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

TaskPlanChecklist.displayName = 'TaskPlanChecklist';
export default TaskPlanChecklist;
