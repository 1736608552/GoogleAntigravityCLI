import { useEffect, useRef } from 'react';
import { Bell, Bot, GitBranch, Info, Key, Mic, MonitorPlay, Palette, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { PillBar, Pill } from '@/shared/ui';
import type { SettingsMainTab } from '@/shared/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof Bot;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', icon: Bot },
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', icon: Key },
  { id: 'voice', labelKey: 'mainTabs.voice', icon: Mic },
  { id: 'browser', labelKey: 'mainTabs.browser', icon: MonitorPlay },
  { id: 'plugins', labelKey: 'mainTabs.plugins', icon: Puzzle },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

/** Rendered by Settings to switch between the settings dialog's main sections. */
export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');
  const mobilePillRefs = useRef<Partial<Record<SettingsMainTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const activeButton = mobilePillRefs.current[activeTab];
    activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 border-r border-border/60 bg-muted/25 md:flex md:flex-col">
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm transition-all duration-150',
                  isActive
                    ? 'bg-card font-semibold text-foreground shadow-xs ring-1 ring-border/70'
                    : 'font-medium text-muted-foreground hover:bg-card/60 hover:text-foreground',
                )}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-1.5 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-primary"
                  />
                )}
                <Icon className={cn('h-4 w-4 flex-shrink-0', isActive && 'text-primary')} />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile horizontal nav — auto-centering pill bar */}
      <div className="flex-shrink-0 border-b border-border/60 bg-background/60 px-3 py-2 backdrop-blur-sm md:hidden">
        <PillBar className="scrollbar-hide w-full overflow-x-auto rounded-xl border border-slate-200/70 bg-muted/45 p-1 dark:border-white/[0.08]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <Pill
                key={item.id}
                ref={(el) => {
                  mobilePillRefs.current[item.id] = el;
                }}
                isActive={isActive}
                onClick={() => onChange(item.id)}
                className={cn(
                  'h-8 flex-shrink-0 rounded-lg px-3 py-1.5 text-xs',
                  isActive && 'text-primary',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
                {t(item.labelKey)}
              </Pill>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
