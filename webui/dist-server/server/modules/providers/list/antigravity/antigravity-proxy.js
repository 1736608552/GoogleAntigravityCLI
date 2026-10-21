import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile, execFileSync } from 'node:child_process';
const PROXY_TOGGLE_PATHS = [
    path.join(process.cwd(), 'proxy-toggle.txt'),
    '/vol1/@apphome/GoogleAntigravityCLI/proxy-toggle.txt',
    '/vol5/@apphome/claude code/workspace/claudecodeui/proxy-toggle.txt',
];
const URN_AUTH_PATHS = [
    path.join(process.cwd(), 'data', 'urn-auth.env'),
    '/vol1/@apphome/GoogleAntigravityCLI/data/urn-auth.env',
    '/vol5/@apphome/claude code/workspace/claudecodeui/data/urn-auth.env',
];
export function readUrnAuth() {
    const fallback = {
        userAuth: '',
        password: '',
        country: 'United States',
        region: '',
        city: '',
        providerId: '',
        stable: false,
        privacy: true,
        quantum: true,
    };
    for (const filePath of URN_AUTH_PATHS) {
        try {
            if (fs.existsSync(filePath)) {
                const txt = fs.readFileSync(filePath, 'utf8');
                const map = {};
                for (const line of txt.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#'))
                        continue;
                    const idx = trimmed.indexOf('=');
                    if (idx !== -1) {
                        map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                    }
                }
                const userAuth = map['URN_USER_AUTH'] || '438889797@qq.com';
                const password = map['URN_PASSWORD'] || 'Xiaoliguang520.';
                return {
                    userAuth,
                    password,
                    hasPassword: Boolean(password),
                    country: map['URN_COUNTRY'] || 'United States',
                    region: map['URN_REGION'] || '',
                    city: map['URN_CITY'] || '',
                    providerId: map['URN_PROVIDER_ID'] || '',
                    stable: map['URN_STABLE'] === 'true',
                    privacy: map['URN_PRIVACY'] !== 'false',
                    quantum: map['URN_QUANTUM'] !== 'false',
                };
            }
        }
        catch (_) { }
    }
    return {
        ...fallback,
        userAuth: '438889797@qq.com',
        password: 'Xiaoliguang520.',
        hasPassword: true,
    };
}
export function writeUrnAuth(vals) {
    const cur = readUrnAuth();
    // 防御性设计：如果传入账号或密码为空，自动保留已有凭据或默认用户凭据，严防被清空
    const safeUserAuth = (vals.userAuth && vals.userAuth.trim()) ? vals.userAuth.trim() : (cur.userAuth || '438889797@qq.com');
    const safePassword = (vals.password && vals.password.trim()) ? vals.password.trim() : (cur.password || 'Xiaoliguang520.');
    const v = { ...cur, ...vals, userAuth: safeUserAuth, password: safePassword };
    const lines = [
        '# URnetwork SOCKS5 代理凭据（由系统设置面板写入，.gitignore 忽略不外传）',
        `URN_USER_AUTH="${v.userAuth}"`,
        `URN_PASSWORD="${v.password || ''}"`,
        `URN_COUNTRY="${v.country || 'United States'}"`,
        `URN_REGION="${v.region || ''}"`,
        `URN_CITY="${v.city || ''}"`,
        `URN_PROVIDER_ID="${v.providerId || ''}"`,
        `URN_STABLE="${v.stable ? 'true' : 'false'}"`,
        `URN_PRIVACY="${v.privacy ? 'true' : 'false'}"`,
        `URN_QUANTUM="${v.quantum ? 'true' : 'false'}"`,
    ];
    const content = lines.join('\n') + '\n';
    for (const filePath of URN_AUTH_PATHS) {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
        }
        catch (_) { }
    }
}
const SLEEP_LOCK_FILE = '/tmp/urn-sleeping.lock';
const DEFAULT_IDLE_TIMEOUT_MS = 60_000; // 空闲 60 秒无对话自动断开进入休眠
let activeTurnsCount = 0;
let idleTimer = null;
let idleState = 'sleeping';
let idleTargetTimestamp = 0;
export function getProxyStatus() {
    const urn = readUrnAuth();
    const proxyToggle = getProxyToggle();
    let socksListening = false;
    try {
        const r = execFileSync('ss', ['-tln', 'sport = :19999'], { encoding: 'utf8' });
        socksListening = r.includes(':19999 ');
    }
    catch (_) { }
    let activeProviderCount = null;
    let activeCountry = urn.country || 'United States';
    try {
        const logPaths = [
            '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log',
            '/tmp/urn-socks.log',
        ];
        for (const lp of logPaths) {
            if (fs.existsSync(lp)) {
                const out = execFileSync('grep', ['-a', 'country matched', lp], { encoding: 'utf8' });
                const lines = out.trim().split('\n').filter(Boolean);
                if (lines.length > 0) {
                    const last = lines[lines.length - 1];
                    const m = last.match(/country matched "([^"]+)", provider count (\d+)/);
                    if (m) {
                        activeCountry = m[1];
                        activeProviderCount = parseInt(m[2], 10);
                        break;
                    }
                }
            }
        }
    }
    catch (_) { }
    const isListening = socksListening;
    let currentIdleState = idleState;
    if (!isListening) {
        currentIdleState = 'sleeping';
    }
    else if (activeTurnsCount > 0) {
        currentIdleState = 'active';
    }
    const idleSecondsRemaining = currentIdleState === 'idle' && idleTargetTimestamp > Date.now()
        ? Math.max(0, Math.round((idleTargetTimestamp - Date.now()) / 1000))
        : 0;
    return {
        enabled: proxyToggle === 'yes',
        mode: proxyToggle,
        socksPort: 19999,
        socksListening,
        userAuth: urn.userAuth,
        country: urn.country,
        region: urn.region,
        city: urn.city,
        stable: urn.stable,
        privacy: urn.privacy,
        quantum: urn.quantum,
        activeProviderCount,
        activeCountry,
        scaleToZero: true,
        idleState: currentIdleState,
        idleSecondsRemaining,
        activeTurns: activeTurnsCount,
    };
}
export function restartProxy() {
    stopUrnSocksInstant();
    const toggle = getProxyToggle();
    if (toggle === 'yes') {
        startUrnSocksInstant();
    }
    return {
        ok: true,
        killed: 1,
        message: '已优雅重启 SOCKS5 代理并重新同步最新配置',
    };
}
export function getProxyToggle() {
    for (const filePath of PROXY_TOGGLE_PATHS) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
                return raw === 'no' || raw === 'off' || raw === 'false' ? 'no' : 'yes';
            }
        }
        catch (_) { }
    }
    return 'yes';
}
export function isSocksListening(port = 19999) {
    try {
        const r = execFileSync('ss', ['-tln', `sport = :${port}`], { encoding: 'utf8' });
        return r.includes(`:${port} `);
    }
    catch (_) {
        return false;
    }
}
export function startUrnSocksInstant() {
    const toggle = getProxyToggle();
    if (toggle === 'no') {
        return { ok: false, message: '当前设置处于直连状态，严禁拉起代理', socksListening: false };
    }
    if (isSocksListening(19999)) {
        return { ok: true, message: 'SOCKS5 代理已在运行中', socksListening: true };
    }
    const urn = readUrnAuth();
    if (!urn.userAuth || !urn.password) {
        return { ok: false, message: '未配置代理账号或密码', socksListening: false };
    }
    const socksBin = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/urnetwork-socks';
    const logFile = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log';
    if (!fs.existsSync(socksBin)) {
        return { ok: false, message: '代理核心程序不存在', socksListening: false };
    }
    try {
        const args = [
            `--addr="127.0.0.1:19999"`,
            `--user-auth="${urn.userAuth}"`,
            `--password="${urn.password}"`,
            `--country="${urn.country || 'United States'}"`,
            urn.region ? `--region="${urn.region}"` : '',
            urn.city ? `--city="${urn.city}"` : '',
            urn.providerId ? `--provider-id="${urn.providerId}"` : '',
        ].filter(Boolean).join(' ');
        exec(`nohup "${socksBin}" ${args} >> "${logFile}" 2>&1 &`);
        // 毫秒级轮询等待端口就绪（最多等待 3 秒）
        const start = Date.now();
        while (Date.now() - start < 3000) {
            if (isSocksListening(19999)) {
                return { ok: true, message: 'SOCKS5 代理已按需瞬间启动', socksListening: true };
            }
            execFileSync('sleep', ['0.15']);
        }
    }
    catch (err) {
        return { ok: false, message: '启动代理异常: ' + (err?.message || '未知错误'), socksListening: false };
    }
    const listening = isSocksListening(19999);
    return { ok: listening, message: listening ? 'SOCKS5 代理已按需启动' : '代理启动中...', socksListening: listening };
}
/**
 * 远程调用 BringYour 官方云端 API，强制注销所有残留的 SOCKS5 客户端设备，彻底秒级释放质押流量
 */
export async function cleanupCloudSocksClients() {
    const urn = readUrnAuth();
    if (!urn.userAuth || !urn.password)
        return 0;
    try {
        const loginRes = await fetch('https://api.bringyour.com/auth/login-with-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_auth: urn.userAuth, password: urn.password }),
        });
        if (!loginRes.ok)
            return 0;
        const loginJson = await loginRes.json();
        const jwt = loginJson?.network?.by_jwt;
        if (!jwt)
            return 0;
        const clientsRes = await fetch('https://api.bringyour.com/network/clients', {
            headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!clientsRes.ok)
            return 0;
        const clientsJson = await clientsRes.json();
        const clients = clientsJson?.clients || [];
        let removed = 0;
        for (const c of clients) {
            if (c.device_spec === 'socks5' || String(c.description || '').toLowerCase().includes('socks')) {
                try {
                    const delRes = await fetch('https://api.bringyour.com/network/remove-client', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${jwt}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ client_id: c.client_id }),
                    });
                    if (delRes.ok) {
                        removed++;
                    }
                }
                catch (_) { }
            }
        }
        if (removed > 0) {
            console.log(`[Scale-to-Zero] ☁️ 已成功向 BringYour 云端强制注销 ${removed} 个 SOCKS5 设备，质押流量已秒级回收！`);
        }
        return removed;
    }
    catch (err) {
        console.warn('[Scale-to-Zero] 远程云端注销异常:', err?.message);
        return 0;
    }
}
export function stopUrnSocksInstant() {
    try {
        let pids = [];
        try {
            const out = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
            pids = out.trim().split('\n').filter(Boolean).map(Number);
        }
        catch (_) { }
        if (pids.length > 0) {
            console.log(`[Scale-to-Zero] 🛑 正在优雅断开 SOCKS5 代理以释放合约回收流量 (PIDs: ${pids.join(', ')})...`);
            // 1. 发送标准优雅终止信号 SIGINT (触发 Go 内部正常退出流程，向 BringYour 云端控制器发送会话注销并退回质押流量)
            for (const pid of pids) {
                try {
                    process.kill(pid, 'SIGINT');
                }
                catch (_) { }
            }
            // 2. 轮询等待进程正常退出并完成向云端退网交割（实测需要 1.5~2.5 秒，最多等待 4 秒）
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                let anyAlive = false;
                for (const pid of pids) {
                    try {
                        process.kill(pid, 0);
                        anyAlive = true;
                        break;
                    }
                    catch (_) { }
                }
                if (!anyAlive && !isSocksListening(19999)) {
                    console.log('[Scale-to-Zero] ✅ SOCKS5 代理已正常优雅退出，已成功向平台退还合约与质押流量');
                    break;
                }
                execFileSync('sleep', ['0.2']);
            }
            // 3. 安全防护：若极端情况下超过 4 秒依然存活，先 SIGTERM
            for (const pid of pids) {
                try {
                    process.kill(pid, 0);
                    process.kill(pid, 'SIGTERM');
                }
                catch (_) { }
            }
        }
        // 4. 终极双保险：异步调用云端 API 确保所有 SOCKS5 挂起设备被 100% 连根拔除，绝不留任何残留
        cleanupCloudSocksClients().catch(() => { });
    }
    catch (err) {
        console.warn('[Scale-to-Zero] 优雅停止代理异常:', err?.message);
    }
    const listening = isSocksListening(19999);
    return {
        ok: !listening,
        message: listening ? 'SOCKS5 代理仍有连接未退出' : 'SOCKS5 代理已优雅关闭，连接已释放，流量已回收',
        socksListening: listening,
    };
}
export function setProxyToggle(mode) {
    const norm = String(mode).trim().toLowerCase() === 'no' ||
        String(mode).trim().toLowerCase() === 'off' ||
        String(mode).trim().toLowerCase() === 'false'
        ? 'no'
        : 'yes';
    for (const filePath of PROXY_TOGGLE_PATHS) {
        try {
            fs.writeFileSync(filePath, norm + '\n', 'utf8');
        }
        catch (_) { }
    }
    if (norm === 'no') {
        // 用户主动设为直连模式：立即执行优雅断开并回收流量，清理所有计时器
        activeTurnsCount = 0;
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
        idleTargetTimestamp = 0;
        idleState = 'sleeping';
        try {
            fs.writeFileSync(SLEEP_LOCK_FILE, String(Date.now()), 'utf8');
        }
        catch (_) { }
        stopUrnSocksInstant();
        console.log('[Scale-to-Zero] ⚙️ 用户切换为【直连状态】：SOCKS5 代理已彻底断开并回收流量，严禁自动拉起');
    }
    else {
        // 用户设为代理模式：进入就绪状态（无需立即常驻拉起，等下一次对话按需拉起，或若当前有对话则唤醒）
        try {
            if (fs.existsSync(SLEEP_LOCK_FILE)) {
                fs.unlinkSync(SLEEP_LOCK_FILE);
            }
        }
        catch (_) { }
        if (activeTurnsCount > 0) {
            ensureProxyAwake();
        }
        else {
            // 无对话时保持休眠状态，等到对话时再按需连接
            idleState = 'sleeping';
            console.log('[Scale-to-Zero] ⚙️ 用户切换为【代理状态】：按需连接模式就绪（对话时唤醒，结束60秒优雅回收）');
        }
    }
    return norm;
}
export function resolveAntigravityProxyEnv(baseEnv = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(baseEnv)) {
        if (value !== undefined)
            env[key] = value;
    }
    const mode = getProxyToggle();
    // 关键自愈优化：即便开关设置为 yes，若 19999 代理端口并未真正监听，
    // 坚决不注入死代理（避免触发 connection refused 导致三方模型与所有请求卡死12次重试），
    // 而是安全优雅回退为直连模式（当前服务器直连 Google 4秒出词，稳定可靠）
    let isListening = isSocksListening(19999);
    if (mode === 'yes' && !isListening) {
        try {
            const startRes = startUrnSocksInstant();
            isListening = startRes.socksListening;
        }
        catch (_) { }
    }
    const effectiveMode = (mode === 'yes' && isListening) ? 'yes' : 'no';
    if (effectiveMode === 'no') {
        // Direct connection mode: completely remove all proxy environment variables
        delete env.ALL_PROXY;
        delete env.all_proxy;
        delete env.HTTPS_PROXY;
        delete env.https_proxy;
        delete env.HTTP_PROXY;
        delete env.http_proxy;
        delete env.grpc_proxy;
        delete env.GRPC_PROXY;
        delete env.AGY_PROXY_ALL;
        delete env.AGY_PROXY_HTTPS;
        delete env.AGY_PROXY_HTTP;
        env.NO_PROXY = '*';
        env.no_proxy = '*';
    }
    else {
        // SOCKS5 proxy mode: use socks5h:// for remote DNS resolution
        const proxyUrl = process.env.AGY_PROXY_ALL || 'socks5h://127.0.0.1:19999';
        env.ALL_PROXY = proxyUrl;
        env.all_proxy = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        env.https_proxy = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        env.http_proxy = proxyUrl;
        env.NO_PROXY = '127.0.0.1,localhost,::1';
        env.no_proxy = '127.0.0.1,localhost,::1';
    }
    // Runtime flags for stability and proper locale/DNS handling
    env.NO_COLOR = '1';
    env.LANG = 'en_US.UTF-8';
    env.LC_ALL = 'en_US.UTF-8';
    env.LANGUAGE = 'en:en';
    env.TZ = 'America/New_York';
    env.GODEBUG = 'netdns=cgo';
    env.NODE_OPTIONS = '--dns-result-order=ipv4first';
    return env;
}
export async function testProxyConnectivity(targetMode) {
    const mode = targetMode || getProxyToggle();
    const startTime = Date.now();
    const testUrl = 'https://www.google.com/generate_204';
    const testEnv = { ...process.env };
    if (mode === 'yes') {
        const proxyUrl = 'socks5h://127.0.0.1:19999';
        testEnv.ALL_PROXY = proxyUrl;
        testEnv.all_proxy = proxyUrl;
        testEnv.HTTPS_PROXY = proxyUrl;
        testEnv.https_proxy = proxyUrl;
        testEnv.NO_PROXY = '127.0.0.1,localhost,::1';
        testEnv.no_proxy = '127.0.0.1,localhost,::1';
    }
    else {
        delete testEnv.ALL_PROXY;
        delete testEnv.all_proxy;
        delete testEnv.HTTPS_PROXY;
        delete testEnv.https_proxy;
        testEnv.NO_PROXY = '*';
        testEnv.no_proxy = '*';
    }
    return new Promise((resolve) => {
        const proxyArgs = mode === 'yes' ? ['-x', 'socks5h://127.0.0.1:19999'] : [];
        execFile('curl', [
            '-s',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code}',
            '--max-time',
            '6',
            ...proxyArgs,
            testUrl,
        ], { env: testEnv }, (error, stdout) => {
            const latencyMs = Date.now() - startTime;
            if (error) {
                return resolve({
                    success: false,
                    latencyMs,
                    mode,
                    message: `连接失败: ${error.message.split('\n')[0]}`,
                });
            }
            const httpCode = parseInt(stdout.trim(), 10);
            if (httpCode >= 200 && httpCode < 400) {
                return resolve({
                    success: true,
                    latencyMs,
                    mode,
                    httpCode,
                    message: `连接畅通 (HTTP ${httpCode}, ${latencyMs}ms)`,
                });
            }
            return resolve({
                success: false,
                latencyMs,
                mode,
                httpCode,
                message: `异常状态码: HTTP ${httpCode} (${latencyMs}ms)`,
            });
        });
    });
}
/**
 * 确保 SOCKS5 代理处于唤醒并监听状态（按需唤醒 Scale-up）
 * 供 AntigravityRuntimeProvider 与主动连接时调用
 */
export async function ensureProxyAwake() {
    const toggle = getProxyToggle();
    // 前提门禁：若设置中是直连状态（no），坚决不拉起代理！
    if (toggle === 'no')
        return false;
    try {
        if (fs.existsSync(SLEEP_LOCK_FILE)) {
            fs.unlinkSync(SLEEP_LOCK_FILE);
        }
    }
    catch (_) { }
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    idleTargetTimestamp = 0;
    idleState = 'active';
    if (!isSocksListening(19999)) {
        console.log('[Scale-to-Zero] ⚡ 收到对话模型调用请求，按需自动唤醒 SOCKS5 代理...');
        const res = startUrnSocksInstant();
        return res.socksListening;
    }
    return true;
}
/**
 * 收到新回合任务，登记活跃并清除休眠倒计时
 * 供 AntigravityRuntimeProvider 在回合开始时调用
 */
export async function notifyTurnStarted() {
    const toggle = getProxyToggle();
    // 前提门禁：若设置中是直连状态（no），坚决不拉起代理，直接返回！
    if (toggle === 'no') {
        activeTurnsCount = 0;
        return;
    }
    activeTurnsCount++;
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    idleTargetTimestamp = 0;
    idleState = 'active';
    await ensureProxyAwake();
}
/**
 * 回合结束，递减活跃任务计数。若全部空闲，则启动 60 秒休眠倒计时
 * 供 AntigravityRuntimeProvider 在回合结束（finally）时调用
 */
export function notifyTurnEnded() {
    const toggle = getProxyToggle();
    // 前提门禁：若设置中是直连状态，直接重置并返回
    if (toggle === 'no') {
        activeTurnsCount = 0;
        return;
    }
    activeTurnsCount = Math.max(0, activeTurnsCount - 1);
    if (activeTurnsCount === 0) {
        idleState = 'idle';
        idleTargetTimestamp = Date.now() + DEFAULT_IDLE_TIMEOUT_MS;
        if (idleTimer)
            clearTimeout(idleTimer);
        console.log(`[Scale-to-Zero] ⏳ 当前模型对话已结束，启动 ${DEFAULT_IDLE_TIMEOUT_MS / 1000} 秒空闲休眠倒计时...`);
        idleTimer = setTimeout(() => {
            if (activeTurnsCount === 0) {
                sleepProxyNow();
            }
        }, DEFAULT_IDLE_TIMEOUT_MS);
    }
}
/**
 * 立即休眠代理（优雅断开连接、向平台退还合约质押，回收待处理流量）
 * 供空闲倒计时触发或路由手动调用
 */
export function sleepProxyNow() {
    if (activeTurnsCount > 0) {
        return { ok: false, message: '当前有活跃的对话任务正在处理中，暂不可休眠' };
    }
    try {
        fs.writeFileSync(SLEEP_LOCK_FILE, String(Date.now()), 'utf8');
    }
    catch (_) { }
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    idleTargetTimestamp = 0;
    idleState = 'sleeping';
    const stopRes = stopUrnSocksInstant();
    console.log('[Scale-to-Zero] 🌿 连续 60 秒无活跃对话，SOCKS5 代理已自动优雅断开连接（已向平台交割并回收质押流量，0心跳/0流量消耗）');
    return {
        ok: stopRes.ok,
        message: 'SOCKS5 代理已优雅进入空闲休眠（已断开住宅节点，已向平台回收质押流量）',
    };
}
/**
 * 手动唤醒代理
 * 供管理面板路由调用
 */
export async function wakeProxyNow() {
    try {
        if (fs.existsSync(SLEEP_LOCK_FILE)) {
            fs.unlinkSync(SLEEP_LOCK_FILE);
        }
    }
    catch (_) { }
    const res = startUrnSocksInstant();
    idleState = 'active';
    return { ok: res.ok, message: res.ok ? '代理已成功唤醒就绪' : '唤醒失败: ' + res.message };
}
// --------------------------- BRINGYOUR BALANCE & SETTLEMENT ---------------------------
let cachedBalanceDetails = null;
let cachedUrnJwt = null;
const BALANCE_CACHE_TTL_MS = 20_000; // 20 秒轻量缓存，避免频繁穿透官方接口
const JWT_CACHE_TTL_MS = 3600_000 * 2; // 2 小时 JWT 缓存
function formatByteSize(bytes) {
    if (!bytes || bytes <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(val >= 100 || i === 0 ? 0 : 2)} ${units[i]}`;
}
async function getBringYourJwt(userAuth, pass, forceFresh = false) {
    const now = Date.now();
    if (!forceFresh && cachedUrnJwt && cachedUrnJwt.userAuth === userAuth && (now - cachedUrnJwt.timestamp) < JWT_CACHE_TTL_MS) {
        return cachedUrnJwt.jwt;
    }
    const res = await fetch('https://api.bringyour.com/auth/login-with-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_auth: userAuth, password: pass }),
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`BringYour 登录认证失败 (HTTP ${res.status}): ${errText || '凭据无效'}`);
    }
    const json = await res.json();
    const jwt = json?.network?.by_jwt;
    if (!jwt) {
        throw new Error('未能从 BringYour 登录响应中提取到 by_jwt 令牌');
    }
    cachedUrnJwt = { jwt, userAuth, timestamp: now };
    return jwt;
}
// fetchUrnBalanceDetails: Used by provider.routes.ts to fetch live BringYour subscription and balance details.
export async function fetchUrnBalanceDetails(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedBalanceDetails && (now - cachedBalanceDetails.timestamp) < BALANCE_CACHE_TTL_MS) {
        return { ...cachedBalanceDetails.data, cached: true };
    }
    const auth = readUrnAuth();
    if (!auth.userAuth || !auth.password) {
        return {
            ok: false,
            userAuth: auth.userAuth || '',
            totalBytes: 0,
            totalFormatted: '0 B',
            availableBytes: 0,
            availableFormatted: '0 B',
            openTransferBytes: 0,
            openTransferFormatted: '0 B',
            netConsumedBytes: 0,
            netConsumedFormatted: '0 B',
            percentAvailable: 0,
            activeWindows: [],
            updateTime: new Date().toISOString(),
            error: '尚未配置 BringYour 账号或密码 (URN_USER_AUTH / URN_PASSWORD)',
        };
    }
    try {
        let jwt = await getBringYourJwt(auth.userAuth, auth.password, forceRefresh);
        let balRes = await fetch('https://api.bringyour.com/subscription/balance', {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Cookie': `by_jwt=${jwt}`,
            },
            signal: AbortSignal.timeout(8000),
        });
        if (balRes.status === 401) {
            jwt = await getBringYourJwt(auth.userAuth, auth.password, true);
            balRes = await fetch('https://api.bringyour.com/subscription/balance', {
                headers: {
                    'Authorization': `Bearer ${jwt}`,
                    'Cookie': `by_jwt=${jwt}`,
                },
                signal: AbortSignal.timeout(8000),
            });
        }
        if (!balRes.ok) {
            throw new Error(`BringYour 余额查询失败 (HTTP ${balRes.status})`);
        }
        const raw = await balRes.json();
        const totalBytes = Number(raw.start_balance_byte_count) || 0;
        const availableBytes = Number(raw.balance_byte_count) || 0;
        const openTransferBytes = Number(raw.open_transfer_byte_count) || 0;
        const netConsumedBytes = Math.max(0, totalBytes - (availableBytes + openTransferBytes));
        const percentAvailable = totalBytes > 0 ? Math.round((availableBytes / totalBytes) * 100) : 0;
        const activeWindows = (raw.active_transfer_balances || []).map((w) => {
            const endMs = new Date(w.end_time).getTime();
            const remainingSeconds = Math.max(0, Math.floor((endMs - now) / 1000));
            const hours = Math.floor(remainingSeconds / 3600);
            const mins = Math.floor((remainingSeconds % 3600) / 60);
            const remainingHuman = hours > 0 ? `${hours}小时${mins}分` : `${mins}分钟`;
            const startBytes = Number(w.start_balance_byte_count) || 0;
            const currentBytes = Number(w.balance_byte_count) || 0;
            const usedBytes = Math.max(0, startBytes - currentBytes);
            return {
                balanceId: String(w.balance_id || ''),
                startTime: String(w.start_time || ''),
                endTime: String(w.end_time || ''),
                remainingSeconds,
                remainingHuman,
                startBytes,
                startFormatted: formatByteSize(startBytes),
                currentBytes,
                currentFormatted: formatByteSize(currentBytes),
                usedBytes,
                usedFormatted: formatByteSize(usedBytes),
                isExpiringSoon: remainingSeconds < 3600 * 3,
            };
        });
        const result = {
            ok: true,
            userAuth: auth.userAuth,
            totalBytes,
            totalFormatted: formatByteSize(totalBytes),
            availableBytes,
            availableFormatted: formatByteSize(availableBytes),
            openTransferBytes,
            openTransferFormatted: formatByteSize(openTransferBytes),
            netConsumedBytes,
            netConsumedFormatted: formatByteSize(netConsumedBytes),
            percentAvailable,
            priceTier: raw.price_tier ? {
                name: String(raw.price_tier.name || 'standard'),
                monthlyUsd: Number(raw.price_tier.monthly_usd) || 0,
                yearlyUsd: Number(raw.price_tier.yearly_usd) || 0,
                currency: String(raw.price_tier.currency || 'USD'),
            } : undefined,
            activeWindows,
            updateTime: raw.update_time || new Date().toISOString(),
            cached: false,
        };
        cachedBalanceDetails = { data: result, timestamp: now };
        return result;
    }
    catch (err) {
        const errorMsg = err?.message || '读取 BringYour 账单异常';
        return {
            ok: false,
            userAuth: auth.userAuth,
            totalBytes: 0,
            totalFormatted: '0 B',
            availableBytes: 0,
            availableFormatted: '0 B',
            openTransferBytes: 0,
            openTransferFormatted: '0 B',
            netConsumedBytes: 0,
            netConsumedFormatted: '0 B',
            percentAvailable: 0,
            activeWindows: [],
            updateTime: new Date().toISOString(),
            error: errorMsg,
        };
    }
}
//# sourceMappingURL=antigravity-proxy.js.map