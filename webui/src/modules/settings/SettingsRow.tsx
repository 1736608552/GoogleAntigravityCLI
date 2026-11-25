import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's appearance, browser-use and tasks tabs to lay out one labelled setting and its control. */
export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3.5', className)}>
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="max-w-full flex-shrink-0">{children}</div>
    </div>
  );
}
