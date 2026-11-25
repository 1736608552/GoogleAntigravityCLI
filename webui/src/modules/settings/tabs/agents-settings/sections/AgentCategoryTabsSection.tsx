import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { AgentCategory, AgentProvider } from '@/shared/types';

type AgentCategoryTabsSectionProps = {
  categories: AgentCategory[];
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

/** Rendered by AgentsSettingsTab to switch between the selected provider's categories. */
export default function AgentCategoryTabsSection({
  categories,
  selectedAgent,
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex-shrink-0 border-b border-border/60 bg-muted/20 px-3 py-2 md:px-5">
      <div role="tablist" className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
        {categories.map((category) => {
          const isSelected = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelectCategory(category)}
              className={cn(
                'whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-medium touch-manipulation transition-all duration-150 sm:text-sm',
                isSelected
                  ? 'bg-card text-primary shadow-xs ring-1 ring-border/70'
                  : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
              )}
            >
              {category === 'account' && t('tabs.account')}
              {category === 'proxy' && t('tabs.proxy', { defaultValue: '网络代理' })}
              {category === 'permissions' && t('tabs.permissions')}
              {category === 'mcp' && t('tabs.mcpServers')}
              {category === 'skills' && t('tabs.skills', {
                defaultValue: selectedAgent === 'opencode' ? 'Shared Skills' : 'Skills',
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
