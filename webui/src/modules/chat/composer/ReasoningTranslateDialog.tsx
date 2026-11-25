import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Languages, Check, Loader2, Sparkles } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
} from '@/shared/ui';
import {
  fetchTranslateConfig,
  updateTranslateConfig,
  probeTranslateEngine,
  type ReasoningTranslateConfig,
} from '@/modules/chat/hooks/useReasoningTranslate';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Used by chat's ChatComposer to configure real-time thinking translation (Microsoft Bing by default). */
export default function ReasoningTranslateDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('chat');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<{ ok: boolean; ms: number; error?: string } | null>(null);

  const [enabled, setEnabled] = React.useState(true);
  const [showOriginal, setShowOriginal] = React.useState(true);
  const [defaultOpenOriginal, setDefaultOpenOriginal] = React.useState(false);
  const [engineType, setEngineType] = React.useState<'bing' | 'ollama' | 'openai-compatible' | 'antigravity'>('bing');

  // OpenAI-Compatible (包括硅基流动) 配置
  const [apiBaseUrl, setApiBaseUrl] = React.useState('https://api.siliconflow.cn/v1');
  const [apiModel, setApiModel] = React.useState('Qwen/Qwen3-8B');
  const [apiKey, setApiKey] = React.useState('');

  // Ollama 配置
  const [ollamaBaseUrl, setOllamaBaseUrl] = React.useState('http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = React.useState('qwen2.5:1.5b');

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setProbeResult(null);
    fetchTranslateConfig()
      .then((data) => {
        const c = data.config;
        setEnabled(c.enabled);
        setShowOriginal(c.showOriginal);
        setDefaultOpenOriginal(c.defaultOpenOriginal);
        setEngineType(c.engine || 'bing');

        const oai = c.engines?.['openai-compatible'] || {};
        if (oai.baseURL) setApiBaseUrl(oai.baseURL);
        if (oai.model) setApiModel(oai.model);
        if (oai.apiKey) setApiKey(oai.apiKey);

        const ol = c.engines?.ollama || {};
        if (ol.baseURL) setOllamaBaseUrl(ol.baseURL);
        if (ol.model) setOllamaModel(ol.model);
      })
      .catch((e) => {
        console.error('加载翻译配置失败:', e);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleApplyPreset = (preset: 'bing' | 'siliconflow-qwen' | 'siliconflow-qwen3' | 'ollama' | 'groq') => {
    setProbeResult(null);
    if (preset === 'bing') {
      setEngineType('bing');
    } else if (preset === 'siliconflow-qwen') {
      setEngineType('openai-compatible');
      setApiBaseUrl('https://api.siliconflow.cn/v1');
      setApiModel('Qwen/Qwen2.5-7B-Instruct');
    } else if (preset === 'siliconflow-qwen3') {
      setEngineType('openai-compatible');
      setApiBaseUrl('https://api.siliconflow.cn/v1');
      setApiModel('Qwen/Qwen3-8B');
    } else if (preset === 'ollama') {
      setEngineType('ollama');
      setOllamaBaseUrl('http://127.0.0.1:11434');
      setOllamaModel('qwen2.5:1.5b');
    } else if (preset === 'groq') {
      setEngineType('openai-compatible');
      setApiBaseUrl('https://api.groq.com/openai/v1');
      setApiModel('llama-3.1-8b-instant');
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const activeConfig = engineType === 'bing'
        ? { timeoutMs: 12000 }
        : engineType === 'ollama'
          ? { baseURL: ollamaBaseUrl, model: ollamaModel }
          : { baseURL: apiBaseUrl, model: apiModel, apiKey };

      const res = await probeTranslateEngine({
        engine: engineType,
        config: activeConfig,
      });
      setProbeResult(res);
    } catch (err) {
      setProbeResult({
        ok: false,
        ms: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Partial<ReasoningTranslateConfig> = {
        enabled,
        showOriginal,
        defaultOpenOriginal,
        engine: engineType,
        migratedToBing: true,
        engines: {
          bing: { timeoutMs: 12000 },
          ollama: { baseURL: ollamaBaseUrl, model: ollamaModel },
          'openai-compatible': { baseURL: apiBaseUrl, model: apiModel, apiKey, displayName: 'SiliconFlow/OpenAI' },
          antigravity: { baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
        },
      };
      await updateTranslateConfig(patch);
      onOpenChange(false);
    } catch (e) {
      console.error('保存翻译配置失败:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <Languages className="h-5 w-5 text-primary" />
          思考过程实时中文翻译设置
        </DialogTitle>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            {/* 开关选项 */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <label className="font-medium text-foreground block">启用思考过程翻译</label>
                <p className="text-xs text-muted-foreground">将模型的英文推理实时译为中文展示</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <label className="font-medium text-foreground block">显示英文原文折叠栏</label>
                <p className="text-xs text-muted-foreground">在译文下方保留「展开英文原文」选项</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOriginal}
                  onChange={(e) => setShowOriginal(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* 快速预设模板 */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">快捷预设模版</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant={engineType === 'bing' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleApplyPreset('bing')}
                >
                  <Sparkles className="h-3 w-3" />
                  Microsoft Bing (免费免配置)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleApplyPreset('siliconflow-qwen3')}
                >
                  硅基流动 Qwen3-8B
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleApplyPreset('siliconflow-qwen')}
                >
                  硅基流动 Qwen2.5 (免费)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleApplyPreset('ollama')}
                >
                  本地 Ollama
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleApplyPreset('groq')}
                >
                  Groq 极速
                </Button>
              </div>
            </div>

            {/* 引擎详细配置 */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-medium text-foreground">翻译服务引擎</label>
                <select
                  value={engineType}
                  onChange={(e) => setEngineType(e.target.value as any)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="bing">Microsoft Bing 免费翻译 (推荐)</option>
                  <option value="openai-compatible">OpenAI 兼容 (硅基流动/Groq等)</option>
                  <option value="ollama">本地 Ollama (0成本离线)</option>
                </select>
              </div>

              {engineType === 'bing' ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground leading-relaxed">
                  已启用 <span className="font-medium text-foreground">Microsoft Bing (Edge)</span> 实时翻译接口，无需本地大模型或 API Key，即开即用且不消耗任何模型额度。
                </div>
              ) : engineType === 'openai-compatible' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground block">API 地址 (Base URL)</label>
                    <Input
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                      placeholder="https://api.siliconflow.cn/v1"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground block">模型名称 (Model)</label>
                    <Input
                      value={apiModel}
                      onChange={(e) => setApiModel(e.target.value)}
                      placeholder="Qwen/Qwen3-8B 或 Qwen/Qwen2.5-7B-Instruct"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground block">API Key (密钥)</label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground block">Ollama 地址</label>
                    <Input
                      value={ollamaBaseUrl}
                      onChange={(e) => setOllamaBaseUrl(e.target.value)}
                      placeholder="http://127.0.0.1:11434"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground block">本地模型名</label>
                    <Input
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      placeholder="qwen2.5:1.5b"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </>
              )}

              {/* 连通性测试按钮与反馈 */}
              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleProbe}
                  disabled={probing}
                  className="h-7 text-xs"
                >
                  {probing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  测试连通性
                </Button>

                {probeResult && (
                  <span className={`text-xs ${probeResult.ok ? 'text-emerald-500 font-medium flex items-center gap-1' : 'text-destructive'}`}>
                    {probeResult.ok ? (
                      <>
                        <Check className="h-3 w-3" />
                        连通可用 ({probeResult.ms}ms)
                      </>
                    ) : (
                      `失败: ${probeResult.error || '无法连接'}`
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* 底部保存与取消 */}
            <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                保存设置
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
