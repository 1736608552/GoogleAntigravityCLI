import { useState, useEffect, useCallback } from 'react';
import {
  Coins,
  RefreshCw,
  Loader2,
  Clock,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Database,
  ArrowDownRight,
  TrendingDown,
} from 'lucide-react';

import { api, readApiJson } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';

export type UrnBalanceEpoch = {
  balanceId: string;
  startTime: string;
  endTime: string;
  remainingSeconds: number;
  remainingHuman: string;
  startBytes: number;
  startFormatted: string;
  currentBytes: number;
  currentFormatted: string;
  usedBytes: number;
  usedFormatted: string;
  isExpiringSoon: boolean;
};

export type UrnBalanceDetails = {
  ok: boolean;
  userAuth: string;
  totalBytes: number;
  totalFormatted: string;
  availableBytes: number;
  availableFormatted: string;
  openTransferBytes: number;
  openTransferFormatted: string;
  netConsumedBytes: number;
  netConsumedFormatted: string;
  percentAvailable: number;
  priceTier?: {
    name: string;
    monthlyUsd: number;
    yearlyUsd: number;
    currency: string;
  };
  activeWindows: UrnBalanceEpoch[];
  updateTime: string;
  cached?: boolean;
  error?: string;
};

/**
 * Used by AntigravityProxySection to display live BringYour subscription,
 * available balance, escrowed/open transfer quotas, and 24-hour settlement countdowns.
 */
export function AntigravityUrnBalanceCard({ className = '' }: { className?: string }) {
  const [balance, setBalance] = useState<UrnBalanceDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showEpochs, setShowEpochs] = useState(false);

  const loadBalance = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.providers.getAntigravityUrnBalance(forceRefresh);
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) {
        setErrorMsg('账单服务端接口生效中，请稍候点击重试');
        return;
      }
      let body: any;
      try {
        body = JSON.parse(text);
      } catch (_) {
        setErrorMsg('账单数据格式异常，请稍候重试');
        return;
      }
      if (res.ok) {
        const data: UrnBalanceDetails = body?.data || body;
        if (data && typeof data === 'object') {
          if (!data.ok && data.error) {
            setErrorMsg(data.error);
          } else {
            setBalance(data);
          }
        }
      } else {
        setErrorMsg(body?.error || `无法连接账单服务 (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '读取 BringYour 账单网络异常');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  return (
    <div className={`rounded-xl border border-border/70 bg-gradient-to-b from-card/80 to-muted/20 p-3.5 space-y-3 shadow-xs ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">BringYour 实时账单与结算</span>
              {balance?.priceTier && (
                <Badge variant="outline" className="text-[9.5px] px-1.5 py-0 h-4 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  {balance.priceTier.name.toUpperCase()} (${balance.priceTier.monthlyUsd}/月)
                </Badge>
              )}
            </div>
            <div className="text-[10.5px] text-muted-foreground flex items-center gap-1">
              <span>账号: {balance?.userAuth || '当前账号'}</span>
              {balance?.updateTime && (
                <>
                  <span>·</span>
                  <span>更新于 {new Date(balance.updateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadBalance(true)}
            disabled={isLoading}
            className="h-7 px-2.5 text-[11px] gap-1 rounded-lg border-border/70 hover:bg-muted"
            title="实时向 BringYour 官方拉取最新余额与对账状态"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-primary' : ''}`} />
            <span>{isLoading ? '读取中...' : '刷新账单'}</span>
          </Button>
        </div>
      </div>

      {/* Error state */}
      {errorMsg && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="font-medium">账单读取失败</div>
            <div className="text-[11px] opacity-90">{errorMsg}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadBalance(true)}
            className="h-6 px-2 text-[10px] shrink-0 border-destructive/40 hover:bg-destructive/15"
          >
            重试
          </Button>
        </div>
      )}

      {/* Metrics Grid */}
      {balance && balance.ok && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* 可用余额 */}
            <div className="rounded-lg border border-border/60 bg-background/80 p-2.5 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center justify-between">
                <span>可用余额</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  {balance.percentAvailable}%
                </span>
              </div>
              <div className="text-base font-bold text-foreground font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
                {balance.availableFormatted}
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, balance.percentAvailable))}%` }}
                />
              </div>
            </div>

            {/* 待清算托管金 */}
            <div className="rounded-lg border border-border/60 bg-background/80 p-2.5 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center justify-between">
                <span>对账托管中</span>
                <Badge variant="outline" className="text-[8.5px] px-1 py-0 h-3.5 border-amber-500/30 text-amber-500">
                  待清算
                </Badge>
              </div>
              <div className="text-base font-bold text-foreground font-mono tracking-tight text-amber-600 dark:text-amber-400">
                {balance.openTransferFormatted}
              </div>
              <div className="text-[9.5px] text-muted-foreground leading-tight truncate" title="连接优雅断开并由节点上报确认后，未消耗质押金将全额退还">
                断开/周期结束全额退还
              </div>
            </div>

            {/* 本期总配额 */}
            <div className="rounded-lg border border-border/60 bg-background/80 p-2.5 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">本期总配额</div>
              <div className="text-base font-bold text-foreground font-mono tracking-tight">
                {balance.totalFormatted}
              </div>
              <div className="text-[9.5px] text-muted-foreground leading-tight">
                含日度及跨期结余配额
              </div>
            </div>

            {/* 真实净消耗 */}
            <div className="rounded-lg border border-border/60 bg-background/80 p-2.5 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center justify-between">
                <span>实际净消耗</span>
                <TrendingDown className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="text-base font-bold text-foreground font-mono tracking-tight text-muted-foreground">
                {balance.netConsumedFormatted}
              </div>
              <div className="text-[9.5px] text-muted-foreground leading-tight">
                已确认结算消耗流量
              </div>
            </div>
          </div>

          {/* Settlement Explanation & Epoch Collapsible */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span>
                  清算机制：<b className="text-foreground">24 小时账单周期</b> + 会话断开即时结算对账
                </span>
              </div>
              {balance.activeWindows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowEpochs(!showEpochs)}
                  className="flex items-center gap-1 text-[10.5px] text-primary hover:underline font-medium"
                >
                  <span>{showEpochs ? '收起明细' : `查看活跃周期 (${balance.activeWindows.length})`}</span>
                  {showEpochs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>

            <div className="text-[10.5px] text-muted-foreground leading-relaxed">
              💡 当代理断开连接时，出口住宅节点会提交对账报告，质押流量将立即退回；若节点延迟或异常断开，系统将在 24 小时周期到期时执行 Epoch 强制结清并退款。每天 UTC 00:00 自动刷新 30 GB 每日配额。
            </div>

            {/* Epoch list */}
            {showEpochs && balance.activeWindows.length > 0 && (
              <div className="pt-2 border-t border-border/40 space-y-1.5 animate-in fade-in duration-150">
                <div className="text-[10.5px] font-semibold text-foreground">当前活跃计费周期 (Active Settlement Windows)：</div>
                <div className="space-y-1.5">
                  {balance.activeWindows.map((win, idx) => (
                    <div
                      key={win.balanceId || idx}
                      className="rounded-md border border-border/60 bg-background/90 p-2 text-[11px] flex items-center justify-between gap-2 flex-wrap"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">周期 #{idx + 1}</span>
                          <span className="font-mono text-muted-foreground text-[10px]">
                            {new Date(win.startTime).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}{' '}
                            {new Date(win.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ~{' '}
                            {new Date(win.endTime).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}{' '}
                            {new Date(win.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {win.isExpiringSoon && (
                            <Badge variant="outline" className="text-[8.5px] px-1 py-0 h-3.5 border-amber-500/40 text-amber-500">
                              即将结清
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          配额: {win.startFormatted} · 剩余可用: <b className="text-foreground">{win.currentFormatted}</b> · 锁定/消耗: {win.usedFormatted}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">距离清算重置</div>
                        <div className="font-mono font-bold text-foreground text-xs text-primary">
                          {win.remainingHuman}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
