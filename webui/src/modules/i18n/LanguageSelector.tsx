

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

import { languages } from '@/modules/i18n/languages';

type LanguageSelectorProps = {
  compact?: boolean;
};

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists it as a user preference.
 *
 * Used by the settings module (appearance tab) and the quick-settings-panel module
 * so the user can switch language from either surface.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */
export default function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
            <Languages className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{t('account.language')}</span>
        </span>
        <select
          value={i18n.language}
          onChange={handleLanguageChange}
          className="max-w-[138px] shrink-0 rounded-xl border border-border/70 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Full style for Settings page
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3.5">
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-medium text-foreground">
          {t('account.languageLabel')}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('account.languageDescription')}
        </div>
      </div>
      <select
        value={i18n.language}
        onChange={handleLanguageChange}
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:w-40"
      >
        {languages.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
