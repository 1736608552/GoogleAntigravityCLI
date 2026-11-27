import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
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
                const userAuth = map['URN_USER_AUTH'] || process.env.URN_DEFAULT_USER || '';
                const password = map['URN_PASSWORD'] || process.env.URN_DEFAULT_PASS || '';
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
    };
}
export function writeUrnAuth(vals) {
    const cur = readUrnAuth();
    // 防御性设计：如果传入账号或密码为空，自动保留已有凭据，严防被清空
    const safeUserAuth = (vals.userAuth && vals.userAuth.trim()) ? vals.userAuth.trim() : (cur.userAuth || '');
    const safePassword = (vals.password && vals.password.trim()) ? vals.password.trim() : (cur.password || '');
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
/**
 * 自适应空闲窗口（Scale-to-Zero 的省流与体验是互相拉扯的）。
 * 实测用户是「连续追问 + 偶尔长间歇」：固定 60s 时，断开后 37 秒又被唤醒的情况真实发生过，
 * 那次断开纯属白付一次冷启动。于是让窗口跟着节奏走：
 *   断开后 FAST_REWAKE_MS 内又被唤醒 → 说明还在连续追问 → 窗口翻倍（封顶 MAX）
 *   断开超过 SLOW_REWAKE_MS 才回来        → 说明真的离开了     → 回落到最短
 */
const MAX_IDLE_TIMEOUT_MS = 600_000;
const FAST_REWAKE_MS = 120_000;
const SLOW_REWAKE_MS = 600_000;
/** 预热后一直没发起对话的自动休眠窗口：比正常空闲窗口短，空跑的代价更小 */
const PREWARM_HOLD_MS = 90_000;
/**
 * 唤醒后确认「合约真的可用」的探测上限。
 * 端口 0.5s 就监听，但首个合约中位 4.2s 后才可用——只看端口就是假就绪。
 * 这是一次性探测，绝不是后台轮询（后台 10s Ping 已按用户要求彻底取消，不能死灰复燃）。
 * 上限取 10s：实测合约冷启动中位 4.2s，加上对 Google 的 TLS 握手约 1.6s，8s 余量偏紧。
 * 探测失败也不阻断对话，只是退回「端口监听即放行」的旧行为。
 */
const READY_PROBE_TIMEOUT_MS = 10_000;
const READY_PROBE_HOST = 'www.google.com';
let activeTurnsCount = 0;
let idleTimer = null;
let idleState = 'sleeping';
let idleTargetTimestamp = 0;
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
let lastSleepAt = 0;
let prewarmTimer = null;
let readyWaiter = null;
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
    // 只有在代理正在监听运行时，才从日志中读取实际握手的节点信息
    if (socksListening) {
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
    }
    else {
        // 代理处于智能休眠（0流量消耗）时，出口直接反映当前配置的目标国家，避免被旧历史日志误导
        activeCountry = urn.country || 'United States';
    }
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
        health: getProxyHealthStatus(),
    };
}
export function restartProxy() {
    stopUrnSocksInstant({ skipCloudCleanup: true });
    const toggle = getProxyToggle();
    if (toggle !== 'yes') {
        return {
            ok: false,
            killed: 0,
            message: '当前处于直连模式，请先切换为「🌐 代理」模式后再启动代理',
        };
    }
    const startRes = startUrnSocksInstant();
    return {
        ok: startRes.ok,
        killed: 1,
        message: startRes.message || '已优雅重启 SOCKS5 代理并重新同步最新配置',
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
const URN_SOCKS_BIN = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/urnetwork-socks';
const URN_SOCKS_LOG = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log';
/**
 * 拉起 urnetwork-socks 进程。按需启动、回退启动、换节点三条路径都走这里。
 *
 * 这段启动命令曾被复制三份，改一处漏两处（凭据改环境变量时就漏掉了换节点路径），
 * 所以收拢成唯一入口。
 *
 * 凭据只走环境变量，绝不进命令行：命令行参数会出现在 `ps` 的 argv 里，任何用户都能看到明文密码；
 * 环境变量只有同用户或 root 可读。另外密码里若含 $ ` " 等字符，拼进 shell 字符串还会被错误解析。
 * urnetwork-socks 的 --help 明确支持 env USER_AUTH / PASSWORD，已用假凭据实测确认会被读取。
 */
function spawnUrnSocks(urn, options) {
    const args = [
        `--addr="127.0.0.1:19999"`,
        `--country="${urn.country || 'United States'}"`,
        ...(options?.countryOnly
            ? []
            : [
                urn.region ? `--region="${urn.region}"` : '',
                urn.city ? `--city="${urn.city}"` : '',
                urn.providerId ? `--provider-id="${urn.providerId}"` : '',
            ]),
    ].filter(Boolean).join(' ');
    const env = {
        ...process.env,
        USER_AUTH: urn.userAuth,
        PASSWORD: urn.password,
    };
    exec(`nohup "${URN_SOCKS_BIN}" ${args} >> "${URN_SOCKS_LOG}" 2>&1 &`, { env });
}
export function startUrnSocksInstant() {
    const toggle = getProxyToggle();
    if (toggle === 'no') {
        return { ok: false, message: '当前设置处于直连状态，严禁拉起代理', socksListening: false };
    }
    if (isSocksListening(19999)) {
        startProxyHealthWatchdog();
        return { ok: true, message: 'SOCKS5 代理已在运行中', socksListening: true };
    }
    const urn = readUrnAuth();
    if (!urn.userAuth || !urn.password) {
        return { ok: false, message: '未配置代理账号或密码', socksListening: false };
    }
    if (!fs.existsSync(URN_SOCKS_BIN)) {
        return { ok: false, message: '代理核心程序不存在', socksListening: false };
    }
    try {
        spawnUrnSocks(urn);
        // 毫秒级轮询等待端口就绪（最多等待 3 秒）
        const start = Date.now();
        while (Date.now() - start < 3000) {
            if (isSocksListening(19999)) {
                startProxyHealthWatchdog();
                return { ok: true, message: 'SOCKS5 代理已按需瞬间启动', socksListening: true };
            }
            execFileSync('sleep', ['0.15']);
        }
        // 若锁定单节点导致连接超时，自动回退到国家级智能选点重试，提高稳定性
        if (urn.providerId) {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
            spawnUrnSocks(urn, { countryOnly: true });
            const retryStart = Date.now();
            while (Date.now() - retryStart < 3000) {
                if (isSocksListening(19999)) {
                    startProxyHealthWatchdog();
                    return { ok: true, message: '已自动切换至同区优选节点并启动代理', socksListening: true };
                }
                execFileSync('sleep', ['0.15']);
            }
        }
    }
    catch (err) {
        return { ok: false, message: '启动代理异常: ' + (err?.message || '未知错误'), socksListening: false };
    }
    const listening = isSocksListening(19999);
    if (listening) {
        startProxyHealthWatchdog();
    }
    return { ok: listening, message: listening ? 'SOCKS5 代理已按需启动' : '代理启动中...', socksListening: listening };
}
/**
 * 经本地 SOCKS5 做一次 CONNECT + TLS 握手，用来判断「合约是否真的可用」。
 *
 * 为什么 CONNECT 成功就等于合约可用：端口监听后，SOCKS 会收下 CONNECT 请求并在内部等合约
 * （最长 30s），合约建好才回成功。所以这一步成功，等价于出口传输已就绪。
 * 只握手、不发 HTTP 请求，每次唤醒只有几 KB，不是流量负担。
 */
function probeSocksTlsOnce(host, port, timeoutMs, socksPort = 19999) {
    return new Promise((resolve) => {
        const started = Date.now();
        let settled = false;
        let stage = 'greeting';
        let raw;
        let secure = null;
        let timer = null;
        const finish = (ok, reason) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            if (secure)
                secure.destroy();
            raw.destroy();
            resolve({ ok, ms: Date.now() - started, reason });
        };
        const onError = (e) => finish(false, String(e?.code || e?.message || 'socket error'));
        const onClose = () => finish(false, stage === 'tls' ? 'TLS 阶段连接被关闭' : '连接提前关闭');
        const onData = (chunk) => {
            if (stage === 'greeting') {
                if (chunk.length < 2 || chunk[0] !== 0x05)
                    return finish(false, '非 SOCKS5 响应');
                if (chunk[1] !== 0x00)
                    return finish(false, 'SOCKS5 要求认证');
                stage = 'request';
                const hostBuf = Buffer.from(host, 'utf8');
                // VER=5 CMD=CONNECT RSV=0 ATYP=DOMAINNAME
                raw.write(Buffer.concat([
                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                    hostBuf,
                    Buffer.from([port >> 8, port & 0xff]),
                ]));
                return;
            }
            if (stage === 'request') {
                if (chunk.length < 2)
                    return;
                if (chunk[1] !== 0x00)
                    return finish(false, `SOCKS5 CONNECT 被拒绝(code=${chunk[1]})`);
                stage = 'tls';
                // 升级为 TLS 后数据归 TLS 层，必须摘掉 raw 上的监听，否则会和 TLS 层抢数据
                raw.removeListener('data', onData);
                raw.removeListener('error', onError);
                raw.removeListener('close', onClose);
                secure = tls.connect({ socket: raw, servername: host }, () => finish(true, 'TLS 握手成功'));
                secure.on('error', (e) => finish(false, `TLS: ${e?.code || e?.message || 'error'}`));
            }
        };
        try {
            raw = net.connect({ host: '127.0.0.1', port: socksPort });
        }
        catch (e) {
            return resolve({ ok: false, ms: 0, reason: e?.message || 'connect 失败' });
        }
        raw.setTimeout(timeoutMs, () => finish(false, '等待超时'));
        raw.on('error', onError);
        raw.on('close', onClose);
        raw.on('data', onData);
        raw.on('connect', () => raw.write(Buffer.from([0x05, 0x01, 0x00]))); // 无认证
        timer = setTimeout(() => finish(false, '等待超时'), timeoutMs);
    });
}
/**
 * 等到代理「真的可用」为止，上限 READY_PROBE_TIMEOUT_MS。
 * 并发调用共享同一次探测，避免多个回合同时唤醒时重复握手。
 */
export async function waitSocksReady(timeoutMs = READY_PROBE_TIMEOUT_MS, socksPort = 19999) {
    if (!isSocksListening(socksPort))
        return { ok: false, ms: 0, reason: '端口未监听' };
    if (readyWaiter)
        return readyWaiter;
    readyWaiter = probeSocksTlsOnce(READY_PROBE_HOST, 443, timeoutMs, socksPort).finally(() => {
        readyWaiter = null;
    });
    return readyWaiter;
}
function clearPrewarmTimer() {
    if (prewarmTimer) {
        clearTimeout(prewarmTimer);
        prewarmTimer = null;
    }
}
/**
 * 预热后 PREWARM_HOLD_MS 内没发起对话就自动休眠。
 * 这就是「预热不会比现在更费」的保证：空跑的存活时间比正常空闲窗口还短。
 */
function armPrewarmExpiry() {
    clearPrewarmTimer();
    // 对外状态与普通空闲期保持一致：面板上照常显示「空闲 + 剩余秒数」，不会出现「在运行却显示休眠」
    idleState = 'idle';
    idleTargetTimestamp = Date.now() + PREWARM_HOLD_MS;
    prewarmTimer = setTimeout(() => {
        prewarmTimer = null;
        if (activeTurnsCount === 0) {
            console.log(`[Scale-to-Zero] 🌿 预热后 ${PREWARM_HOLD_MS / 1000} 秒内未发起对话，代理自动休眠`);
            sleepProxyNow();
        }
    }, PREWARM_HOLD_MS);
}
/** 每次从休眠中被唤醒时调用，按「断开了多久才回来」调整空闲窗口 */
function noteProxyWake() {
    if (!lastSleepAt)
        return;
    const gap = Date.now() - lastSleepAt;
    const before = idleTimeoutMs;
    if (gap < FAST_REWAKE_MS) {
        idleTimeoutMs = Math.min(idleTimeoutMs * 2, MAX_IDLE_TIMEOUT_MS);
    }
    else if (gap > SLOW_REWAKE_MS) {
        idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
    }
    lastSleepAt = 0;
    if (idleTimeoutMs !== before) {
        console.log(`[Scale-to-Zero] 📈 空闲窗口自适应：${before / 1000}s → ${idleTimeoutMs / 1000}s（距上次休眠 ${Math.round(gap / 1000)}s）`);
    }
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
export function stopUrnSocksInstant(options) {
    stopProxyHealthWatchdog();
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
        // 4. 仅在非立即重启场景下，再延迟核查清理云端挂起设备（若期间已有新进程监听则绝不误删）
        if (!options?.skipCloudCleanup) {
            setTimeout(() => {
                if (!isSocksListening(19999)) {
                    cleanupCloudSocksClients().catch(() => { });
                }
            }, 1500);
        }
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
            if (isSocksListening(19999)) {
                startProxyHealthWatchdog();
            }
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
// --------------------------- URNETWORK WATCHDOG & AUTO-HEALING ---------------------------
let proxyHealthWatchdogTimer = null;
let isHealthCheckingOrRotating = false;
export const proxyHealthState = {
    lastCheckTime: 0,
    healthy: false,
    latencyMs: 0,
    message: '按需连接 (已取消后台10s自动Ping省流)',
    rotateCount: 0,
    lastRotatedTime: 0,
    watchdogActive: false,
    isRotating: false,
};
export function getProxyHealthStatus() {
    const listening = isSocksListening(19999);
    return {
        ...proxyHealthState,
        watchdogActive: false, // 遵循专有通道隔离与节流守则，已取消 10s 后台轮询 Ping
        healthy: listening && (proxyHealthState.healthy || proxyHealthState.lastCheckTime === 0),
    };
}
/**
 * 发现不通马上换 IP，并且更换节点后立马 ping 验证是否通，直到连通或重试达到上限
 */
export async function rotateNodeAndVerify(maxAttempts = 5) {
    if (proxyHealthState.isRotating) {
        console.log('[URnetwork Watchdog] 🔄 当前已有节点轮换任务在执行中，避免重复触发');
        return false;
    }
    proxyHealthState.isRotating = true;
    proxyHealthState.healthy = false;
    console.warn(`[URnetwork Watchdog] ⚠️ 发现当前 IP 不通或触发轮换，立即执行节点轮换切换出口 IP...`);
    try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            proxyHealthState.rotateCount++;
            proxyHealthState.lastRotatedTime = Date.now();
            console.log(`[URnetwork Watchdog] 🔄 [换IP 第 ${attempt}/${maxAttempts} 次] 正在终止旧会话并重连新住宅节点...`);
            // 1. 强制杀死旧的 urnetwork-socks 进程，确保彻底断开旧的节点链路
            try {
                let pids = [];
                try {
                    const out = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
                    pids = out.trim().split('\n').filter(Boolean).map(Number);
                }
                catch (_) { }
                for (const pid of pids) {
                    try {
                        process.kill(pid, 'SIGKILL');
                    }
                    catch (_) { }
                }
            }
            catch (_) { }
            // 等待云端彻底注销旧设备后再启动新进程，防止异步竞态误杀新 clientID 触发 401
            await cleanupCloudSocksClients().catch(() => { });
            // 等待 150ms 端口释放
            await new Promise((r) => setTimeout(r, 150));
            // 2. 重新拉起 SOCKS5 代理进程分配全新节点
            const urn = readUrnAuth();
            spawnUrnSocks(urn);
            // 3. 轮询等待端口就绪（最多等待 3.5 秒）
            let ready = false;
            const startWait = Date.now();
            while (Date.now() - startWait < 3500) {
                if (isSocksListening(19999)) {
                    ready = true;
                    break;
                }
                await new Promise((r) => setTimeout(r, 100));
            }
            if (!ready) {
                console.warn(`[URnetwork Watchdog] ⚠️ 第 ${attempt} 次换节点后端口未能及时就绪，继续尝试轮换...`);
                continue;
            }
            // 等待 250ms 让 BringYour P2P 住宅网络握手就绪
            await new Promise((r) => setTimeout(r, 250));
            // 4. 【核心要求：更换节点立马要 ping 是否通】
            console.log(`[URnetwork Watchdog] ⚡ 新节点已启动，立即（0延迟）执行连通性 Ping 验证...`);
            const pingRes = await testProxyConnectivity('yes');
            proxyHealthState.lastCheckTime = Date.now();
            proxyHealthState.latencyMs = pingRes.latencyMs;
            proxyHealthState.message = pingRes.message;
            if (pingRes.success) {
                proxyHealthState.healthy = true;
                console.log(`[URnetwork Watchdog] ✅ 节点切换成功且验证通畅！新 IP 延迟: ${pingRes.latencyMs}ms (${pingRes.message})`);
                return true;
            }
            else {
                console.warn(`[URnetwork Watchdog] ❌ 第 ${attempt} 次换节点后 Ping 验证仍未通 (${pingRes.message}, ${pingRes.latencyMs}ms)，立即更换下一个节点！`);
            }
        }
        console.error(`[URnetwork Watchdog] 🚨 已连续尝试 ${maxAttempts} 次换节点，未能获得通畅 IP`);
        return false;
    }
    finally {
        proxyHealthState.isRotating = false;
    }
}
/**
 * 启动代理探活看门狗（已根据用户要求彻底取消 10s 后台轮询 Ping，杜绝无谓的节点握手和流量消耗）
 * 保持函数兼容，仅做状态重置，绝不拉起后台定时 Ping 循环
 */
export function startProxyHealthWatchdog() {
    if (proxyHealthWatchdogTimer) {
        clearInterval(proxyHealthWatchdogTimer);
        proxyHealthWatchdogTimer = null;
    }
    proxyHealthState.watchdogActive = false;
    // 已按需静默，彻底取消后台 10s 定时 Ping
}
/**
 * 停止代理探活看门狗（休眠或直连时停止，零消耗）
 */
export function stopProxyHealthWatchdog() {
    if (proxyHealthWatchdogTimer) {
        clearInterval(proxyHealthWatchdogTimer);
        proxyHealthWatchdogTimer = null;
    }
    proxyHealthState.watchdogActive = false;
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
    clearPrewarmTimer();
    idleTargetTimestamp = 0;
    idleState = 'active';
    if (!isSocksListening(19999)) {
        console.log('[Scale-to-Zero] ⚡ 收到对话模型调用请求，按需自动唤醒 SOCKS5 代理...');
        const res = startUrnSocksInstant();
        if (res.socksListening) {
            startProxyHealthWatchdog();
            noteProxyWake();
            // 端口监听 ≠ 可用：再等合约真正建立，放行后首请求才不会卡在 30 秒的合约等待上
            const ready = await waitSocksReady();
            if (ready.ok) {
                console.log(`[Scale-to-Zero] ✅ 代理已就绪（合约可用，耗时 ${ready.ms}ms）`);
            }
            else {
                // 探测失败不阻断对话：行为退回到「端口监听即放行」，由 CLI 侧自行等合约
                console.warn(`[Scale-to-Zero] ⚠️ 代理端口已监听，但 ${READY_PROBE_TIMEOUT_MS / 1000}s 内合约未就绪（${ready.reason}），先放行`);
            }
        }
        return res.socksListening;
    }
    startProxyHealthWatchdog();
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
 * 回合结束，递减活跃任务计数。若全部空闲，则启动休眠倒计时
 * 倒计时长短不是固定值，而是跟着使用节奏自适应（见 noteProxyWake）
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
        idleTargetTimestamp = Date.now() + idleTimeoutMs;
        if (idleTimer)
            clearTimeout(idleTimer);
        console.log(`[Scale-to-Zero] ⏳ 当前模型对话已结束，启动 ${idleTimeoutMs / 1000} 秒空闲休眠倒计时...`);
        idleTimer = setTimeout(() => {
            if (activeTurnsCount === 0) {
                sleepProxyNow();
            }
        }, idleTimeoutMs);
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
    clearPrewarmTimer();
    idleTargetTimestamp = 0;
    idleState = 'sleeping';
    const stopRes = stopUrnSocksInstant();
    // 只有真的睡下了才记时间：ok 的语义是「端口已不再监听」
    if (stopRes.ok) {
        lastSleepAt = Date.now();
    }
    console.log('[Scale-to-Zero] 🌿 SOCKS5 代理已优雅断开连接（已向平台交割并回收质押流量，0心跳/0流量消耗）');
    return {
        ok: stopRes.ok,
        message: 'SOCKS5 代理已优雅进入空闲休眠（已断开住宅节点，已向平台回收质押流量）',
    };
}
/**
 * 预热：用户刚在输入框开始打字，就提前把代理拉起来。
 *
 * 为什么值得做：冷启动（进程启动 → 首个合约可用）中位 4.2s。原来是点了发送才唤醒，
 * 这 4.2s 全算在用户的等待里；提前到开始打字，就被打字的时间盖住了。
 *
 * 为什么不会更费：
 *  - 预热后 PREWARM_HOLD_MS 内没发起对话 → 自动休眠，窗口比正常空闲窗口还短；
 *  - 代理已在运行时，只是把「空闲倒计时」换成同长度的预热窗口，总存活时间不变。
 */
export async function prewarmProxy() {
    if (getProxyToggle() === 'no') {
        return { ok: false, message: '当前为直连模式，无需预热', socksListening: false };
    }
    try {
        if (fs.existsSync(SLEEP_LOCK_FILE))
            fs.unlinkSync(SLEEP_LOCK_FILE);
    }
    catch (_) { }
    if (!isSocksListening(19999)) {
        if (activeTurnsCount > 0) {
            return { ok: true, message: '已有对话在进行', socksListening: true };
        }
        console.log('[Scale-to-Zero] ⌨️ 用户开始输入，提前预热 SOCKS5 代理...');
        const res = startUrnSocksInstant();
        if (!res.socksListening) {
            return { ok: false, message: res.message || '代理启动中...', socksListening: false };
        }
        startProxyHealthWatchdog();
        noteProxyWake();
        armPrewarmExpiry();
        // 不等就绪（打字的人不需要等），后台观测一次只为了在日志里留下冷启动耗时
        waitSocksReady().then((r) => {
            if (r.ok) {
                console.log(`[Scale-to-Zero] ✅ 预热完成（合约可用，耗时 ${r.ms}ms），用户发出消息时无需再等`);
            }
        });
        return { ok: true, message: '代理预热中', socksListening: true };
    }
    // 代理已在运行。若正处在空闲倒计时的尾巴上，用户这一打字很可能紧接着就点发送，
    // 倒计时一到期就会把代理断掉——正好卡在用户要用的那一刻。此时改由预热窗口接管。
    // 剩余时间比预热窗口还长的不动它，避免反而缩短。
    if (activeTurnsCount === 0 && idleTimer) {
        const remaining = idleTargetTimestamp - Date.now();
        if (remaining <= PREWARM_HOLD_MS) {
            clearTimeout(idleTimer);
            idleTimer = null;
            armPrewarmExpiry();
            console.log('[Scale-to-Zero] ⌨️ 用户开始输入，空闲休眠倒计时改由预热窗口接管');
        }
    }
    return { ok: true, message: '代理已在运行', socksListening: true };
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
    if (res.ok) {
        startProxyHealthWatchdog();
    }
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