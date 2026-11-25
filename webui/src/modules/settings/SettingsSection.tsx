import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's appearance, browser-use, git, tasks and voice tabs to title a block of settings. */
export default function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="px-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/90">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
