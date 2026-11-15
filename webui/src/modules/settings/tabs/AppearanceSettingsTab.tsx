import { useTranslation } from 'react-i18next';

import { Button, DarkModeToggle } from '@/shared/ui';
import type { CodeEditorSettingsState, ProjectSortOrder } from '@/shared/types';
import { LanguageSelector } from '@/modules/i18n';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useHagemiSettings, resetHagemiPosition } from '@/modules/pet';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

/** Rendered by Settings for the "appearance" tab, covering theme, project sorting, code editor preferences and Hagemi pet companion. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const [petSettings, updatePetSettings] = useHagemiSettings();

  return (
    <div className="space-y-8">
      {/* 哈基米桌宠伴侣设置 */}
      <SettingsSection title="哈基米桌宠伴侣 (Hagemi Pet)">
        <SettingsCard divided>
          <SettingsRow
            label="启用桌宠伴侣"
            description="在页面悬浮显示 Q 版猫娘伴侣，实时响应写代码、思考、执行命令与配额变化，可随手拖动放置"
          >
            <SettingsToggle
              checked={petSettings.enabled}
              onChange={(enabled) => updatePetSettings({ enabled })}
              ariaLabel="启用桌宠伴侣"
            />
          </SettingsRow>

          {petSettings.enabled && (
            <>
              <SettingsRow
                label="显示尺寸"
                description="调节哈基米在屏幕上的显示缩放比例"
              >
                <select
                  value={petSettings.size}
                  onChange={(e) => updatePetSettings({ size: e.target.value as any })}
                  className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-44"
                >
                  <option value="xs">小巧便携 (88px)</option>
                  <option value="s">舒适微型 (112px)</option>
                  <option value="m">标准手办 (138px - 推荐)</option>
                  <option value="l">清晰赏玩 (175px)</option>
                  <option value="xl">特大展示 (225px)</option>
                </select>
              </SettingsRow>

              <SettingsRow
                label="互动与台词语言"
                description="气泡吐槽与日常对话的语言偏好"
              >
                <select
                  value={petSettings.lang}
                  onChange={(e) => updatePetSettings({ lang: e.target.value as any })}
                  className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
                >
                  <option value="zhs">简体中文 (zhs)</option>
                  <option value="en">English (en)</option>
                </select>
              </SettingsRow>

              <SettingsRow
                label="吐槽与互动频率"
                description="控制哈基米在写代码与任务流转中主动冒泡评论的频率"
              >
                <select
                  value={petSettings.chattiness}
                  onChange={(e) => updatePetSettings({ chattiness: e.target.value as any })}
                  className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
                >
                  <option value="silent">安静 (仅动作，不冒泡)</option>
                  <option value="quiet">偶尔 (偶发吐槽)</option>
                  <option value="normal">标准 (适度互动)</option>
                  <option value="chatty">话痨 (元气活跃)</option>
                </select>
              </SettingsRow>

              <SettingsRow
                label="小鱼干配额联动"
                description="将 5h/周度实时额度具象化为小鱼干储备，额度充盈或刷新时欢呼"
              >
                <SettingsToggle
                  checked={petSettings.quotaFish}
                  onChange={(quotaFish) => updatePetSettings({ quotaFish })}
                  ariaLabel="小鱼干配额联动"
                />
              </SettingsRow>

              <SettingsRow
                label="重置位置"
                description="如果被拖动到屏幕边缘或遮挡内容，可一键复位至右下角默认位置"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetHagemiPosition()}
                >
                  恢复默认位置
                </Button>
              </SettingsRow>
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
