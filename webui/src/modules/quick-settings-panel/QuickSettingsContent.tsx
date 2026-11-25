import {
  ArrowUpRight,
  Brain,
  Eye,
  Languages,
  Mic,
  Moon,
  Sliders,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '@/shared/ui';
import { LanguageSelector } from '@/modules/i18n';
import { cn } from '@/shared/utils';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';
import QuickSettingsSection from '@/modules/quick-settings-panel/QuickSettingsSection';
import QuickSettingsToggleRow from '@/modules/quick-settings-panel/QuickSettingsToggleRow';

/** Declarative description of one quick settings toggle row - its preference key, translation key and icon - so the rows can be rendered from a list instead of hand-written. */
type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
];

const INPUT_SETTING_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'sendByCtrlEnter',
    labelKey: 'quickSettings.sendByCtrlEnter',
    icon: Languages,
  },
  {
    key: 'voiceEnabled',
    labelKey: 'quickSettings.voiceEnabled',
    icon: Mic,
  },
];

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
  onOpenFullSettings?: () => void;
  isMobile?: boolean;
};

/** Rendered by QuickSettingsPanelView to show the drawer's appearance, tool display and input preference cards. */
export default function QuickSettingsContent({
  isDarkMode,
  preferences,
  onPreferenceChange,
  onOpenFullSettings,
  isMobile = false,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const inputSettingToggles = preferences.voiceEnabled
    ? INPUT_SETTING_TOGGLES
    : INPUT_SETTING_TOGGLES.filter(({ key }) => key !== 'voiceEnabled');

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div
      className={cn(
        'flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-4',
        isMobile && 'pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]',
      )}
    >
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className="flex items-center justify-between gap-3 px-3.5 py-3">
          <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
              {isDarkMode ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="truncate">{t('quickSettings.darkMode')}</span>
          </span>
          <DarkModeToggle />
        </div>
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
      </QuickSettingsSection>

      <p className="-mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
        {t('quickSettings.sendByCtrlEnterDescription')}
      </p>

      {onOpenFullSettings && (
        <button
          type="button"
          onClick={onOpenFullSettings}
          className="shadow-xs flex w-full touch-manipulation items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-background/80 px-4 py-3 text-left text-sm font-medium text-foreground transition-all hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99] dark:border-white/[0.08]"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sliders className="h-3.5 w-3.5" />
            </span>
            <span>{t('title', { defaultValue: '完整设置中心' })}</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
