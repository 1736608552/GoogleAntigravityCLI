import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolveAntigravityBinary, resolveAntigravityStateDir } from './antigravity-auth.provider.js';
import { invalidateAntigravityModelCache } from './antigravity-models.provider.js';
import { getProxyToggle, resolveAntigravityProxyEnv } from './antigravity-proxy.js';
const activeLogins = new Map();
const URL_REGEX = /https:\/\/accounts\.google\.com[^\s\x1b\x07\x00-\x1f'"]+/i;
function parseJwtPayload(jwtStr) {
    if (!jwtStr || typeof jwtStr !== 'string')
        return null;
    try {
        const parts = jwtStr.split('.');
        if (parts.length < 2)
            return null;
        const jsonStr = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(jsonStr);
    }
    catch {
        return null;
    }
}
function formatDynamicCountdown(isoString, fallbackText, is5h = false, percent) {
    const now = new Date();
    const fiveHourMs = 5 * 3600 * 1000;
    const currentBlockMs = now.getTime() % fiveHourMs;
    const fiveHourRemainingMs = fiveHourMs - currentBlockMs;
    const fiveHourH = Math.floor(fiveHourRemainingMs / (3600 * 1000));
    const fiveHourM = Math.floor((fiveHourRemainingMs % (3600 * 1000)) / (60 * 1000));
    const default5hText = `${fiveHourH}小时 ${fiveHourM}分钟`;
    const utcDay = now.getUTCDay();
    const utcHours = now.getUTCHours();
    const daysUntilWeekly = utcDay === 0 ? 0 : (7 - utcDay);
    const defaultWeeklyText = `${daysUntilWeekly}天 ${23 - utcHours}小时`;
    const isFiveHourBucket = is5h || (fallbackText ? /5h|5小时|five\s*hour/i.test(fallbackText) : false);
    // 1. Google 官方 description 正则提取（最高优先级：这是 Google 原生返回的具体刷新时间文本）
    if (fallbackText) {
        const desc = String(fallbackText).trim();
        const mEnDays = desc.match(/refresh in\s+(\d+)\s+days?(?:,\s*(\d+)\s+hours?)?/i);
        if (mEnDays) {
            const d = mEnDays[1];
            const h = mEnDays[2] || '0';
            return `${d}天 ${h}小时`;
        }
        const mEnHours = desc.match(/refresh in\s+(\d+)\s+hours?(?:,\s*(\d+)\s+minutes?)?/i);
        if (mEnHours) {
            const h = mEnHours[1];
            const m = mEnHours[2] || '0';
            return `${h}小时 ${m}分钟`;
        }
        const mEnMins = desc.match(/refresh in\s+(\d+)\s+minutes?/i);
        if (mEnMins) {
            return `${mEnMins[1]}分钟`;
        }
        const mCnDays = desc.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
        if (mCnDays) {
            const d = mCnDays[1];
            const h = mCnDays[2] || '0';
            return `${d}天 ${h}小时`;
        }
        const mCnHours = desc.match(/(\d+)\s*小时\s*(?:(\d+)\s*分钟)?/);
        if (mCnHours) {
            const h = mCnHours[1];
            const m = mCnHours[2] || '0';
            return `${h}小时 ${m}分钟`;
        }
    }
    // 2. 5小时滚动算力桶（5h）专用计算：
    // 核心机制：当额度为 100%（或未触发限流）时，Google 上游每次返回的 resetTime 都是 request_time + 5h。
    // 若直接 diff 计算，会永远得出 4小时59分不动。此时按 Google 集群 5 小时 epoch 块（now % 5h）精确计算距离下个周期重置的倒计时！
    // 当额度被真实消耗（percent < 99.9）且 Google 返回真实提前恢复时间时，精确计算真实差值。
    if (isFiveHourBucket) {
        const isFull = percent != null ? percent >= 99.9 : true;
        if (isoString) {
            const target = new Date(isoString).getTime();
            if (!isNaN(target)) {
                const diff = target - Date.now();
                if (!isFull && diff > 60 * 1000 && diff < 4.75 * 3600 * 1000) {
                    const h = Math.floor(diff / (3600 * 1000));
                    const m = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
                    if (h > 0)
                        return `${h}小时 ${m}分钟`;
                    return `${m}分钟`;
                }
            }
        }
        return default5hText;
    }
    // 3. 周度旗舰配额（Weekly）计算：
    if (isoString) {
        const target = new Date(isoString).getTime();
        if (!isNaN(target)) {
            const diff = target - Date.now();
            if (diff > 60 * 1000) {
                const d = Math.floor(diff / (24 * 3600 * 1000));
                const rem = diff % (24 * 3600 * 1000);
                const h = Math.floor(rem / (3600 * 1000));
                const m = Math.floor((rem % (3600 * 1000)) / (60 * 1000));
                if (d > 0)
                    return `${d}天 ${h}小时`;
                if (h > 0)
                    return `${h}小时 ${m}分钟`;
                return `${m}分钟`;
            }
            else if (diff > 0) {
                return '即将重置';
            }
        }
    }
    if (fallbackText && !fallbackText.includes('查询中') && !fallbackText.includes('计算中') && !fallbackText.includes('即将')) {
        return fallbackText;
    }
    return defaultWeeklyText;
}
async function fetchGoogleApi(url, options = {}) {
    const isProxy = getProxyToggle() === 'yes';
    if (isProxy) {
        try {
            const { SocksProxyAgent } = await import('socks-proxy-agent');
            const proxyUrl = process.env.AGY_PROXY_ALL || 'socks5h://127.0.0.1:19999';
            const agent = new SocksProxyAgent(proxyUrl);
            // @ts-ignore
            const mod = await import('node-fetch');
            const nodeFetch = mod.default || mod;
            const res = await nodeFetch(url, { ...options, agent, timeout: 10000 });
            if (res)
                return res;
        }
        catch (e) {
            console.warn('[fetchGoogleApi] Proxy fetch error, trying direct:', e?.message);
        }
    }
    // Try direct fetch
    try {
        const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
        return res;
    }
    catch (_) { }
    return null;
}
class AntigravityAccountsService {
    cachedQuotaSnapshot = null;
    quotaCacheTime = 0;
    accountQuotaSnapshots = new Map();
    inFlightQuotaFetches = new Map();
    getActiveEmail() {
        const activeAccountFiles = [
            path.join(resolveAntigravityStateDir(), 'active_account.json'),
            '/vol1/@apphome/GoogleAntigravityCLI/data/active_account.json',
        ];
        for (const f of activeAccountFiles) {
            if (fs.existsSync(f)) {
                try {
                    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
                    if (data?.email)
                        return data.email;
                }
                catch (_) { }
            }
        }
        const accounts = this.loadAccounts();
        const active = accounts.find((a) => a.isActive);
        if (active?.email)
            return active.email;
        const activeToken = this.readActiveToken();
        if (activeToken) {
            const jwt = parseJwtPayload(activeToken.id_token);
            if (jwt?.email)
                return jwt.email;
        }
        return accounts.length > 0 ? accounts[0].email : null;
    }
    getLiveQuotaCached(targetEmail) {
        if (targetEmail) {
            const entry = this.accountQuotaSnapshots.get(targetEmail.toLowerCase());
            if (entry) {
                return this.refreshSnapshotCountdowns(entry.snapshot);
            }
            const accounts = this.loadAccounts();
            const acc = accounts.find((a) => a.email.toLowerCase() === targetEmail.toLowerCase());
            if (acc?.quotaSnapshot) {
                return this.refreshSnapshotCountdowns(acc.quotaSnapshot);
            }
            if (acc?.quotaSummary) {
                const snap = this.buildQuotaSnapshot(acc.quotaSummary, acc.email);
                return this.refreshSnapshotCountdowns(snap);
            }
        }
        if (this.cachedQuotaSnapshot) {
            return this.refreshSnapshotCountdowns(this.cachedQuotaSnapshot);
        }
        const accounts = this.loadAccounts();
        const active = accounts.find((a) => a.isActive) || accounts[0];
        if (active?.quotaSnapshot) {
            return this.refreshSnapshotCountdowns(active.quotaSnapshot);
        }
        if (active?.quotaSummary) {
            const snap = this.buildQuotaSnapshot(active.quotaSummary, active.email);
            return this.refreshSnapshotCountdowns(snap);
        }
        return null;
    }
    refreshSnapshotCountdowns(snapshot) {
        if (!snapshot)
            return null;
        const cloned = { ...snapshot };
        if (cloned.gemini5h) {
            const reset = formatDynamicCountdown(cloned.gemini5h.resetTime, cloned.gemini5h.description, true, cloned.gemini5h.percent);
            cloned.gemini5h = { ...cloned.gemini5h, resetsIn: reset, resetText: reset };
        }
        if (cloned.geminiWeekly) {
            const reset = formatDynamicCountdown(cloned.geminiWeekly.resetTime, cloned.geminiWeekly.description, false, cloned.geminiWeekly.percent);
            cloned.geminiWeekly = { ...cloned.geminiWeekly, resetsIn: reset, resetText: reset };
        }
        if (cloned.claude5h) {
            const reset = formatDynamicCountdown(cloned.claude5h.resetTime, cloned.claude5h.description, true, cloned.claude5h.percent);
            cloned.claude5h = { ...cloned.claude5h, resetsIn: reset, resetText: reset };
        }
        if (cloned.claudeWeekly) {
            const reset = formatDynamicCountdown(cloned.claudeWeekly.resetTime, cloned.claudeWeekly.description, false, cloned.claudeWeekly.percent);
            cloned.claudeWeekly = { ...cloned.claudeWeekly, resetsIn: reset, resetText: reset };
        }
        if (cloned.active5h) {
            const reset = formatDynamicCountdown(cloned.active5h.resetTime, cloned.active5h.description, true, cloned.active5h.percent);
            cloned.active5h = { ...cloned.active5h, resetsIn: reset, resetText: reset };
            cloned.resetsIn = reset;
        }
        if (cloned.activeWeekly) {
            const reset = formatDynamicCountdown(cloned.activeWeekly.resetTime, cloned.activeWeekly.description, false, cloned.activeWeekly.percent);
            cloned.activeWeekly = { ...cloned.activeWeekly, resetsIn: reset, resetText: reset };
            cloned.weeklyResetIn = reset;
        }
        return cloned;
    }
    async fetchLiveQuotaSummary(force = false, targetEmail) {
        const emailKey = (targetEmail || this.getActiveEmail() || '').toLowerCase();
        const now = Date.now();
        // If cached per-account and within 25 seconds (and not forced), return cached
        const cachedEntry = emailKey ? this.accountQuotaSnapshots.get(emailKey) : null;
        if (!force && cachedEntry && now - cachedEntry.time < 25000) {
            return this.refreshSnapshotCountdowns(cachedEntry.snapshot);
        }
        if (!force && !targetEmail && this.cachedQuotaSnapshot && now - this.quotaCacheTime < 25000) {
            return this.refreshSnapshotCountdowns(this.cachedQuotaSnapshot);
        }
        if (this.inFlightQuotaFetches.has(emailKey)) {
            return this.inFlightQuotaFetches.get(emailKey);
        }
        const fetchPromise = (async () => {
            const accounts = this.loadAccounts();
            let targetAccount = targetEmail
                ? accounts.find((a) => a.email.toLowerCase() === targetEmail.toLowerCase())
                : accounts.find((a) => a.isActive);
            if (!targetAccount && accounts.length > 0) {
                targetAccount = accounts[0];
            }
            let tokenData = targetAccount?.tokenData || this.readActiveToken();
            if (!tokenData)
                return this.refreshSnapshotCountdowns(this.cachedQuotaSnapshot);
            // Check if token is expired (or close to expiring, within 60s)
            const expiryTime = tokenData?.token?.expiry ? new Date(tokenData.token.expiry).getTime() : 0;
            const isExpired = !expiryTime || isNaN(expiryTime) || now >= expiryTime - 60 * 1000;
            if (isExpired && tokenData?.token?.refresh_token) {
                tokenData = await this.refreshAccessToken(tokenData);
                if (targetAccount) {
                    targetAccount.tokenData = tokenData;
                }
            }
            let token = tokenData?.token?.access_token;
            if (!token)
                return this.refreshSnapshotCountdowns(this.cachedQuotaSnapshot);
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/1.1.19',
            };
            let res = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    res = await fetchGoogleApi('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({}),
                    });
                    if (res?.status === 401 || res?.status === 403) {
                        tokenData = await this.refreshAccessToken(tokenData);
                        token = tokenData?.token?.access_token;
                        if (token) {
                            headers['Authorization'] = `Bearer ${token}`;
                            if (targetAccount) {
                                targetAccount.tokenData = tokenData;
                            }
                            res = await fetchGoogleApi('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({}),
                            });
                        }
                    }
                    if (res && res.ok)
                        break;
                }
                catch (err) {
                    if (attempt === 0) {
                        await new Promise((r) => setTimeout(r, 600));
                    }
                }
            }
            if (res && res.ok) {
                try {
                    const data = await res.json();
                    if (Array.isArray(data?.groups)) {
                        const accEmail = targetAccount?.email || this.getActiveEmail() || '';
                        if (targetAccount) {
                            targetAccount.quotaSummary = data;
                            targetAccount.lastQuotaFetchedAt = Date.now();
                        }
                        const snapshot = this.buildQuotaSnapshot(data, accEmail);
                        if (targetAccount) {
                            targetAccount.quotaSnapshot = snapshot;
                            this.saveAccounts(accounts);
                        }
                        if (accEmail) {
                            this.accountQuotaSnapshots.set(accEmail.toLowerCase(), { snapshot, time: Date.now() });
                        }
                        if (!targetEmail || (targetAccount && targetAccount.isActive)) {
                            this.cachedQuotaSnapshot = snapshot;
                            this.quotaCacheTime = Date.now();
                        }
                        return snapshot;
                    }
                }
                catch (e) {
                    console.warn('[AntigravityAccounts] Failed to parse quota summary:', e);
                }
            }
            // Fallback: If live fetch failed, try reconstructing from account cache
            if (targetAccount?.quotaSummary) {
                const snapshot = this.buildQuotaSnapshot(targetAccount.quotaSummary, targetAccount.email);
                return this.refreshSnapshotCountdowns(snapshot);
            }
            return this.refreshSnapshotCountdowns(this.cachedQuotaSnapshot);
        })();
        this.inFlightQuotaFetches.set(emailKey, fetchPromise);
        try {
            return await fetchPromise;
        }
        finally {
            this.inFlightQuotaFetches.delete(emailKey);
        }
    }
    async getTurnQuotaSnapshot(model, tokens, duration, force = false, targetEmail) {
        const resolvedEmail = targetEmail || this.getActiveEmail() || undefined;
        let base = null;
        if (!force) {
            base = this.getLiveQuotaCached(resolvedEmail);
        }
        // On the turn-completion path (force=false) we must NOT block the `complete`
        // event on an upstream quota fetch: that call goes out over the same flaky
        // SOCKS proxy as the model traffic, so a reset here strands the run in
        // "thinking" forever after the turn already finished. Use the cache only;
        // the live refresh is fired asynchronously by the caller right after.
        if (!base && force) {
            base = await this.fetchLiveQuotaSummary(force, resolvedEmail);
        }
        if (!base)
            return null;
        const currentModel = model || 'gemini-3.8-flash';
        const isClaude = currentModel.toLowerCase().includes('claude') || currentModel.toLowerCase().includes('gpt') || currentModel.toLowerCase().includes('3p');
        const active5h = isClaude ? base.claude5h : base.gemini5h;
        const activeWeekly = isClaude ? base.claudeWeekly : base.geminiWeekly;
        return this.refreshSnapshotCountdowns({
            ...base,
            active5h,
            activeWeekly,
            percent: active5h.percent,
            resetTime: active5h.resetTime,
            resetsIn: active5h.resetsIn,
            weeklyPercent: activeWeekly.percent,
            weeklyResetTime: activeWeekly.resetTime,
            weeklyResetIn: activeWeekly.resetsIn,
            model: currentModel,
            tokens,
            duration,
            accountEmail: resolvedEmail || base.accountEmail || this.getActiveEmail() || '',
            updatedAt: Date.now(),
        });
    }
    deductLocalQuota(model, tokens, targetEmail) {
        if (!tokens || tokens <= 0)
            return null;
        const email = (targetEmail || this.getActiveEmail() || '').toLowerCase();
        const accounts = this.loadAccounts();
        const targetAcc = accounts.find((a) => a.email.toLowerCase() === email) || accounts.find((a) => a.isActive) || accounts[0];
        if (!targetAcc)
            return null;
        const currentModel = String(model || 'gemini-3.8-flash').toLowerCase();
        const isClaude = currentModel.includes('claude') || currentModel.includes('gpt') || currentModel.includes('oss');
        const prefix = isClaude ? 'claude' : 'gemini';
        // 算力权重折算
        let weight = 1;
        if (currentModel.includes('opus'))
            weight = 15;
        else if (currentModel.includes('sonnet'))
            weight = 3;
        else if (currentModel.includes('pro') && !currentModel.includes('flash'))
            weight = 5;
        else if (currentModel.includes('flash'))
            weight = 1;
        // Google AI Pro 算力池：5小时约 80,000 tokens (8000 WTUS)，每周约 500,000 tokens (50000 WTUS)
        const consumedWTUS = (tokens * weight) / 1000;
        const HOURLY_5H_LIMIT = 8000;
        const WEEKLY_LIMIT = 50000;
        if (!targetAcc.localQuota) {
            targetAcc.localQuota = {};
        }
        const lq = targetAcc.localQuota;
        const now = Date.now();
        // 1. 扣减 5 小时滚动配额
        const key5h = `${prefix}5h`;
        const cur5h = lq[key5h] || { remainingFraction: 1, resetTime: new Date(now + 5 * 3600 * 1000).toISOString() };
        const expiry5h = cur5h.resetTime ? new Date(cur5h.resetTime).getTime() : 0;
        if (!expiry5h || now >= expiry5h) {
            cur5h.remainingFraction = 1;
            cur5h.resetTime = new Date(now + 5 * 3600 * 1000).toISOString();
        }
        const deduct5h = consumedWTUS / HOURLY_5H_LIMIT;
        cur5h.remainingFraction = Math.max(0, parseFloat((cur5h.remainingFraction - deduct5h).toFixed(4)));
        lq[key5h] = cur5h;
        // 2. 扣减每周旗舰配额
        const keyWeekly = `${prefix}Weekly`;
        const curWeekly = lq[keyWeekly] || { remainingFraction: 1, resetTime: new Date(now + 7 * 24 * 3600 * 1000).toISOString() };
        const expiryWeekly = curWeekly.resetTime ? new Date(curWeekly.resetTime).getTime() : 0;
        if (!expiryWeekly || now >= expiryWeekly) {
            curWeekly.remainingFraction = 1;
            curWeekly.resetTime = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
        }
        const deductWeekly = consumedWTUS / WEEKLY_LIMIT;
        curWeekly.remainingFraction = Math.max(0, parseFloat((curWeekly.remainingFraction - deductWeekly).toFixed(4)));
        lq[keyWeekly] = curWeekly;
        lq.lastDeduct = now;
        targetAcc.localQuota = lq;
        // 重新构建快照并保存
        const summary = targetAcc.quotaSummary || {};
        const snapshot = this.buildQuotaSnapshot(summary, targetAcc.email);
        targetAcc.quotaSnapshot = snapshot;
        this.saveAccounts(accounts);
        if (targetAcc.email) {
            this.accountQuotaSnapshots.set(targetAcc.email.toLowerCase(), { snapshot, time: now });
        }
        if (targetAcc.isActive) {
            this.cachedQuotaSnapshot = snapshot;
            this.quotaCacheTime = now;
        }
        return snapshot;
    }
    buildQuotaSnapshot(summary, accountEmail) {
        const groups = summary?.groups || [];
        const geminiGroup = groups.find((g) => (g.displayName || '').toLowerCase().includes('gemini')) || groups[0];
        const claudeGroup = groups.find((g) => (g.displayName || '').toLowerCase().includes('claude') || (g.displayName || '').toLowerCase().includes('3p')) || groups[1];
        const gemini5hB = geminiGroup?.buckets?.find((b) => b.window === '5h' || b.bucketId?.includes('5h')) || geminiGroup?.buckets?.[1];
        const geminiWeeklyB = geminiGroup?.buckets?.find((b) => b.window === 'weekly' || b.bucketId?.includes('weekly')) || geminiGroup?.buckets?.[0];
        const claude5hB = claudeGroup?.buckets?.find((b) => b.window === '5h' || b.bucketId?.includes('5h')) || claudeGroup?.buckets?.[1];
        const claudeWeeklyB = claudeGroup?.buckets?.find((b) => b.window === 'weekly' || b.bucketId?.includes('weekly')) || claudeGroup?.buckets?.[0];
        const email = accountEmail || this.getActiveEmail() || '';
        const accounts = this.loadAccounts();
        const targetAcc = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) || accounts.find((a) => a.isActive);
        const lq = targetAcc?.localQuota;
        const gemini5h = this.parseBucket(gemini5hB, 'Gemini 5h 滚动算力', true, lq?.gemini5h);
        const geminiWeekly = this.parseBucket(geminiWeeklyB, 'Gemini 每周旗舰算力', false, lq?.geminiWeekly);
        const claude5h = this.parseBucket(claude5hB, 'Claude 5h 滚动算力', true, lq?.claude5h);
        const claudeWeekly = this.parseBucket(claudeWeeklyB, 'Claude 每周旗舰算力', false, lq?.claudeWeekly);
        // Compute metrics from sessions
        let totalConversations = 0;
        let totalTurns = 0;
        let totalTokens = 0;
        try {
            const sessionsDir = '/vol1/@apphome/GoogleAntigravityCLI/data/sessions';
            if (fs.existsSync(sessionsDir)) {
                const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
                totalConversations = files.length;
                for (const f of files) {
                    try {
                        const sess = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
                        if (Array.isArray(sess.messages)) {
                            totalTurns += Math.floor(sess.messages.length / 2);
                            for (const m of sess.messages) {
                                if (m.usage?.total_tokens) {
                                    totalTokens += m.usage.total_tokens;
                                }
                                else if (typeof m.content === 'string') {
                                    totalTokens += Math.round(m.content.length / 3.2);
                                }
                            }
                        }
                    }
                    catch (_) { }
                }
            }
        }
        catch (_) { }
        const tokensFormatted = totalTokens > 1000000
            ? `${(totalTokens / 1000000).toFixed(2)}M`
            : totalTokens > 1000
                ? `${(totalTokens / 1000).toFixed(1)}k`
                : String(totalTokens);
        const isPro = targetAcc?.isPro ?? true;
        const tierName = targetAcc?.tier || (isPro ? 'Google AI Pro (Gemini Advanced · G1 Credits)' : 'Google AI 标准版');
        const tierType = targetAcc?.tierType || (isPro ? 'pro' : 'free');
        const tierBadge = targetAcc?.tierBadge || (tierType === 'enterprise' ? 'ENT' : isPro ? 'PRO' : 'FREE');
        return {
            gemini5h,
            geminiWeekly,
            claude5h,
            claudeWeekly,
            active5h: gemini5h,
            activeWeekly: geminiWeekly,
            percent: gemini5h.percent,
            resetTime: gemini5h.resetTime,
            resetsIn: gemini5h.resetsIn,
            weeklyPercent: geminiWeekly.percent,
            weeklyResetTime: geminiWeekly.resetTime,
            weeklyResetIn: geminiWeekly.resetsIn,
            accountEmail: email,
            accountName: targetAcc?.name || email.split('@')[0] || 'Google 用户',
            accountPicture: targetAcc?.picture || '',
            tier: tierName,
            tierType,
            tierBadge,
            policyNote: 'Google AI Pro 订阅特权：享有 Gemini 5小时高额滚动算力池与无总量计费上限；Claude 与高阶模型享 Pro 优先调度，超额自动启用 G1 Credits 算力兜底。',
            metrics: {
                totalConversations,
                totalTurns,
                totalTokens,
                tokensFormatted,
            },
            updatedAt: Date.now(),
        };
    }
    parseBucket(b, fallbackTitle, is5h = false, localEntry) {
        let fraction = b?.remainingFraction != null ? Number(b.remainingFraction) : 1;
        let resetTime = b?.resetTime || null;
        if (localEntry && localEntry.remainingFraction != null) {
            const now = Date.now();
            const localExpiry = localEntry.resetTime ? new Date(localEntry.resetTime).getTime() : 0;
            if (!localExpiry || now < localExpiry) {
                fraction = Math.min(fraction, Math.max(0, Number(localEntry.remainingFraction)));
                if (!resetTime && localEntry.resetTime) {
                    resetTime = localEntry.resetTime;
                }
            }
        }
        const pct = parseFloat((fraction * 100).toFixed(1));
        const resetsIn = formatDynamicCountdown(resetTime, b?.description, is5h, pct);
        return {
            title: b?.displayName || fallbackTitle,
            percent: pct,
            used: parseFloat((100 - pct).toFixed(1)),
            total: 100,
            remainingFraction: fraction,
            resetTime,
            resetsIn,
            resetText: resetsIn,
            description: b?.description,
            status: pct > 60 ? 'healthy' : pct > 20 ? 'warning' : 'danger',
        };
    }
    getAccountsFilePath() {
        return path.join(resolveAntigravityStateDir(), 'accounts.json');
    }
    getActiveTokenFilePath() {
        return path.join(resolveAntigravityStateDir(), 'antigravity-oauth-token');
    }
    readActiveToken() {
        const filePath = this.getActiveTokenFilePath();
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        }
        catch (_) { }
        return null;
    }
    writeActiveToken(tokenData) {
        const json = typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData, null, 2);
        const targetDir = resolveAntigravityStateDir();
        try {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, 'antigravity-oauth-token'), json, 'utf8');
        }
        catch (e) {
            console.error('[AntigravityAccounts] Failed to write active token:', e);
        }
    }
    async refreshAccessToken(providedToken) {
        const target = providedToken || this.readActiveToken();
        const rt = target?.token?.refresh_token;
        if (!rt)
            return target;
        try {
            const body = new URLSearchParams({
                client_id: Buffer.from(['MTA3MTAwNjA2MDU5MS10bWhzc2luMmgy', 'MWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ=='].join(''), 'base64').toString('utf-8'),
                client_secret: Buffer.from(['R09DU1BYLUs1OEZXUjQ4', 'NkxkTEoxbUxCOHNYQzR6NnFEQWY='].join(''), 'base64').toString('utf-8'),
                refresh_token: rt,
                grant_type: 'refresh_token',
            });
            const res = await fetchGoogleApi('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });
            if (!res) {
                console.warn('[AntigravityAccounts] Token refresh failed: no response from oauth server');
                return target;
            }
            const j = await res.json();
            if (res.ok && j.access_token) {
                const newExpiry = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
                const updated = {
                    ...target,
                    token: {
                        ...target.token,
                        access_token: j.access_token,
                        token_type: j.token_type || 'Bearer',
                        refresh_token: j.refresh_token || rt,
                        expiry: newExpiry,
                    },
                    id_token: j.id_token || target.id_token || '',
                };
                const activeEmail = this.getActiveEmail();
                const jwt = parseJwtPayload(updated.id_token);
                const updatedEmail = (jwt?.email || '').toLowerCase();
                // If this refreshed token belongs to the active account, sync to antigravity-oauth-token
                if (activeEmail && updatedEmail === activeEmail.toLowerCase()) {
                    this.writeActiveToken(updated);
                }
                const accounts = this.loadAccounts();
                const idx = accounts.findIndex((a) => a.tokenData?.token?.refresh_token === rt ||
                    (updatedEmail && a.email.toLowerCase() === updatedEmail));
                if (idx >= 0) {
                    accounts[idx].tokenData = updated;
                    this.saveAccounts(accounts);
                }
                return updated;
            }
            else {
                console.warn('[AntigravityAccounts] Token refresh returned error:', j);
            }
        }
        catch (e) {
            console.warn('[AntigravityAccounts] Failed to refresh access token:', e?.message);
        }
        return target;
    }
    loadAccounts() {
        const accountsFile = this.getAccountsFilePath();
        let accounts = [];
        if (fs.existsSync(accountsFile)) {
            try {
                const raw = fs.readFileSync(accountsFile, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    accounts = parsed;
                }
            }
            catch (e) {
                console.warn('[AntigravityAccounts] Could not read accounts.json:', e);
            }
        }
        // If accounts is empty, check upstream / fallback paths
        if (accounts.length === 0) {
            const fallbackPaths = [
                '/vol1/@apphome/GoogleAntigravityCLI/data/accounts.json',
            ];
            for (const p of fallbackPaths) {
                if (fs.existsSync(p)) {
                    try {
                        const raw = fs.readFileSync(p, 'utf8');
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            accounts = parsed;
                            this.saveAccounts(accounts);
                            break;
                        }
                    }
                    catch (_) { }
                }
            }
        }
        // If still empty, check if an existing active token is present
        const activeToken = this.readActiveToken();
        if (accounts.length === 0 && activeToken) {
            const jwt = parseJwtPayload(activeToken.id_token);
            const email = jwt?.email || 'default-user@gmail.com';
            const name = jwt?.name || email.split('@')[0];
            const primaryAccount = {
                email,
                name,
                authMethod: activeToken.auth_method || 'consumer',
                label: `默认主账号 (${email})`,
                isPrimary: true,
                isActive: true,
                addedAt: Date.now(),
                tokenData: activeToken,
            };
            accounts.push(primaryAccount);
            this.saveAccounts(accounts);
        }
        // Ensure there is at least one primary account
        if (accounts.length > 0 && !accounts.some((a) => a.isPrimary)) {
            accounts[0].isPrimary = true;
            if (!accounts[0].label?.includes('默认主账号')) {
                accounts[0].label = `默认主账号 (${accounts[0].email})`;
            }
            this.saveAccounts(accounts);
        }
        // Synchronize active status with active_account.json if present
        const activeFiles = [
            path.join(resolveAntigravityStateDir(), 'active_account.json'),
            '/vol1/@apphome/GoogleAntigravityCLI/data/active_account.json',
        ];
        let preferredActiveEmail = null;
        for (const f of activeFiles) {
            if (fs.existsSync(f)) {
                try {
                    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
                    if (d?.email) {
                        preferredActiveEmail = d.email.toLowerCase();
                        break;
                    }
                }
                catch (_) { }
            }
        }
        if (preferredActiveEmail && accounts.length > 0) {
            let matched = false;
            for (const a of accounts) {
                if (a.email.toLowerCase() === preferredActiveEmail) {
                    a.isActive = true;
                    matched = true;
                }
                else {
                    a.isActive = false;
                }
            }
            if (!matched && !accounts.some((a) => a.isActive)) {
                accounts[0].isActive = true;
            }
        }
        return accounts;
    }
    saveAccounts(accounts) {
        const accountsFile = this.getAccountsFilePath();
        try {
            fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
            fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), 'utf8');
        }
        catch (e) {
            console.error('[AntigravityAccounts] Failed to save accounts.json:', e);
        }
    }
    async listAccounts() {
        const accounts = this.loadAccounts();
        // Prioritize explicitly active account in accounts.json
        let activeAccount = accounts.find((a) => a.isActive);
        if (!activeAccount && accounts.length > 0) {
            activeAccount = accounts[0];
            activeAccount.isActive = true;
            this.saveAccounts(accounts);
        }
        const activeEmail = activeAccount?.email || null;
        // Update isActive and tier flags on list
        for (const a of accounts) {
            a.isActive = (a.email.toLowerCase() === (activeEmail || '').toLowerCase());
            if (a.isPro === undefined) {
                a.isPro = a.tierType === 'enterprise' || a.tierType === 'pro' || a.authMethod === 'consumer' || true;
            }
            if (!a.tier) {
                a.tier = a.tierType === 'enterprise' ? 'Google Enterprise' : 'Google AI Pro';
            }
            if (!a.tierType) {
                a.tierType = a.tier.includes('Enterprise') ? 'enterprise' : 'pro';
            }
        }
        return { accounts, activeEmail };
    }
    async getActiveAccount() {
        const { accounts, activeEmail } = await this.listAccounts();
        if (!activeEmail)
            return accounts[0] || null;
        return accounts.find((a) => a.email === activeEmail) || accounts[0] || null;
    }
    getOtherAvailableAccounts(currentEmail) {
        const accounts = this.loadAccounts();
        const norm = (currentEmail || '').toLowerCase();
        return accounts.filter((a) => a.email.toLowerCase() !== norm);
    }
    async ensureActiveTokenFresh() {
        const accounts = this.loadAccounts();
        if (accounts.length === 0)
            return null;
        let target = accounts.find((a) => a.isActive) || accounts[0];
        if (!target)
            return null;
        const activeTokenOnDisk = this.readActiveToken();
        const diskEmail = (parseJwtPayload(activeTokenOnDisk?.id_token)?.email || activeTokenOnDisk?.email || '').toLowerCase();
        const targetEmail = target.email.toLowerCase();
        const expiryTime = activeTokenOnDisk?.token?.expiry ? new Date(activeTokenOnDisk.token.expiry).getTime() : 0;
        const isExpired = !expiryTime || isNaN(expiryTime) || Date.now() >= (expiryTime - 3 * 60 * 1000);
        const isMismatch = !diskEmail || diskEmail !== targetEmail;
        if (isMismatch || isExpired) {
            console.log(`[AntigravityAccounts] Synchronizing active token for ${target.email} (isMismatch=${isMismatch}, isExpired=${isExpired})...`);
            let freshToken = target.tokenData || activeTokenOnDisk;
            if (freshToken?.token?.refresh_token) {
                freshToken = await this.refreshAccessToken(freshToken);
                target.tokenData = freshToken;
            }
            if (freshToken) {
                this.writeActiveToken(freshToken);
            }
            for (const a of accounts) {
                a.isActive = (a.email.toLowerCase() === targetEmail);
            }
            this.saveAccounts(accounts);
        }
        return target;
    }
    async switchAccount(email) {
        const accounts = this.loadAccounts();
        const target = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase() || a.label === email);
        if (!target) {
            return { ok: false, error: `账号 ${email} 未找到` };
        }
        for (const a of accounts) {
            a.isActive = (a.email.toLowerCase() === target.email.toLowerCase());
        }
        let tokenData = target.tokenData;
        if (tokenData?.token?.refresh_token) {
            try {
                tokenData = await this.refreshAccessToken(tokenData);
                target.tokenData = tokenData;
            }
            catch (e) {
                console.warn('[AntigravityAccounts] Token refresh during switchAccount failed:', e);
            }
        }
        if (tokenData) {
            this.writeActiveToken(tokenData);
        }
        this.saveAccounts(accounts);
        this.cachedQuotaSnapshot = null;
        this.quotaCacheTime = 0;
        invalidateAntigravityModelCache();
        // Persist active account selection for CLI and 3100 sync
        const activeData = JSON.stringify({ email: target.email, updatedAt: Date.now() }, null, 2);
        const targetDirs = [
            resolveAntigravityStateDir(),
            '/vol1/@apphome/GoogleAntigravityCLI/data',
        ];
        for (const d of targetDirs) {
            try {
                fs.mkdirSync(d, { recursive: true });
                fs.writeFileSync(path.join(d, 'active_account.json'), activeData, 'utf8');
            }
            catch (_) { }
        }
        void this.fetchLiveQuotaSummary(true, target.email);
        return { ok: true, activeEmail: target.email, account: target };
    }
    async addAccount(label, tokenData) {
        const resolvedToken = tokenData || this.readActiveToken();
        if (!resolvedToken) {
            return { ok: false, error: '未检测到有效的授权 Token' };
        }
        const jwt = parseJwtPayload(resolvedToken.id_token);
        const email = jwt?.email || resolvedToken.email || '';
        if (!email) {
            return { ok: false, error: 'Token 中未解析到有效的 Google 账号邮箱，请重新授权' };
        }
        const name = jwt?.name || resolvedToken.name || email.split('@')[0];
        const picture = resolvedToken.picture || '';
        const accounts = this.loadAccounts();
        const isFirst = accounts.length === 0;
        const newAccount = {
            email,
            name,
            picture,
            authMethod: resolvedToken.auth_method || 'consumer',
            addedAt: Date.now(),
            tokenData: resolvedToken,
            label: label?.trim() || (isFirst ? `默认主账号 (${email})` : email),
            isPrimary: isFirst,
            isActive: true,
        };
        const existingIdx = accounts.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
        if (existingIdx >= 0) {
            newAccount.isPrimary = accounts[existingIdx].isPrimary || isFirst;
            accounts[existingIdx] = newAccount;
        }
        else {
            accounts.push(newAccount);
        }
        for (const a of accounts) {
            a.isActive = (a.email.toLowerCase() === email.toLowerCase());
        }
        this.writeActiveToken(resolvedToken);
        this.saveAccounts(accounts);
        return { ok: true, account: newAccount };
    }
    async removeAccount(email) {
        const accounts = this.loadAccounts();
        const target = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
        if (!target) {
            return { ok: false, error: '该账号不存在' };
        }
        if (target.isPrimary) {
            return { ok: false, error: '默认主账号不可删除，需保障基础系统登录态' };
        }
        if (accounts.length <= 1) {
            return { ok: false, error: '至少需要保留一个生效账号，不可全部删除' };
        }
        const filtered = accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
        this.saveAccounts(filtered);
        // If removed account was active, switch to primary
        if (target.isActive) {
            const primary = filtered.find((a) => a.isPrimary) || filtered[0];
            if (primary) {
                await this.switchAccount(primary.email);
            }
        }
        return { ok: true };
    }
    async cliLoginStart() {
        // Clean up any stale sessions
        for (const [id] of activeLogins) {
            this.cleanupLoginSession(id);
        }
        const id = crypto.randomBytes(8).toString('hex');
        const fakeHome = path.join(os.tmpdir(), `agy-login-${id}`);
        fs.mkdirSync(path.join(fakeHome, '.gemini', 'antigravity-cli'), { recursive: true });
        const session = {
            id,
            child: null,
            fakeHome,
            url: null,
            output: '',
            settled: false,
            codeSent: false,
            createdAt: Date.now(),
        };
        activeLogins.set(id, session);
        const binPath = resolveAntigravityBinary();
        const env = resolveAntigravityProxyEnv({
            ...process.env,
            SSH_CONNECTION: process.env.SSH_CONNECTION || 'remote',
            HOME: fakeHome,
        });
        let child;
        let hasScript = false;
        try {
            execFileSync('script', ['--version'], { stdio: 'ignore' });
            hasScript = true;
        }
        catch {
            hasScript = fs.existsSync('/usr/bin/script');
        }
        try {
            if (hasScript) {
                child = spawn('script', ['-qec', `"${binPath}" --print ping`, '/dev/null'], {
                    env,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            }
            else {
                child = spawn(binPath, ['--print', 'ping'], {
                    env,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            }
        }
        catch (err) {
            this.cleanupLoginSession(id);
            return { ok: false, error: `启动 CLI 失败: ${err.message}` };
        }
        session.child = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        const handleOutput = (chunk) => {
            session.output = (session.output + chunk).slice(-8000);
            if (!session.url) {
                const match = session.output.match(URL_REGEX);
                if (match) {
                    session.url = match[0];
                }
            }
        };
        child.stdout.on('data', handleOutput);
        child.stderr.on('data', handleOutput);
        child.on('close', (code) => {
            if (code !== 0 && !session.error) {
                const lines = session.output.split('\n').map((s) => s.trim()).filter(Boolean);
                const errLine = lines.slice().reverse().find((l) => /error|fail|invalid|timeout|denied/i.test(l) &&
                    !/未能获得头像|profile picture|avatar/i.test(l));
                session.error = errLine || `CLI 异常退出 (退出码 ${code})`;
            }
            session.settled = true;
        });
        child.on('error', (e) => {
            session.error = e.message;
            session.settled = true;
        });
        // Wait up to 30 seconds for Google OAuth URL
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (session.url)
                break;
            if (session.settled)
                break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (!session.url) {
            const err = session.error || 'CLI 未输出 Google 授权链接（可能网络连接 Google 超时）';
            this.cleanupLoginSession(id);
            return { ok: false, error: err };
        }
        return { ok: true, id, url: session.url };
    }
    cliLoginComplete(id, code) {
        const session = activeLogins.get(id);
        if (!session)
            return { ok: false, error: '登录会话不存在或已过期，请重新开始' };
        if (session.settled)
            return { ok: false, error: '登录流程已结束，请重新发起' };
        if (session.codeSent)
            return { ok: false, error: '授权 Code 已提交，请等待处理' };
        let cleanCode = code.trim();
        if (/[?&#]code=/i.test(cleanCode)) {
            const match = cleanCode.match(/[?&#]code=([^&#]+)/i);
            if (match)
                cleanCode = decodeURIComponent(match[1]);
        }
        if (!cleanCode) {
            return { ok: false, error: '授权 Code 不能为空' };
        }
        session.codeSent = true;
        session.child.stdin.write(cleanCode + '\n');
        return { ok: true };
    }
    async cliLoginStatus(id) {
        const session = activeLogins.get(id);
        if (!session)
            return { status: 'error', error: '登录会话已失效' };
        if (session.settled) {
            const tokenPath = path.join(session.fakeHome, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
            let tokenData = null;
            try {
                if (fs.existsSync(tokenPath)) {
                    tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                }
            }
            catch (_) { }
            const hasValidToken = Boolean(tokenData?.token?.access_token || tokenData?.token?.refresh_token);
            if (hasValidToken) {
                const addResult = await this.addAccount('', tokenData);
                this.cleanupLoginSession(id);
                if (addResult.ok && addResult.account) {
                    return { status: 'success', account: addResult.account };
                }
                return { status: 'error', error: addResult.error || '解析 Token 失败' };
            }
            let errorMsg = session.error || '授权 Code 验证失败，请确认是否在网页中点击了授权并且复制了最新的 Code';
            if (/invalid_grant/i.test(session.output)) {
                errorMsg = '授权 Code 无效或已过期（Code 为一次性），请重新获取并提交';
            }
            this.cleanupLoginSession(id);
            return { status: 'error', error: errorMsg };
        }
        return { status: 'pending' };
    }
    async getAccountAvatar(email) {
        const accounts = this.loadAccounts();
        const acc = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
        const pictureUrl = acc?.picture;
        if (!pictureUrl)
            return null;
        const cached = avatarCache.get(pictureUrl);
        if (cached && Date.now() < cached.expires) {
            return { contentType: cached.contentType, buffer: cached.buffer };
        }
        try {
            const res = await fetch(pictureUrl, {
                signal: AbortSignal.timeout(8000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });
            if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuf);
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                avatarCache.set(pictureUrl, {
                    buffer,
                    contentType,
                    expires: Date.now() + 86400000,
                });
                return { contentType, buffer };
            }
        }
        catch (err) {
            console.warn('[AntigravityAccounts] Failed to fetch avatar for', email, err?.message);
        }
        return null;
    }
    async updateAccountLabel(email, label) {
        const accounts = this.loadAccounts();
        const acc = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
        if (!acc)
            return { ok: false, error: '账号不存在' };
        acc.label = label.trim() || acc.name || acc.email;
        this.saveAccounts(accounts);
        return { ok: true, account: acc };
    }
    async addCurrentCliAccount(label) {
        const activeToken = this.readActiveToken();
        if (!activeToken) {
            return { ok: false, error: '未找到当前生效的 CLI Token 文件' };
        }
        return this.addAccount(label, activeToken);
    }
    cliLoginCancel(id) {
        this.cleanupLoginSession(id);
    }
    cleanupLoginSession(id) {
        const session = activeLogins.get(id);
        if (session) {
            if (session.child && !session.child.killed) {
                try {
                    session.child.kill('SIGKILL');
                }
                catch (_) { }
            }
            if (session.fakeHome) {
                try {
                    fs.rmSync(session.fakeHome, { recursive: true, force: true });
                }
                catch (_) { }
            }
            activeLogins.delete(id);
        }
    }
}
const avatarCache = new Map();
export const antigravityAccountsService = new AntigravityAccountsService();
//# sourceMappingURL=antigravity-accounts.service.js.map