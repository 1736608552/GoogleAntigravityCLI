import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type QuickSettingsSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

/** Rendered by QuickSettingsContent to group related control rows in a rounded card section. */
export default function QuickSettingsSection({
  title,
  children,
  className = '',
}: QuickSettingsSectionProps) {
  return (
    <section className={cn('space-y-2', className)}>
      <h4 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/85">
        {title}
      </h4>
      <div className="shadow-xs divide-y divide-border/50 overflow-hidden rounded-2xl border border-slate-200/75 bg-background/75 dark:border-white/[0.08] dark:bg-zinc-950/45">
        {children}
      </div>
    </section>
  );
}
