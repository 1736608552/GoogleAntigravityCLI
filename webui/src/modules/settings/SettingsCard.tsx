import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

/** Used by the settings module's appearance, browser-use, git and tasks tabs to group related rows in a card. */
export default function SettingsCard({ children, className, divided }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-slate-200/75 bg-card/85 shadow-xs backdrop-blur-sm dark:border-white/[0.08]',
        divided && 'divide-y divide-border/50',
        className,
      )}
    >
      {children}
    </div>
  );
}
