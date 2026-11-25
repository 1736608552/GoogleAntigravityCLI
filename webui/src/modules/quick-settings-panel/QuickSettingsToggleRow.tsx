import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/shared/utils';

type QuickSettingsToggleRowProps = {
  label: string;
  icon: LucideIcon;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Rendered by QuickSettingsContent as one switch row for a boolean preference. */
function QuickSettingsToggleRow({
  label,
  icon: Icon,
  checked,
  onCheckedChange,
}: QuickSettingsToggleRowProps) {
  return (
    <div
      onClick={() => onCheckedChange(!checked)}
      className="flex cursor-pointer touch-manipulation items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-accent/50 active:bg-accent/70"
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">{label}</span>
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onCheckedChange(!checked);
        }}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          checked ? 'border-primary bg-primary' : 'border-border bg-muted',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full shadow-xs transition-transform duration-200',
            checked ? 'translate-x-5 bg-white' : 'translate-x-0.5 bg-foreground/55 dark:bg-foreground/75',
          )}
        />
      </button>
    </div>
  );
}

export default memo(QuickSettingsToggleRow);
