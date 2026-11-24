import React, { memo, useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

type RunningStepAccordionProps = {
  title: string;
  status?: 'running' | 'completed' | 'error';
  initialDurationMs?: number;
  startedAt?: number;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
};

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m ${secs}s`;
}

/**
 * Running Step Accordion Component (Cursor / Windsurf style)
 * Clean, collapsible running row showing real-time elapsed duration and expandable details.
 */
export const RunningStepAccordion = memo(({
  title,
  status = 'completed',
  initialDurationMs,
  startedAt,
  children,
  defaultExpanded = false,
  className = '',
}: RunningStepAccordionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    if (typeof initialDurationMs === 'number') {
      return Math.max(0, Math.round(initialDurationMs / 1000));
    }
    if (status === 'running' && typeof startedAt === 'number') {
      return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    }
    return 0;
  });

  // Real-time ticking stopwatch only while running
  useEffect(() => {
    if (status !== 'running') return;

    const baseStart = (startedAt && status === 'running') ? startedAt : (Date.now() - elapsedSeconds * 1000);
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - baseStart) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [status, startedAt]);

  const formattedTime = useMemo(() => {
    if (elapsedSeconds > 0) {
      return formatDuration(elapsedSeconds);
    }
    if (status === 'completed') {
      return '已完成';
    }
    if (status === 'error') {
      return '失败';
    }
    return '0s';
  }, [elapsedSeconds, status]);

  return (
    <div className={`my-2 overflow-hidden rounded-lg border border-border/60 bg-muted/30 transition-all dark:bg-zinc-900/40 ${className}`}>
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-mono transition-colors hover:bg-muted/50 sm:text-sm"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
          ) : status === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
          )}
          <span className="truncate font-sans font-medium text-foreground/90">
            {title}
          </span>
        </div>

        {/* Stopwatch & Chevron */}
        <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{formattedTime}</span>
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/70" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
          )}
        </div>
      </button>

      {/* Expandable content area */}
      {isExpanded && children && (
        <div className="border-t border-border/40 bg-card/40 p-3">
          {children}
        </div>
      )}
    </div>
  );
});

RunningStepAccordion.displayName = 'RunningStepAccordion';
export default RunningStepAccordion;
