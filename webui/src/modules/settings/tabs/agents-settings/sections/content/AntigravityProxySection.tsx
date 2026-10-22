import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Globe,
  Zap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  RotateCw,
  Loader2,
  Shield,
  Users,
  UserCheck,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sliders,
} from 'lucide-react';

import { api, readApiJson } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';
import type { AntigravityAccount, AntigravityQuotaSnapshot } from '@/shared/types';
import { formatDynamicCountdown } from '@/modules/chat/hooks/useAntigravityQuota';
import { AntigravityUrnBalanceCard } from '@/modules/settings/tabs/agents-settings/sections/content/AntigravityUrnBalanceCard';

type AntigravityProxySectionProps = {
  onNavigateToAccounts?: () => void;
};

type BringYourLocation = {
  name: string;
  code: string;
  zh: string;
  flag: string;
  count: number;
  stable: boolean;
  privacy: boolean;
};

type TestResult = {
  success: boolean;
  latencyMs: number;
  mode: 'yes' | 'no';
  message: string;
  httpCode?: number;
};

type ProxyStatusData = {
  enabled: boolean;
  mode: 'yes' | 'no';
  socksPort: number;
  socksListening: boolean;
  country: string;
  region: string;
  city: string;
  stable: boolean;
  privacy: boolean;
  quantum: boolean;
  activeProviderCount: number | null;
  activeCountry: string;
  scaleToZero?: boolean;
  idleState?: 'active' | 'idle' | 'sleeping';
  idleSecondsRemaining?: number;
  activeTurns?: number;
};

const DEFAULT_LOCATIONS: BringYourLocation[] = [
  { name: 'United States', code: 'us', zh: '美国', flag: '🇺🇸', count: 36948, stable: true, privacy: false },
  { name: 'Germany', code: 'de', zh: '德国', flag: '🇩🇪', count: 11537, stable: true, privacy: true },
  { name: 'Canada', code: 'ca', zh: '加拿大', flag: '🇨🇦', count: 3265, stable: true, privacy: true },
  { name: 'Vietnam', code: 'vn', zh: '越南', flag: '🇻🇳', count: 2890, stable: true, privacy: false },
  { name: 'United Kingdom', code: 'gb', zh: '英国', flag: '🇬🇧', count: 2410, stable: true, privacy: true },
  { name: 'Netherlands', code: 'nl', zh: '荷兰', flag: '🇳🇱', count: 1980, stable: true, privacy: true },
  { name: 'France', code: 'fr', zh: '法国', flag: '🇫🇷', count: 1820, stable: true, privacy: true },
  { name: 'Australia', code: 'au', zh: '澳大利亚', flag: '🇦🇺', count: 1650, stable: true, privacy: false },
  { name: 'Singapore', code: 'sg', zh: '新加坡', flag: '🇸🇬', count: 1420, stable: true, privacy: true },
  { name: 'Japan', code: 'jp', zh: '日本', flag: '🇯🇵', count: 1380, stable: true, privacy: true },
  { name: 'Hong Kong', code: 'hk', zh: '中国香港', flag: '🇭🇰', count: 1250, stable: true, privacy: true },
];

export default function AntigravityProxySection({ onNavigateToAccounts }: AntigravityProxySectionProps) {
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [userAuth, setUserAuth] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [country, setCountry] = useState('United States');
  const [customCountry, setCustomCountry] = useState('');
  const [isCustomCountry, setIsCustomCountry] = useState(false);
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [providerId, setProviderId] = useState('');
  const [stable, setStable] = useState(false);
  const [privacy, setPrivacy] = useState(true);
  const [quantum, setQuantum] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Accounts state
  const [accounts, setAccounts] = useState<AntigravityAccount[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [quotaSnapshot, setQuotaSnapshot] = useState<AntigravityQuotaSnapshot | null>(null);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);

  const [locations, setLocations] = useState<BringYourLocation[]>(DEFAULT_LOCATIONS);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusData | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Tracks pending manual sleep/wake requests for the Scale-to-Zero proxy mechanism
  const [isSleepingProxy, setIsSleepingProxy] = useState(false);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAllSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch system & proxy settings
      try {
        const sRes = await api.providers.getAntigravityProxySettings();
        if (sRes.ok) {
          const sData = await readApiJson<any>(sRes);
          const p = sData?.data?.proxy || sData?.proxy;
          if (p) {
            setProxyEnabled(p.enabled !== false && p.mode !== 'no');
            setUserAuth(p.userAuth || '');
            setHasPassword(Boolean(p.hasPassword));
            const currentCountry = p.country || 'United States';
            setCountry(currentCountry);
            setRegion(p.region || '');
            setCity(p.city || '');
            setProviderId(p.providerId || '');
            if (p.region || p.city || p.providerId) {
              setShowAdvanced(true);
            }
            setStable(Boolean(p.stable));
            setPrivacy(p.privacy !== false);
            setQuantum(p.quantum !== false);
          }
        }
      } catch (_) {}

      // 2. Fetch proxy status
      try {
        const stRes = await api.providers.getAntigravityProxyStatus();
        if (stRes.ok) {
          const stData = await readApiJson<any>(stRes);
          const data = stData?.data || stData;
          if (data && typeof data === 'object') {
            setProxyStatus(data);
          }
        }
      } catch (_) {}

      // 3. Fetch BringYour locations
      try {
        const locRes = await api.providers.getAntigravityProxyLocations();
        if (locRes.ok) {
          const locData = await readApiJson<any>(locRes);
          const locs = locData?.data?.locations || locData?.locations;
          if (Array.isArray(locs) && locs.length > 0) {
            setLocations(locs);
          }
        }
      } catch (_) {}

      // 4. Fetch Google accounts
      let fetchedActiveEmail: string | null = null;
      try {
        const accRes = await api.providers.antigravityAccounts();
        if (accRes.ok) {
          const accData = await readApiJson<any>(accRes);
          const parsed = accData?.data || accData;
          if (Array.isArray(parsed?.accounts)) {
            setAccounts(parsed.accounts);
            fetchedActiveEmail = parsed.activeEmail || parsed.accounts[0]?.email || null;
            setActiveEmail(fetchedActiveEmail);
          }
        }
      } catch (_) {}

      // 5. Fetch live quota
      try {
        const emailToFetch = fetchedActiveEmail || undefined;
        const qRes = await api.providers.antigravityQuota(false, emailToFetch);
        if (qRes.ok) {
          const qData = await readApiJson<any>(qRes);
          const snap = qData?.data || qData;
          if (snap && typeof snap === 'object' && snap.gemini5h) {
            setQuotaSnapshot(snap);
          }
        }
      } catch (_) {}
    } catch (e: any) {
      // Graceful error handling - do not crash
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllSettings();
  }, [loadAllSettings]);

  // Handle switching Google account
  const handleSwitchAccount = async (email: string) => {
    if (email === activeEmail) return;
    setIsSwitchingAccount(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.providers.switchAntigravityAccount(email);
      if (res.ok) {
        const data = await readApiJson<any>(res);
        if (data?.data?.ok || data?.ok) {
          setActiveEmail(email);
          const matchedAcc = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
          if (matchedAcc?.quotaSnapshot) {
            setQuotaSnapshot(matchedAcc.quotaSnapshot);
          }
          setSuccessMsg(`已切换至账号：${email}`);
          setTimeout(() => setSuccessMsg(null), 3000);
          void handleRefreshLiveQuota(email);
        } else {
          setErrorMsg(data?.data?.error || data?.error || '切换账号失败');
        }
      }
    } catch (err: any) {
      setErrorMsg('切换账号失败: ' + (err?.message || '网络异常'));
    } finally {
      setIsSwitchingAccount(false);
    }
  };

  // Handle refreshing live quota directly from upstream Google
  const handleRefreshLiveQuota = async (targetEmail?: string) => {
    setIsRefreshingQuota(true);
    setErrorMsg(null);
    try {
      const emailToFetch = targetEmail || activeEmail || undefined;
      const res = await api.providers.antigravityQuota(true, emailToFetch);
      if (res.ok) {
        const data = await readApiJson<any>(res);
        const snap = data?.data || data;
        if (snap && typeof snap === 'object' && snap.gemini5h) {
          setQuotaSnapshot(snap);
          setSuccessMsg('已从 Google 上游拉取最新真实额度！');
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
    } catch (err: any) {
      setErrorMsg('拉取配额失败: ' + (err?.message || '请求超时'));
    } finally {
      setIsRefreshingQuota(false);
    }
  };

  const handleCountryChange = (val: string) => {
    if (val === '__custom__') {
      setIsCustomCountry(true);
      if (!customCountry) setCustomCountry(country);
    } else {
      setIsCustomCountry(false);
      setCountry(val);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const finalCountry = isCustomCountry ? customCountry.trim() : country;
    const payload = {
      proxy: {
        enabled: proxyEnabled,
        mode: proxyEnabled ? 'yes' : 'no',
        userAuth: userAuth.trim(),
        password: password ? password : undefined,
        country: finalCountry || 'United States',
        region: region.trim(),
        city: city.trim(),
        providerId: providerId.trim(),
        stable,
        privacy,
        quantum,
      },
    };

    try {
      const res = await api.providers.saveAntigravityProxySettings(payload);
      if (res.ok) {
        const d = await readApiJson<any>(res);
        setSuccessMsg('✓ ' + (d?.data?.message || d?.message || '代理配置已保存成功！'));
        if (password) {
          setHasPassword(true);
          setPassword('');
        }
        setTimeout(() => setSuccessMsg(null), 4000);
        void loadAllSettings();
      } else {
        const d = await readApiJson<any>(res);
        setErrorMsg('保存失败: ' + (d?.data?.error || d?.error || '未知错误'));
      }
    } catch (e: any) {
      setErrorMsg('保存代理设置异常: ' + (e?.message || '网络异常'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestartProxy = async () => {
    setIsRestarting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.providers.restartAntigravityProxy();
      if (res.ok) {
        const d = await readApiJson<any>(res);
        setSuccessMsg('✓ ' + (d?.data?.message || d?.message || '代理已重启，守护程序将在3秒内重新连接。'));
        setTimeout(() => setSuccessMsg(null), 4000);
        setTimeout(() => void loadAllSettings(), 2500);
      } else {
        const d = await readApiJson<any>(res);
        setErrorMsg('重启失败: ' + (d?.data?.error || d?.error || '无法重启代理'));
      }
    } catch (e: any) {
      setErrorMsg('重启请求异常: ' + (e?.message || '网络中断'));
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRotateNode = async () => {
    setIsRotating(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.providers.restartAntigravityProxy();
      if (res.ok) {
        setSuccessMsg('✓ 已自动切换并优选新节点连接！');
        setTimeout(() => setSuccessMsg(null), 4000);
        setTimeout(() => void loadAllSettings(), 2500);
      } else {
        const d = await readApiJson<any>(res);
        setErrorMsg('切换节点失败: ' + (d?.data?.error || d?.error || '未知错误'));
      }
    } catch (e: any) {
      setErrorMsg('换节点异常: ' + (e?.message || '网络异常'));
    } finally {
      setIsRotating(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.providers.testAntigravityProxy(proxyEnabled ? 'yes' : 'no');
      if (res.ok) {
        const d = await readApiJson<any>(res);
        setTestResult(d?.data || d);
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        mode: proxyEnabled ? 'yes' : 'no',
        message: '连通性测试请求失败: ' + (e?.message || '网络中断'),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSleepProxy = async () => {
    setIsSleepingProxy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.providers.sleepAntigravityProxy();
      if (res.ok) {
        const d = await readApiJson<any>(res);
        setSuccessMsg('✓ ' + (d?.data?.message || d?.message || '代理已进入空闲休眠（已断开住宅链路，0流量消耗）'));
        setTimeout(() => setSuccessMsg(null), 4000);
        setTimeout(() => void loadAllSettings(), 800);
      } else {
        const d = await readApiJson<any>(res);
        setErrorMsg('休眠失败: ' + (d?.data?.error || d?.error || '无法执行休眠'));
      }
    } catch (e: any) {
      setErrorMsg('休眠异常: ' + (e?.message || '网络中断'));
    } finally {
      setIsSleepingProxy(false);
    }
  };

  const handleWakeProxy = async () => {
    setIsSleepingProxy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.providers.wakeAntigravityProxy();
      if (res.ok) {
        const d = await readApiJson<any>(res);
        setSuccessMsg('✓ ' + (d?.data?.message || d?.message || '代理已按需唤醒就绪！'));
        setTimeout(() => setSuccessMsg(null), 4000);
        setTimeout(() => void loadAllSettings(), 1200);
      } else {
        const d = await readApiJson<any>(res);
        setErrorMsg('唤醒失败: ' + (d?.data?.error || d?.error || '无法唤醒代理'));
      }
    } catch (e: any) {
      setErrorMsg('唤醒异常: ' + (e?.message || '网络中断'));
    } finally {
      setIsSleepingProxy(false);
    }
  };

  const activeAccount = accounts.find((a) => a.email.toLowerCase() === (activeEmail || '').toLowerCase()) || accounts[0];

  return (
    <div className="space-y-4 text-xs max-w-2xl mx-auto pt-2 pb-8 px-1 sm:px-2">
      {/* Navigation Header between Accounts and Proxy */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 shadow-xs">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">Google Antigravity 系统设置</h3>
            <p className="text-[11px] text-muted-foreground">管理 Google 账号凭据与 BringYour SOCKS5 代理网络</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {onNavigateToAccounts && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateToAccounts}
              className="h-7 px-2.5 text-xs gap-1 rounded-lg border-border/70 hover:bg-muted"
            >
              <Users className="h-3 w-3 text-muted-foreground" />
              <span>账号列表</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadAllSettings()}
            disabled={isLoading}
            className="h-7 px-2.5 text-xs gap-1 rounded-lg border-border/70 hover:bg-muted"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
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

      {/* 1. Google Active Account & Quota Card (解决账号也没显示) */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-3.5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-xs">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-foreground truncate">当前绑定的 Google 账号</span>
                {activeAccount?.tier && (
                  <span className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 shadow-xs shrink-0">
                    {activeAccount.tier}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground font-medium truncate mt-0.5">
                {activeAccount?.email || '未检测到绑定的 Google 账号'}
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshLiveQuota()}
            disabled={isRefreshingQuota}
            className="h-7 px-2.5 text-[11px] shrink-0 gap-1 rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted"
            title="直接从 Google PA API 拉取真实配额"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshingQuota ? 'animate-spin' : ''}`} />
            <span className="whitespace-nowrap">拉取配额</span>
          </Button>
        </div>

        {/* Multi-account Switcher Chips */}
        {accounts.length > 1 && (
          <div className="pt-2 border-t border-border/40 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-medium text-[10.5px]">快速切换账号：</span>
              <span className="text-[10px]">共 {accounts.length} 个账号</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {accounts.map((acc) => {
                const isSelected = acc.email.toLowerCase() === (activeEmail || '').toLowerCase();
                return (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => handleSwitchAccount(acc.email)}
                    disabled={isSwitchingAccount}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all font-mono font-medium active:scale-95 ${
                      isSelected
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/35 shadow-xs'
                        : 'bg-muted/40 hover:bg-muted text-muted-foreground border border-border/60'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
                    <span className="truncate max-w-[140px]">{acc.label || acc.name || acc.email.split('@')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quota Snapshots Mini Bar (纯实时模型配额直通) */}
        {(() => {
          const curAcc = accounts.find((a) => (a.email || '').toLowerCase() === (activeEmail || '').toLowerCase());
          const displaySnap =
            (quotaSnapshot?.accountEmail && activeEmail && quotaSnapshot.accountEmail.toLowerCase() === activeEmail.toLowerCase())
              ? quotaSnapshot
              : (curAcc?.quotaSnapshot || quotaSnapshot);
          if (!displaySnap) return null;
          const geminiPct = displaySnap.gemini5h?.percent ?? 100;
          const gRed = Math.min(100, Math.max(0, (geminiPct / 20) * 100));
          const gAmber = Math.min(100, Math.max(0, ((geminiPct - 20) / 30) * 100));
          const gGreen = Math.min(100, Math.max(0, ((geminiPct - 50) / 50) * 100));

          const claudePct = displaySnap.claude5h?.percent ?? 100;
          const cRed = Math.min(100, Math.max(0, (claudePct / 20) * 100));
          const cAmber = Math.min(100, Math.max(0, ((claudePct - 20) / 30) * 100));
          const cGreen = Math.min(100, Math.max(0, ((claudePct - 50) / 50) * 100));

          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
                <div className="text-muted-foreground text-[10px] flex items-center justify-between">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">Gemini 官方实时额度</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1 py-0.2 rounded text-[9px] font-semibold leading-none ${
                      geminiPct >= 50
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : geminiPct >= 20
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    }`}>
                      {geminiPct >= 50 ? '安全' : geminiPct >= 20 ? '注意' : '告急'}
                    </span>
                    <span className={`font-bold font-mono text-xs ${geminiPct < 100 ? 'text-emerald-500 font-semibold' : 'text-foreground'}`}>
                      {geminiPct}%
                    </span>
                  </div>
                </div>

                {/* 3色物理分段进度条：红段 20% / 黄段 30% / 绿段 50% */}
                <div
                  className="flex items-center gap-1 h-2 w-full shrink-0 p-0.5 rounded-full bg-muted/90 border border-border/60"
                  title={`3色分段刻度：红区(0%~20% 告急) / 黄区(20%~50% 警戒) / 绿区(50%~100% 充裕) · 当前剩余 ${geminiPct}%`}
                >
                  <div className="relative flex-[2] h-full rounded-full bg-rose-500/20 overflow-hidden" title="危险段(0%~20%)">
                    <div className="h-full bg-rose-500 transition-all duration-300 rounded-full" style={{ width: `${gRed}%` }} />
                  </div>
                  <div className="relative flex-[3] h-full rounded-full bg-amber-500/20 overflow-hidden" title="预警段(20%~50%)">
                    <div className="h-full bg-amber-400 transition-all duration-300 rounded-full" style={{ width: `${gAmber}%` }} />
                  </div>
                  <div className="relative flex-[5] h-full rounded-full bg-emerald-500/20 overflow-hidden" title="安全段(50%~100%)">
                    <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full" style={{ width: `${gGreen}%` }} />
                  </div>
                </div>

                <div className="text-[10.5px] font-mono text-muted-foreground/85 truncate flex items-center justify-between">
                  <span>下次重置倒计时:</span>
                  <span className="font-semibold text-foreground">{formatDynamicCountdown(displaySnap.gemini5h?.resetTime)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
                <div className="text-muted-foreground text-[10px] flex items-center justify-between">
                  <span className="font-semibold text-purple-600 dark:text-purple-400">Claude / GPT 官方实时额度</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1 py-0.2 rounded text-[9px] font-semibold leading-none ${
                      claudePct >= 50
                        ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                        : claudePct >= 20
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    }`}>
                      {claudePct >= 50 ? '安全' : claudePct >= 20 ? '注意' : '告急'}
                    </span>
                    <span className={`font-bold font-mono text-xs ${claudePct < 100 ? 'text-purple-500 font-semibold' : 'text-foreground'}`}>
                      {claudePct}%
                    </span>
                  </div>
                </div>

                {/* 3色物理分段进度条：红段 20% / 黄段 30% / 绿段 50% */}
                <div
                  className="flex items-center gap-1 h-2 w-full shrink-0 p-0.5 rounded-full bg-muted/90 border border-border/60"
                  title={`3色分段刻度：红区(0%~20% 告急) / 黄区(20%~50% 警戒) / 绿区(50%~100% 充裕) · 当前剩余 ${claudePct}%`}
                >
                  <div className="relative flex-[2] h-full rounded-full bg-rose-500/20 overflow-hidden" title="危险段(0%~20%)">
                    <div className="h-full bg-rose-500 transition-all duration-300 rounded-full" style={{ width: `${cRed}%` }} />
                  </div>
                  <div className="relative flex-[3] h-full rounded-full bg-amber-500/20 overflow-hidden" title="预警段(20%~50%)">
                    <div className="h-full bg-amber-400 transition-all duration-300 rounded-full" style={{ width: `${cAmber}%` }} />
                  </div>
                  <div className="relative flex-[5] h-full rounded-full bg-emerald-500/20 overflow-hidden" title="安全段(50%~100%)">
                    <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full" style={{ width: `${cGreen}%` }} />
                  </div>
                </div>

                <div className="text-[10.5px] font-mono text-muted-foreground/85 truncate flex items-center justify-between">
                  <span>下次重置倒计时:</span>
                  <span className="font-semibold text-foreground">{formatDynamicCountdown(displaySnap.claude5h?.resetTime)}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 2. SOCKS5 Proxy Master Switch & Status Card */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-xs space-y-4">
        {/* Toggle Switch */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground whitespace-nowrap">URnetwork SOCKS5 代理</span>
              <span className={`inline-flex items-center px-1.5 py-0.2 text-[9.5px] rounded-md font-medium ${
                proxyEnabled 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                  : 'bg-muted text-muted-foreground border border-border/50'
              }`}>
                {proxyEnabled ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-normal">
              通过 BringYour 全球边缘中继节点加速并保护 Google 云端通信
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-medium whitespace-nowrap ${proxyEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
              {proxyEnabled ? '开启代理' : '直连模式'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={proxyEnabled}
              onClick={() => setProxyEnabled(!proxyEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                proxyEnabled ? 'bg-emerald-500' : 'bg-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  proxyEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Status Indicator Banner */}
        <div className="rounded-xl border border-border/60 bg-muted/25 p-3 text-xs leading-relaxed space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  !proxyEnabled
                    ? 'bg-amber-500'
                    : proxyStatus?.socksListening
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="font-semibold text-foreground">
                {!proxyEnabled ? '⚡ 直连模式 (Direct Mode)' : '🌐 SOCKS5 代理已开启'}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              端口 19999
            </Badge>
          </div>

          <div className="text-[11.5px] text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>
              状态:{' '}
              {proxyStatus?.socksListening ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">✓ 正常监听中 (127.0.0.1:19999)</span>
              ) : (
                <span className="font-medium text-amber-600 dark:text-amber-400">待就绪（重启后守护循环自动拉起）</span>
              )}
            </span>
            <span>·</span>
            <span>
              当前出口: <b className="text-foreground font-mono">{proxyStatus?.activeCountry || country || 'United States'}</b>
            </span>
            {proxyStatus?.activeProviderCount != null && (
              <>
                <span>·</span>
                <span>活跃节点池: <b className="text-foreground font-mono">{proxyStatus.activeProviderCount.toLocaleString()}</b> 个</span>
              </>
            )}
          </div>

          {proxyEnabled && (
            <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-foreground">🌿 智能休眠 (Scale-to-Zero):</span>
                {(!proxyStatus?.socksListening || proxyStatus?.idleState === 'sleeping') ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    空闲休眠中（0流量/0心跳消耗，发起对话时自动唤醒）
                  </span>
                ) : proxyStatus?.idleState === 'active' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                    活跃工作中（对话结束60秒后自动休眠断开）
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    空闲倒计时中（将在 {proxyStatus?.idleSecondsRemaining || 60}秒后休眠断开）
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {(!proxyStatus?.socksListening || proxyStatus?.idleState === 'sleeping') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleWakeProxy()}
                    disabled={isSleepingProxy}
                    className="h-6 px-2 text-[10.5px] rounded-lg border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                    title="立即唤醒 SOCKS5 代理"
                  >
                    {isSleepingProxy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    <span>立即唤醒</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSleepProxy()}
                    disabled={isSleepingProxy}
                    className="h-6 px-2 text-[10.5px] rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted"
                    title="立即进入空闲休眠断开连接"
                  >
                    {isSleepingProxy ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>立即休眠省流</span>}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* BringYour Live Balance & Settlement Card */}
        <AntigravityUrnBalanceCard />

        {/* Proxy Form Settings */}
        <div className={`space-y-3.5 pt-1 transition-opacity ${proxyEnabled ? 'opacity-100' : 'opacity-60'}`}>
          {/* URN_USER_AUTH */}
          <div>
            <label className="block font-medium text-foreground text-xs mb-1">
              代理账号 (URN_USER_AUTH)
            </label>
            <input
              type="text"
              value={userAuth}
              onChange={(e) => setUserAuth(e.target.value)}
              placeholder="如 123456@qq.com"
              className="h-9 w-full rounded-xl border border-border/70 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* URN_PASSWORD */}
          <div>
            <label className="block font-medium text-foreground text-xs mb-1">
              代理密码 <span className="text-muted-foreground font-normal">(留空表示不修改)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? '已配置，留空保持不变' : '留空保持不变'}
              className="h-9 w-full rounded-xl border border-border/70 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Country Selection */}
          <div>
            <label className="block font-medium text-foreground text-xs mb-1">
              出口节点 — 国家 (COUNTRY)
            </label>
            <select
              value={isCustomCountry ? '__custom__' : country}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="h-9 w-full rounded-xl border border-border/70 bg-background px-3 text-xs text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              {locations.map((loc) => (
                <option key={loc.code} value={loc.name}>
                  {loc.flag} {loc.zh} ({loc.name}) — {loc.count.toLocaleString()} 个可用节点
                </option>
              ))}
              <option value="__custom__">🌐 自定义国家代码 (手动输入)...</option>
            </select>

            {isCustomCountry && (
              <div className="mt-2">
                <input
                  type="text"
                  value={customCountry}
                  onChange={(e) => setCustomCountry(e.target.value)}
                  placeholder="如: Japan, Singapore 或国家二字代码 (us, jp, de)"
                  className="h-9 w-full rounded-xl border border-border/70 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            )}
          </div>

          {/* Advanced Location & Node Options */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2.5">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-xs font-semibold text-foreground hover:text-primary transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                <span>高级定位与节点配置</span>
                {(region || city || providerId) && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-primary/30 text-primary">
                    已自定义
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-normal">
                <span>{showAdvanced ? '收起' : '展开省份/城市/节点ID'}</span>
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </div>
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-2 border-t border-border/40 animate-in fade-in duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-medium text-foreground text-[11px] mb-1">
                      州 / 省份 (REGION) <span className="text-muted-foreground font-normal">(可选)</span>
                    </label>
                    <input
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="如: California, Texas, Tokyo"
                      className="h-8 w-full rounded-xl border border-border/70 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-foreground text-[11px] mb-1">
                      城市 (CITY) <span className="text-muted-foreground font-normal">(可选)</span>
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="如: Los Angeles, Frankfurt"
                      className="h-8 w-full rounded-xl border border-border/70 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-foreground text-[11px] mb-1">
                    指定节点提供商 (PROVIDER_ID) <span className="text-muted-foreground font-normal">(留空由 BringYour 自动负载均衡)</span>
                  </label>
                  <input
                    type="text"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    placeholder="留空为自动智能优选（推荐）"
                    className="h-8 w-full rounded-xl border border-border/70 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Feature Modes */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span>连接特性模式</span>
            </div>

            <div className="space-y-2.5 text-[11px]">
              {/* Stable Mode */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">固定 IP / 稳定连接</div>
                  <div className="text-muted-foreground text-[10px]">优先分配 IP 不频繁变动的节点，防频繁换 IP</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={stable}
                  onClick={() => setStable(!stable)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    stable ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${stable ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Privacy Mode */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">强匿名化</div>
                  <div className="text-muted-foreground text-[10px]">多跳混淆伪装链路，阻断真实出口 IP 关联</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacy}
                  onClick={() => setPrivacy(!privacy)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    privacy ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${privacy ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Quantum Safe */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground flex items-center gap-1">
                    <span>后量子加密</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-blue-500/30 text-blue-500">
                      ML-KEM-1024
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-[10px]">NIST 标准 Kyber 抗量子密码算法，抵御未来量子破译</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={quantum}
                  onClick={() => setQuantum(!quantum)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    quantum ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${quantum ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRotateNode}
                disabled={isRotating}
                className="h-8 px-2.5 text-xs gap-1 rounded-xl border-border/70 hover:bg-muted"
              >
                <RotateCw className={`h-3 w-3 ${isRotating ? 'animate-spin' : ''}`} />
                <span>自动换一个节点</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleRestartProxy}
                disabled={isRestarting}
                className="h-8 px-2.5 text-xs gap-1 rounded-xl border-border/70 hover:bg-muted"
              >
                <RefreshCw className={`h-3 w-3 ${isRestarting ? 'animate-spin' : ''}`} />
                <span>重启代理</span>
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="h-8 px-2.5 text-xs gap-1 rounded-xl border-border/70 hover:bg-muted"
              >
                <Zap className="h-3 w-3 text-amber-500" />
                <span>{isTesting ? '测速中...' : '测速'}</span>
              </Button>

              <Button
                size="sm"
                onClick={handleSaveSettings}
                disabled={isSaving}
                className="h-8 px-4 text-xs gap-1 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span>保存配置</span>
              </Button>
            </div>
          </div>

          {/* Test Result Display */}
          {testResult && (
            <div
              className={`rounded-xl border p-3 text-xs space-y-1 ${
                testResult.success
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              }`}
            >
              <div className="font-semibold flex items-center justify-between">
                <span>{testResult.success ? '✓ 连通性测试通过' : '✗ 连通性测试失败'}</span>
                {testResult.latencyMs > 0 && <span className="font-mono">{testResult.latencyMs}ms</span>}
              </div>
              <div className="text-[11px] opacity-90">{testResult.message}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
