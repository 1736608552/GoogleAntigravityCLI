import { memo, useCallback } from 'react';

import { QuickSettingsPanel } from '@/modules/quick-settings-panel';
import { useProjectQuickSettingsState } from '@/modules/project-workspace/context/ProjectsStateContext';

/** Rendered by ProjectWorkspaceShell to bind the header-triggered quick-settings control center to QuickSettingsPanel. */
function ProjectQuickSettingsRegion() {
  const { quickSettingsOpen, setQuickSettingsOpen, openSettings } = useProjectQuickSettingsState();

  const handleOpenFullSettings = useCallback(() => {
    setQuickSettingsOpen(false);
    openSettings('appearance');
  }, [openSettings, setQuickSettingsOpen]);

  return (
    <QuickSettingsPanel
      isOpen={quickSettingsOpen}
      onOpenChange={setQuickSettingsOpen}
      onOpenFullSettings={handleOpenFullSettings}
      showEdgeHandle={false}
    />
  );
}

export default memo(ProjectQuickSettingsRegion);
