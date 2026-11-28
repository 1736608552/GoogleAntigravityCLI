import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Copy,
  Edit2,
  ExternalLink,
  Globe,
  Key,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  User,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import {
  fetchAntigravityQuota,
  getCachedAccountQuota,
  updateCachedAntigravityQuota,
} from '@/modules/chat';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';
import type { AntigravityAccount, AntigravityBankedReset, ProviderAuthStatus } from '@/shared/types';

const GRADIENTS = [
  'from-blue-600 to-indigo-600',
  'from-emerald-600 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-600 to-purple-600',
  'from-cyan-600 to-blue-600',
];

function getGradientForString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function getInitial(name?: string, email?: string): string {
  const text = (name && name.trim()) || (email && email.trim()) || 'G';
  return text.slice(0, 1).toUpperCase();
}

/**
 * Bulletproof Google Account Avatar component with Google AI Pro official signature rainbow ring:
 * - When isPro: wrapped in Google official 4-color gradient ring (#f59e0b, #ec4899, #8b5cf6, #3b82f6)
 * - With a subtle glow and PRO corner badge
 * - Loads through server proxy `/api/antigravity-avatar/:email`
 * - Gracefully falls back to Google-colored initial letter avatar
 */
export function GoogleAccountAvatar({
  email,
  name,
  picture,
  isPrimary,
  isPro = true,
  tierType = 'pro',
  size = 'md',
  className = '',
}: {
  email?: string;
  name?: string;
  picture?: string;
  isPrimary?: boolean;
  isPro?: boolean;
  tierType?: 'pro' | 'enterprise' | 'free';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [email, picture]);

  const sizeConfig = {
    xs: { frame: 'h-6 w-6 p-[1.5px]', inner: 'h-full w-full text-[9px]', crown: 'text-[8px] -top-1.5 -right-1', badge: 'text-[6.5px] -bottom-0.5 -right-1 px-0.5' },
    sm: { frame: 'h-8 w-8 p-[2px]', inner: 'h-full w-full text-[11px]', crown: 'text-[9px] -top-1.5 -right-1', badge: 'text-[7px] -bottom-0.5 -right-1 px-1' },
    md: { frame: 'h-9 w-9 p-[2px]', inner: 'h-full w-full text-xs', crown: 'text-[10px] -top-1.5 -right-1', badge: 'text-[8px] -bottom-1 -right-1 px-1' },
    lg: { frame: 'h-11 w-11 p-[2.5px]', inner: 'h-full w-full text-sm', crown: 'text-xs -top-2 -right-1.5', badge: 'text-[9px] -bottom-1 -right-1 px-1.5' },
  }[size];

  const avatarSrc = email
    ? `/api/antigravity-avatar/${encodeURIComponent(email)}`
    : picture || null;

  const showProRing = isPro !== false && tierType !== 'free';

  return (
    <div
      className={`relative flex-shrink-0 select-none rounded-full flex items-center justify-center transition-all ${sizeConfig.frame} ${className}`}
      style={
        showProRing
          ? {
              background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 35%, #8b5cf6 70%, #3b82f6 100%)',
              boxShadow: '0 0 8px rgba(139, 92, 246, 0.45), 0 0 2px rgba(245, 158, 11, 0.3)',
            }
          : {
              background: 'var(--border)',
              padding: '1px',
            }
      }
    >
      <div className={`rounded-full overflow-hidden flex items-center justify-center bg-background ring-1 ring-background ${sizeConfig.inner}`}>
        {!imgError && avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name || email || 'Google Account'}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            className="h-full w-full rounded-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center rounded-full bg-gradient-to-tr ${getGradientForString(
              email || name || 'G'
            )} font-bold text-white shadow-xs`}
          >
            {getInitial(name, email)}
          </div>
        )}
      </div>

      {isPrimary && (
        <span
          className={`absolute ${sizeConfig.crown} pointer-events-none drop-shadow-xs z-20`}
          title="默认主账号"
        >
          👑
        </span>
      )}

      {showProRing && (
        <span
          className={`absolute ${sizeConfig.badge} font-black text-white rounded-full leading-none z-10 shadow-xs border border-background select-none`}
          style={{
            background: 'linear-gradient(135deg, #f59e0b, #8b5cf6)',
          }}
        >
          PRO
        </span>
      )}
    </div>
  );
}

type AntigravityAccountManagerProps = {
  authStatus: ProviderAuthStatus;
  onRefreshAuth?: () => void;
  onNavigateToProxy?: () => void;
};

export default function AntigravityAccountManager({
  authStatus,
  onRefreshAuth,
  onNavigateToProxy,
}: AntigravityAccountManagerProps) {
  const { t } = useTranslation('settings');
  const [accounts, setAccounts] = useState<AntigravityAccount[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [liveQuota, setLiveQuota] = useState(() => getCachedAccountQuota());
  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);
  // Tracks which banked reset card is currently being redeemed to prevent duplicate submissions.
  const [claimingResetId, setClaimingResetId] = useState<string | null>(null);

  const handleRefreshQuota = useCallback(async () => {
    setIsRefreshingQuota(true);
    try {
      const snap = await fetchAntigravityQuota(true);
      if (snap) setLiveQuota(snap);
    } finally {
      setIsRefreshingQuota(false);
    }
  }, []);

  // Inline editing account label
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState('');
  const [isSavingLabel, setIsSavingLabel] = useState(false);

  // Add Account Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'oauth' | 'current' | 'token'>('oauth');

  // OAuth Flow State
  const [oauthStep, setOauthStep] = useState<
    'idle' | 'generating' | 'waiting_code' | 'verifying' | 'success'
  >('idle');
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthCodeInput, setOauthCodeInput] = useState('');
  const [oauthFeedback, setOauthFeedback] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Save current CLI account state
  const [currentLabelInput, setCurrentLabelInput] = useState('');
  const [currentSaving, setCurrentSaving] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  // Token Import State
  const [tokenJsonInput, setTokenJsonInput] = useState('');
  const [tokenLabelInput, setTokenLabelInput] = useState('');
  const [tokenImporting, setTokenImporting] = useState(false);
  const [tokenImportError, setTokenImportError] = useState<string | null>(null);

  // Proxy vs Direct Connection Mode State
  const [proxyMode, setProxyMode] = useState<'yes' | 'no'>('yes');
  const [isTogglingProxy, setIsTogglingProxy] = useState(false);

  const fetchProxyToggle = useCallback(async () => {
    try {
      const res = await fetch('/api/system/proxy-toggle');
      if (res.ok) {
        const d = await res.json();
        if (d && d.mode) {
          setProxyMode(d.mode === 'no' ? 'no' : 'yes');
        }
      }
    } catch (_) {}
  }, []);

  const handleToggleProxy = async (targetMode: 'yes' | 'no') => {
    setIsTogglingProxy(true);
    try {
      const res = await fetch('/api/system/proxy-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: targetMode }),
      });
      const d = await res.json();
      if (d && d.mode) {
        setProxyMode(d.mode);
        setSuccessMsg(`网络连接模式已成功切换为：${d.mode === 'yes' ? '🌐 SOCKS5 代理模式' : '⚡ 直连模式 (Direct)'}`);
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (e: any) {
      setErrorMsg('切换网络模式异常: ' + (e?.message || '未知错误'));
    } finally {
      setIsTogglingProxy(false);
    }
  };

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const response = await api.providers.antigravityAccounts();
      if (response.ok) {
        const json = await response.json();
        const data = json.data || json;
        setAccounts(data.accounts || []);
        setActiveEmail(data.activeEmail || null);
      } else {
        setErrorMsg('获取账号列表失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '获取账号列表网络异常');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
    void fetchProxyToggle();
  }, [fetchAccounts, fetchProxyToggle]);

  const handleClaimBankedReset = async (card: AntigravityBankedReset, email?: string) => {
    if (!card.resetId || claimingResetId) return;
    if (!window.confirm(`确定要使用重置卡「${card.displayLabel}」（剩余 ${card.remainingCount} 张）立即重置配额吗？`)) {
      return;
    }
    setClaimingResetId(card.resetId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const response = await api.providers.claimAntigravityBankedReset(card.resetId, email);
      const json = await response.json().catch(() => ({}));
      const data = json.data || json;
      if (response.ok && data?.ok) {
        if (data.quotaSnapshot) {
          setLiveQuota(data.quotaSnapshot);
          updateCachedAntigravityQuota(data.quotaSnapshot);
        }
        setSuccessMsg(data.message || '重置卡已生效，实时配额已刷新');
        void fetchAccounts();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setErrorMsg(json.error || data?.error || '重置卡使用失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '重置卡激活请求异常');
    } finally {
      setClaimingResetId(null);
    }
  };

  const handleSwitchAccount = async (email: string) => {
    setSwitchingEmail(email);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const response = await api.providers.switchAntigravityAccount(email);
      const json = await response.json();
      if (response.ok && (json.data?.ok || json.ok)) {
        setActiveEmail(email);
        setSuccessMsg(`已成功切换至：${email}`);
        await fetchAccounts();
        onRefreshAuth?.();
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(json.error || json.data?.error || '切换账号失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '切换账号请求失败');
    } finally {
      setSwitchingEmail(null);
    }
  };

  const handleDeleteAccount = async (email: string) => {
    if (!window.confirm(`确定要移除账号 "${email}" 吗？此操作不会影响您的 Google 原账号。`)) {
      return;
    }
    setDeletingEmail(email);
    setErrorMsg(null);
    try {
      const response = await api.providers.removeAntigravityAccount(email);
      const json = await response.json();
      if (response.ok && (json.data?.ok || json.ok)) {
        setSuccessMsg(`已移除账号：${email}`);
        await fetchAccounts();
        onRefreshAuth?.();
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(json.error || json.data?.error || '删除账号失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '删除账号请求失败');
    } finally {
      setDeletingEmail(null);
    }
  };

  const handleSaveLabel = async (email: string) => {
    setIsSavingLabel(true);
    try {
      const response = await api.providers.updateAntigravityAccountLabel(
        email,
        editingLabelValue.trim()
      );
      if (response.ok) {
        setEditingEmail(null);
        await fetchAccounts();
      }
    } catch (_) {
    } finally {
      setIsSavingLabel(false);
    }
  };

  // Start OAuth Link Generation
  const handleStartOAuth = useCallback(async () => {
    setOauthStep('generating');
    setOauthFeedback(null);
    try {
      const res = await api.providers.startAntigravityCliLogin();
      const json = await res.json();
      const data = json.data || json;
      if (res.ok && data.ok && data.url && data.id) {
        setOauthSessionId(data.id);
        setOauthUrl(data.url);
        setOauthStep('waiting_code');
      } else {
        setOauthStep('idle');
        setOauthFeedback(data.error || '获取 Google 授权链接失败，请检查网络或旁路由');
      }
    } catch (err: any) {
      setOauthStep('idle');
      setOauthFeedback(err?.message || '发起授权请求异常');
    }
  }, []);

  // When modal opens with OAuth tab, auto-start generation
  useEffect(() => {
    if (isModalOpen && activeTab === 'oauth' && oauthStep === 'idle') {
      void handleStartOAuth();
    }
  }, [isModalOpen, activeTab, oauthStep, handleStartOAuth]);

  // Complete OAuth Code Submission
  const handleCompleteOAuth = async () => {
    if (!oauthSessionId || !oauthCodeInput.trim()) {
      setOauthFeedback('请先粘贴授权跳转后的 URL 或授权 Code');
      return;
    }

    setOauthStep('verifying');
    setOauthFeedback('正在提交 Code 并等待 Google 交换令牌...');

    try {
      const res = await api.providers.completeAntigravityCliLogin(
        oauthSessionId,
        oauthCodeInput.trim()
      );
      const json = await res.json();
      const data = json.data || json;
      if (!res.ok || data.ok === false) {
        setOauthStep('waiting_code');
        setOauthFeedback(data.error || '提交 Code 失败');
        return;
      }

      // Poll login status
      let attempts = 0;
      const pollTimer = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await api.providers.getAntigravityCliLoginStatus(oauthSessionId);
          const statusJson = await statusRes.json();
          const statusData = statusJson.data || statusJson;

          if (statusData.status === 'success') {
            clearInterval(pollTimer);
            setOauthStep('success');
            setOauthFeedback('Google 账号授权成功并已自动激活！');
            await fetchAccounts();
            onRefreshAuth?.();
            setTimeout(() => {
              setIsModalOpen(false);
              resetOAuthState();
            }, 1200);
          } else if (statusData.status === 'error') {
            clearInterval(pollTimer);
            setOauthStep('waiting_code');
            setOauthFeedback(statusData.error || '授权验证失败，请重新获取 Code 提交');
          } else if (attempts > 35) {
            clearInterval(pollTimer);
            setOauthStep('waiting_code');
            setOauthFeedback('等待验证超时，请重试');
          }
        } catch (_) {
          if (attempts > 35) {
            clearInterval(pollTimer);
            setOauthStep('waiting_code');
            setOauthFeedback('轮询验证超时，请重试');
          }
        }
      }, 1500);
    } catch (err: any) {
      setOauthStep('waiting_code');
      setOauthFeedback(err?.message || '提交验证请求异常');
    }
  };

  const handleCopyOAuthUrl = () => {
    if (!oauthUrl) return;
    void navigator.clipboard.writeText(oauthUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const resetOAuthState = () => {
    if (oauthSessionId && oauthStep !== 'success') {
      void api.providers.cancelAntigravityCliLogin(oauthSessionId);
    }
    setOauthStep('idle');
    setOauthSessionId(null);
    setOauthUrl(null);
    setOauthCodeInput('');
    setOauthFeedback(null);
    setCopiedUrl(false);
    setCurrentLabelInput('');
    setCurrentError(null);
    setTokenJsonInput('');
    setTokenLabelInput('');
    setTokenImportError(null);
  };

  // Quick Save Current CLI Token
  const handleSaveCurrentCli = async () => {
    setCurrentSaving(true);
    setCurrentError(null);
    try {
      const res = await api.providers.saveCurrentAntigravityAccount({
        label: currentLabelInput.trim() || undefined,
      });
      const json = await res.json();
      const data = json.data || json;
      if (res.ok && (data.ok || data.account)) {
        await fetchAccounts();
        onRefreshAuth?.();
        setIsModalOpen(false);
        resetOAuthState();
        setSuccessMsg(`已保存当前生效账号：${data.account?.email || ''}`);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setCurrentError(data.error || '保存失败，未检测到当前有效的 CLI 登录凭据');
      }
    } catch (err: any) {
      setCurrentError(err?.message || '请求失败');
    } finally {
      setCurrentSaving(false);
    }
  };

  // Import Token JSON
  const handleImportToken = async () => {
    if (!tokenJsonInput.trim()) {
      setTokenImportError('请粘贴 Token JSON 内容');
      return;
    }
    setTokenImporting(true);
    setTokenImportError(null);
    try {
      let parsedToken: any;
      try {
        parsedToken = JSON.parse(tokenJsonInput.trim());
      } catch {
        throw new Error('Token 必须是合法的 JSON 格式');
      }

      const res = await api.providers.addAntigravityAccount({
        label: tokenLabelInput.trim() || undefined,
        tokenData: parsedToken,
      });
      const json = await res.json();
      const data = json.data || json;
      if (res.ok && (data.ok || data.account)) {
        await fetchAccounts();
        onRefreshAuth?.();
        setIsModalOpen(false);
        resetOAuthState();
        setSuccessMsg(`已成功导入账号：${data.account?.email || 'Google 账号'}`);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setTokenImportError(data.error || '导入账号失败，请检查 Token 格式');
      }
    } catch (err: any) {
      setTokenImportError(err?.message || '导入 Token 请求失败');
    } finally {
      setTokenImporting(false);
    }
  };

  // Extract detected code from user input
  let extractedCode = '';
  if (oauthCodeInput.trim()) {
    const raw = oauthCodeInput.trim();
    if (/[?&#]code=/i.test(raw)) {
      const match = raw.match(/[?&#]code=([^&#]+)/i);
      if (match) extractedCode = decodeURIComponent(match[1]);
    } else if (raw.startsWith('4/') || raw.length > 20) {
      extractedCode = raw;
    }
  }

  const activeAccount = accounts.find((a) => a.email === activeEmail) || accounts[0] || null;

  return (
    <div className="space-y-4 text-xs max-w-2xl mx-auto pt-2 pb-8 px-1 sm:px-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 shadow-xs">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">Google 账号管理</h3>
            <p className="text-[11px] text-muted-foreground">多账号无缝热插拔、凭据管理与一键切换</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {onNavigateToProxy && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateToProxy}
              className="h-7 px-2.5 text-xs gap-1 rounded-lg border-border/70 hover:bg-muted"
            >
              <Globe className="h-3 w-3 text-muted-foreground" />
              <span>代理设置</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void fetchAccounts();
              onRefreshAuth?.();
            }}
            disabled={isLoading}
            className="h-7 px-2.5 text-xs gap-1 rounded-lg border-border/70 hover:bg-muted"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              resetOAuthState();
              setActiveTab('oauth');
              setIsModalOpen(true);
            }}
            className="h-7 px-2.5 text-xs gap-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs active:scale-95 transition-all"
          >
            <Plus className="h-3 w-3" />
            <span>添加账号</span>
          </Button>
        </div>
      </div>

      {/* Alert Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium">{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium">{errorMsg}</span>
        </div>
      )}

      {/* 1. Active Account Hero Card */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <GoogleAccountAvatar
              email={activeAccount?.email}
              name={activeAccount?.name}
              picture={activeAccount?.picture}
              isPrimary={activeAccount?.isPrimary}
              isPro={activeAccount?.isPro !== false}
              tierType={activeAccount?.tierType || 'pro'}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-foreground truncate">
                  {activeAccount ? (activeAccount.label || activeAccount.name || activeAccount.email.split('@')[0]) : '未绑定 Google 账号'}
                </span>
                {activeAccount?.isPro !== false && (
                  <span
                    className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[8.5px] font-extrabold text-white shadow-xs select-none"
                    style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)' }}
                  >
                    Google AI Pro
                  </span>
                )}
                {activeAccount?.isPrimary && (
                  <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[8.5px] font-semibold text-amber-700 dark:text-amber-300">
                    默认主账号
                  </span>
                )}
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 text-[8.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                  ● 当前生效中
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground font-medium truncate mt-0.5">
                {activeAccount?.email || '暂无生效账号，请点击右上角「添加账号」完成授权'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {authStatus.authenticated ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                ● 已连接云端
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                ○ 未连接
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Active Account Live Quota Card */}
      {(() => {
        const displaySnap = liveQuota || activeAccount?.quotaSnapshot;
        const g5h = displaySnap?.gemini5h;
        const gWk = displaySnap?.geminiWeekly;
        const c5h = displaySnap?.claude5h;
        const cWk = displaySnap?.claudeWeekly;
        const g5hPct = g5h?.percent ?? 100;
        const gWkPct = gWk?.percent ?? 100;
        const c5hPct = c5h?.percent ?? 100;
        const cWkPct = cWk?.percent ?? 100;
        return (
          <div className="rounded-2xl border border-border/70 bg-card/60 p-3.5 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-xs font-semibold text-foreground">实时配额概览</span>
                {displaySnap?.accountEmail && (
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {displaySnap.accountEmail}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshQuota()}
                disabled={isRefreshingQuota}
                className="h-7 px-2.5 text-[11px] shrink-0 gap-1 rounded-lg border-border/70 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshingQuota ? 'animate-spin' : ''}`} />
                <span>拉取配额</span>
              </Button>
            </div>

            {!displaySnap ? (
              <div className="py-2 text-center text-[11px] text-muted-foreground">
                点击右上角「拉取配额」实时查询当前账号 5h 与周额度
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span>Gemini 官方模型</span>
                    <span>{g5hPct >= 50 ? '状态充沛' : g5hPct >= 20 ? '额度偏紧' : '额度告急'}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">5小时滚动额度</span>
                      <span className="font-mono font-bold">{g5hPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${g5hPct <= 15 ? 'bg-rose-500' : g5hPct <= 35 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(2, Math.min(100, g5hPct))}%` }} />
                    </div>
                    {g5h?.resetsIn && <div className="text-[9.5px] text-muted-foreground">重置倒计时：{g5h.resetsIn}</div>}
                  </div>
                  <div className="space-y-1 pt-1 border-t border-border/30">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">每周总额度</span>
                      <span className="font-mono font-bold">{gWkPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${gWkPct <= 15 ? 'bg-rose-500' : gWkPct <= 35 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.max(2, Math.min(100, gWkPct))}%` }} />
                    </div>
                    {gWk?.resetsIn && <div className="text-[9.5px] text-muted-foreground">每周重置：{gWk.resetsIn}</div>}
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[10.5px] font-semibold text-purple-600 dark:text-purple-400">
                    <span>Claude & GPT 官方模型</span>
                    <span>{c5hPct >= 50 ? '状态充沛' : c5hPct >= 20 ? '额度偏紧' : '额度告急'}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">5小时滚动额度</span>
                      <span className="font-mono font-bold">{c5hPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${c5hPct <= 15 ? 'bg-rose-500' : c5hPct <= 35 ? 'bg-amber-500' : 'bg-purple-500'}`} style={{ width: `${Math.max(2, Math.min(100, c5hPct))}%` }} />
                    </div>
                    {c5h?.resetsIn && <div className="text-[9.5px] text-muted-foreground">重置倒计时：{c5h.resetsIn}</div>}
                  </div>
                  <div className="space-y-1 pt-1 border-t border-border/30">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">每周总额度</span>
                      <span className="font-mono font-bold">{cWkPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${cWkPct <= 15 ? 'bg-rose-500' : cWkPct <= 35 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(2, Math.min(100, cWkPct))}%` }} />
                    </div>
                    {cWk?.resetsIn && <div className="text-[9.5px] text-muted-foreground">每周重置：{cWk.resetsIn}</div>}
                  </div>
                </div>
              </div>
            )}

            {displaySnap && (
              <div className="pt-2.5 border-t border-border/40 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-foreground">
                    可累积重置卡 (Banked Resets)
                  </span>
                  {(() => {
                    const cards = displaySnap.bankedResets || [];
                    const totalCount = cards.reduce((sum, item) => sum + (item.remainingCount || 0), 0);
                    return cards.length > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        可用 {totalCount} 张
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">暂无可用重置卡</span>
                    );
                  })()}
                </div>

                {displaySnap.bankedResets && displaySnap.bankedResets.length > 0 ? (
                  <div className="space-y-1.5">
                    {displaySnap.bankedResets.map((card) => {
                      const isClaimingThis = claimingResetId === card.resetId;
                      return (
                        <div
                          key={card.resetId}
                          className="flex items-center justify-between gap-2.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-semibold text-foreground truncate">
                                {card.displayLabel}
                              </span>
                              <span className="inline-flex items-center rounded-md bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.2 text-[9.5px] font-mono font-semibold text-blue-600 dark:text-blue-300">
                                x{card.remainingCount}
                              </span>
                              {card.expiresIn && (
                                <span className="text-[9.5px] text-muted-foreground">
                                  {card.expiresIn}
                                </span>
                              )}
                            </div>
                            {card.bucketIds && card.bucketIds.length > 0 && (
                              <div className="text-[9.5px] text-muted-foreground truncate font-mono">
                                适用池: {card.bucketIds.join(', ')}
                              </div>
                            )}
                            {!card.claimable && card.ineligibleReasonText && (
                              <div className="text-[9.5px] text-amber-600 dark:text-amber-400">
                                {card.ineligibleReasonText}
                              </div>
                            )}
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!card.claimable || Boolean(claimingResetId)}
                            onClick={() => void handleClaimBankedReset(card, displaySnap.accountEmail || activeAccount?.email)}
                            className={`h-7 px-2.5 text-[10.5px] shrink-0 gap-1 rounded-lg ${
                              card.claimable
                                ? 'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                                : 'border-border/50 text-muted-foreground opacity-60'
                            }`}
                          >
                            {isClaimingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            <span>{isClaimingThis ? '使用中...' : card.claimable ? '立即使用' : '暂不可用'}</span>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-3 py-2 text-[10.5px] text-muted-foreground">
                    当前账号暂未获发可累积重置卡；官方发放后将自动在此显示并支持一键激活重置。
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 3. Saved Accounts List */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-border/40 pb-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-foreground">已保存 Google 账号</span>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.2 text-[10px] font-medium text-muted-foreground">
              共 {accounts.length} 个
            </span>
          </div>
          <span className="text-muted-foreground text-[10.5px]">点击一键秒级切换生效</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" />
            <span className="text-xs font-medium">正在加载账号列表...</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            尚未添加任何账号，点击右上角「添加账号」以绑定
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {accounts.map((acc) => {
              const isActive = acc.email === (activeEmail || activeAccount?.email);
              const isSwitching = switchingEmail === acc.email;
              const isDeleting = deletingEmail === acc.email;
              const isEditing = editingEmail === acc.email;

              return (
                <div
                  key={acc.email}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/10 shadow-xs'
                      : 'border-border/60 bg-card/80 hover:border-border/80 hover:bg-muted/30'
                  }`}
                >
                  {/* Left: Avatar & Info */}
                  <div className="flex min-w-0 items-center gap-3 flex-1">
                    <GoogleAccountAvatar
                      email={acc.email}
                      name={acc.name}
                      picture={acc.picture}
                      isPrimary={acc.isPrimary}
                      isPro={acc.isPro !== false}
                      tierType={acc.tierType || 'pro'}
                      size="sm"
                    />

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input
                            type="text"
                            value={editingLabelValue}
                            onChange={(e) => setEditingLabelValue(e.target.value)}
                            placeholder="输入备注名称"
                            className="h-6.5 w-36 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus:border-emerald-500 focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveLabel(acc.email);
                              if (e.key === 'Escape') setEditingEmail(null);
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={() => void handleSaveLabel(acc.email)}
                            disabled={isSavingLabel}
                            className="h-6.5 px-2 text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg"
                          >
                            保存
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingEmail(null)}
                            className="h-6.5 px-2 text-[11px] rounded-lg"
                          >
                            取消
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {acc.label || acc.name || acc.email.split('@')[0]}
                          </span>
                          {acc.isPro !== false && (
                            <span
                              className="inline-flex items-center rounded-full px-1.5 py-0.2 text-[8px] font-extrabold text-white shadow-xs select-none"
                              style={{ background: 'linear-gradient(135deg, #f59e0b, #8b5cf6)' }}
                            >
                              AI Pro
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setEditingEmail(acc.email);
                              setEditingLabelValue(acc.label || acc.name || '');
                            }}
                            className="text-muted-foreground/50 hover:text-foreground p-0.5 rounded transition-colors"
                            title="修改备注名"
                          >
                            <Edit2 className="h-2.5 w-2.5" />
                          </button>
                          {acc.isPrimary && (
                            <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[8.5px] font-semibold text-amber-700 dark:text-amber-300">
                              默认主号
                            </span>
                          )}
                        </div>
                      )}
                      <div className="truncate text-[11px] text-muted-foreground font-mono mt-0.5">
                        {acc.email}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                    {isActive ? (
                      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shadow-xs">
                        <Check className="h-3 w-3 text-emerald-500" />
                        <span>当前使用中</span>
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSwitchAccount(acc.email)}
                        disabled={isSwitching || Boolean(switchingEmail)}
                        className="h-7 px-2.5 text-xs font-medium gap-1 rounded-lg border-border/70 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300 transition-all active:scale-95"
                      >
                        {isSwitching ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
                            <span>切换中...</span>
                          </>
                        ) : (
                          <>
                            <ArrowRightLeft className="h-3 w-3" />
                            <span>一键切换</span>
                          </>
                        )}
                      </Button>
                    )}

                    {acc.isPrimary ? (
                      <span
                        className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] text-muted-foreground/50 select-none"
                        title="默认主账号不可删除，保障系统基础登录态"
                      >
                        <Lock className="h-3 w-3" />
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAccount(acc.email)}
                        disabled={isDeleting || Boolean(deletingEmail)}
                        className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="删除账号"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3 w-3 animate-spin text-destructive" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Account Modal (Compact & Intuitive) */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[9500] flex items-center justify-center bg-slate-900/35 p-3 backdrop-blur-sm dark:bg-black/60"
          onClick={(event) => {
            if (event.target === event.currentTarget && oauthStep !== 'verifying') {
              resetOAuthState();
              setIsModalOpen(false);
            }
          }}
        >
          <div className="popover-enter flex w-full max-w-md flex-col space-y-4 rounded-2xl border border-slate-200/80 bg-card/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/[0.09]">
            {/* Modal Title */}
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 shadow-xs">
                  <Plus className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">添加 Google 账号</h3>
              </div>
              <button
                onClick={() => {
                  resetOAuthState();
                  setIsModalOpen(false);
                }}
                className="rounded-lg p-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Compact Tabs */}
            <div className="mt-3 flex rounded-lg bg-muted p-0.5 text-xs">
              <button
                type="button"
                className={`flex-1 rounded-md py-1 font-medium transition-all ${
                  activeTab === 'oauth'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('oauth')}
              >
                网页 OAuth 授权
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-1 font-medium transition-all ${
                  activeTab === 'current'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('current')}
              >
                保存当前 CLI 账号
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-1 font-medium transition-all ${
                  activeTab === 'token'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('token')}
              >
                Token JSON
              </button>
            </div>

            {/* Tab Content */}
            <div className="mt-3 space-y-3">
              {/* 1. Web OAuth Tab */}
              {activeTab === 'oauth' && (
                <div className="space-y-3">
                  {oauthStep === 'generating' && (
                    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                      <Loader2 className="mb-2 h-5 w-5 animate-spin text-emerald-600" />
                      <span className="text-xs">正在向 Google 发起 OAuth 授权链接...</span>
                    </div>
                  )}

                  {oauthStep === 'idle' && (
                    <div className="p-3 text-center rounded-lg border border-border bg-muted/20">
                      <p className="text-xs text-muted-foreground mb-2">
                        点击下方按钮生成官方 Google 授权链接
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        size="sm"
                        className="h-7 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        生成授权链接
                      </Button>
                    </div>
                  )}

                  {(oauthStep === 'waiting_code' || oauthStep === 'verifying') && oauthUrl && (
                    <div className="space-y-2.5">
                      {/* Step 1 */}
                      <div>
                        <label className="mb-1 block font-medium text-foreground text-[11px]">
                          步骤 1：打开下方授权链接，使用 Google 账号完成授权
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            readOnly
                            value={oauthUrl}
                            className="flex-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground font-mono"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <a
                            href={oauthUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            <span>打开</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopyOAuthUrl}
                            className="h-auto px-2 py-1 text-xs gap-1"
                          >
                            {copiedUrl ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            <span>{copiedUrl ? '已复制' : '复制'}</span>
                          </Button>
                        </div>
                      </div>

                      {/* Step 2 */}
                      <div>
                        <label className="mb-1 block font-medium text-foreground text-[11px]">
                          步骤 2：授权后将浏览器跳转的完整网址或 <code>code=</code> 粘贴到下方：
                        </label>
                        <textarea
                          rows={2}
                          value={oauthCodeInput}
                          onChange={(e) => setOauthCodeInput(e.target.value)}
                          placeholder="粘贴跳转后的完整 URL 或 code 参数..."
                          className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none"
                          disabled={oauthStep === 'verifying'}
                        />
                        {extractedCode && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <Check className="h-3 w-3" />
                            <span className="truncate">
                              已识别 Code: {extractedCode.slice(0, 16)}...
                            </span>
                          </div>
                        )}
                      </div>

                      {oauthFeedback && (
                        <div
                          className={`rounded-md p-2 text-xs font-medium ${
                            oauthFeedback.includes('成功')
                              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                          }`}
                        >
                          {oauthFeedback}
                        </div>
                      )}

                      <Button
                        onClick={handleCompleteOAuth}
                        disabled={oauthStep === 'verifying' || !oauthCodeInput.trim()}
                        className="w-full justify-center h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                      >
                        {oauthStep === 'verifying' ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>正在完成令牌验证与账号激活...</span>
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>提交并完成验证</span>
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {oauthStep === 'success' && (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      <p className="mt-2 text-xs font-semibold text-foreground">{oauthFeedback}</p>
                    </div>
                  )}
                </div>
              )}

              {/* 2. Save Current CLI Token Tab */}
              {activeTab === 'current' && (
                <div className="space-y-2.5">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    若您已在宿主机终端执行过 <code>agy login</code> 或当前已有生效凭据，可直接将其保存为一个独立账号。
                  </p>
                  <div>
                    <label className="mb-1 block font-medium text-foreground text-[11px]">
                      账号备注名称（可选）
                    </label>
                    <input
                      type="text"
                      value={currentLabelInput}
                      onChange={(e) => setCurrentLabelInput(e.target.value)}
                      placeholder="例如：主力工作号 / 个人测试号"
                      className="h-7 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none"
                      disabled={currentSaving}
                    />
                  </div>

                  {currentError && (
                    <div className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                      {currentError}
                    </div>
                  )}

                  <Button
                    onClick={handleSaveCurrentCli}
                    disabled={currentSaving}
                    className="w-full justify-center h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  >
                    {currentSaving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>正在保存当前凭据...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>保存当前已生效账号</span>
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* 3. JSON Import Tab */}
              {activeTab === 'token' && (
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1 block font-medium text-foreground text-[11px]">
                      账号备注名称（可选）
                    </label>
                    <input
                      type="text"
                      value={tokenLabelInput}
                      onChange={(e) => setTokenLabelInput(e.target.value)}
                      placeholder="例如：外部备份账号"
                      className="h-7 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none"
                      disabled={tokenImporting}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block font-medium text-foreground text-[11px]">
                      antigravity-oauth-token JSON 内容
                    </label>
                    <textarea
                      rows={4}
                      value={tokenJsonInput}
                      onChange={(e) => setTokenJsonInput(e.target.value)}
                      placeholder='{ "token": { "access_token": "...", "refresh_token": "..." }, "id_token": "..." }'
                      className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none"
                      disabled={tokenImporting}
                    />
                  </div>

                  {tokenImportError && (
                    <div className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                      {tokenImportError}
                    </div>
                  )}

                  <Button
                    onClick={handleImportToken}
                    disabled={tokenImporting || !tokenJsonInput.trim()}
                    className="w-full justify-center h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  >
                    {tokenImporting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>正在解析并导入...</span>
                      </>
                    ) : (
                      <>
                        <Key className="h-3.5 w-3.5" />
                        <span>立即导入账号</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="mt-3.5 flex justify-end border-t border-border/70 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetOAuthState();
                  setIsModalOpen(false);
                }}
                className="h-7 px-2.5 text-xs"
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
