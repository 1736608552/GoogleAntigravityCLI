import { Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type QuickSettingsPanelHeaderProps = {
  isMobile?: boolean;
  onClose?: () => void;
};

/** Rendered by QuickSettingsPanelView as the control center drawer's top header with drag handle and close button. */
export default function QuickSettingsPanelHeader({
  isMobile = false,
  onClose,
}: QuickSettingsPanelHeaderProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex-shrink-0 border-b border-border/60 bg-background/50 px-4 pb-3 pt-2.5 backdrop-blur-md">
      {isMobile && (
        <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Settings2 className="h-4 w-4" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {t('quickSettings.title')}
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:actions.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
