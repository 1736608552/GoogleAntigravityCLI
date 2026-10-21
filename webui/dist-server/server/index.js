#!/usr/bin/env node
// Load environment variables before other imports execute.
import './load-env.js';
import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dns from 'node:dns';
import zlib from 'node:zlib';
try {
    dns.setDefaultResultOrder('ipv4first');
}
catch (_) { }
import { AppError, findApplicationRoot, getModuleDirectory, IS_PLATFORM, terminalTextStyles } from './shared/utils.js';
import { closeSessionsWatcher, initializeSessionsWatcher, providerRuntimeService, } from './modules/providers/index.js';
import { createWebSocketServer } from './modules/websocket/index.js';
import { getConnectableHost } from '../shared/networkHosts.js';
import { createGitModule } from './modules/git/index.js';
import { authenticateToken, authenticateWebSocket, authRoutes, validateApiKey, } from './modules/auth/index.js';
import { taskmasterRoutes } from './modules/taskmaster/index.js';
import { commandsRoutes } from './modules/commands/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import { createSystemModule } from './modules/system/index.js';
import { createAgentModule } from './modules/agent/index.js';
import projectModuleRoutes from './modules/projects/projects.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import { userRoutes } from './modules/user/index.js';
import { getPluginPort, pluginsRoutes, startEnabledPluginServers, stopAllPlugins, } from './modules/plugins/index.js';
import providerRoutes from './modules/providers/provider.routes.js';
import { voiceRoutes } from './modules/voice/index.js';
import { closeScheduledMessageDispatcher, initializeScheduledMessageDispatcher, scheduledMessagesRoutes, } from './modules/scheduled-messages/index.js';
import browserUseRoutes from './modules/browser-use/browser-use.routes.js';
import { assetsRoutes } from './modules/assets/index.js';
import { mediaRoutes } from './modules/media/index.js';
import { fileTreeRoutes } from './modules/file-tree/index.js';
import { worktreesRoutes } from './modules/worktrees/index.js';
import browserUseMcpRoutes from './modules/browser-use/browser-use-mcp.routes.js';
import { browserUseService } from './modules/browser-use/browser-use.service.js';
import { initializeDatabase, sessionsDb } from './modules/database/index.js';
import { configureWebPush } from './modules/notifications/index.js';
const __dirname = getModuleDirectory(import.meta.url);
// The server source runs from /server, while the compiled output runs from /dist-server/server.
// Resolving the app root once keeps every repo-level lookup below aligned across both layouts.
const APP_ROOT = findApplicationRoot(__dirname);
const installMode = fs.existsSync(path.join(APP_ROOT, '.git')) ? 'git' : 'npm';
// Version of the code that is actually running, captured once at process
// startup. This intentionally does NOT re-read package.json per request: after
// an update replaces the files on disk, package.json reflects the NEW version
// while this long-lived process still runs the OLD code. The frontend bundle is
// rebuilt on update, so a mismatch between this value and the frontend's
// build-time version means the server was updated but not restarted.
const RUNNING_VERSION = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || null;
    }
    catch {
        return null;
    }
})();
const systemRoutes = createSystemModule({
    appRoot: APP_ROOT,
    installMode,
    isPlatform: IS_PLATFORM,
});
console.log('SERVER_PORT from env:', process.env.SERVER_PORT);
const app = express();
const server = http.createServer(app);
const queryClaude = providerRuntimeService.getRunner('claude');
const queryCursor = providerRuntimeService.getRunner('cursor');
const queryCodex = providerRuntimeService.getRunner('codex');
const queryOpenCode = providerRuntimeService.getRunner('opencode');
const queryAntigravity = providerRuntimeService.getRunner('antigravity');
const gitRoutes = createGitModule({
    queryClaude,
    queryCursor,
    queryAntigravity,
});
const agentRoutes = createAgentModule({
    queryClaude,
    queryCursor,
    queryCodex,
    queryOpenCode,
    queryAntigravity,
});
// Single WebSocket server that handles chat, shell, and plugin proxy paths.
createWebSocketServer(server, {
    verifyClient: {
        isPlatform: IS_PLATFORM,
        authenticateWebSocket,
    },
    chat: {
        runtime: providerRuntimeService,
    },
    shell: {
        resolveProviderSessionId: (sessionId, provider) => {
            const dbSession = sessionsDb.getSessionById(sessionId);
            if (dbSession) {
                return dbSession.provider_session_id ?? null;
            }
            return null;
        },
    },
    getPluginPort,
});
app.use(cors({ exposedHeaders: ['X-Refreshed-Token', 'X-Auth-Error'] }));
// Automatic gzip compression for HTML, JSON and text responses larger than 1KB
app.use((req, res, next) => {
    const acceptEncoding = req.header('Accept-Encoding') || '';
    if (!acceptEncoding.includes('gzip') || req.method === 'HEAD') {
        return next();
    }
    const originalSend = res.send.bind(res);
    res.send = (body) => {
        if (res.getHeader('Content-Encoding') ||
            res.statusCode < 200 ||
            res.statusCode >= 300) {
            return originalSend(body);
        }
        let buffer = null;
        if (typeof body === 'string') {
            buffer = Buffer.from(body, 'utf8');
        }
        else if (Buffer.isBuffer(body)) {
            buffer = body;
        }
        if (buffer && buffer.length > 1024) {
            try {
                const compressed = zlib.gzipSync(buffer, { level: 6 });
                res.setHeader('Content-Encoding', 'gzip');
                res.setHeader('Vary', 'Accept-Encoding');
                res.removeHeader('Content-Length');
                return originalSend(compressed);
            }
            catch (_) {
                return originalSend(body);
            }
        }
        return originalSend(body);
    };
    next();
});
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode,
        version: RUNNING_VERSION
    });
});
// Public Google Antigravity account avatar proxy (with caching)
app.get('/api/antigravity-avatar/:email', async (req, res) => {
    try {
        const rawEmail = req.params.email;
        const email = typeof rawEmail === 'string' ? decodeURIComponent(rawEmail).trim() : '';
        if (!email) {
            return res.status(400).send('Email is required');
        }
        const { antigravityAccountsService } = await import('./modules/providers/list/antigravity/antigravity-accounts.service.js');
        const avatar = await antigravityAccountsService.getAccountAvatar(email);
        if (!avatar) {
            return res.status(404).send('Avatar not found');
        }
        res.setHeader('Content-Type', avatar.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.send(avatar.buffer);
    }
    catch (err) {
        return res.status(500).send(err?.message || 'Failed to fetch avatar');
    }
});
// Google Antigravity live user quota endpoint
app.get('/api/antigravity-accounts/quota', async (req, res) => {
    try {
        const { antigravityAccountsService } = await import('./modules/providers/list/antigravity/antigravity-accounts.service.js');
        const model = req.query.model || '';
        const force = req.query.force === 'true' || req.query.force === '1';
        const quota = await antigravityAccountsService.getTurnQuotaSnapshot(model, undefined, undefined, force);
        if (!quota) {
            return res.status(503).json({ ok: false, error: 'Quota service unavailable or no active account' });
        }
        return res.json({ ok: true, quota });
    }
    catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch quota' });
    }
});
// Proxy mode toggle (direct vs proxy)
app.get('/api/system/proxy-toggle', async (_req, res) => {
    const { getProxyToggle } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const mode = getProxyToggle();
    res.json({ success: true, enabled: mode === 'yes', mode });
});
app.post('/api/system/proxy-toggle', async (req, res) => {
    const { mode, enabled } = req.body || {};
    const targetMode = mode != null ? String(mode) : (enabled ? 'yes' : 'no');
    const { setProxyToggle } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const nextMode = setProxyToggle(targetMode);
    res.json({ success: true, enabled: nextMode === 'yes', mode: nextMode });
});
app.all('/api/system/proxy-test', async (req, res) => {
    const mode = req.body?.mode || req.query?.mode;
    const { testProxyConnectivity } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const result = await testProxyConnectivity(mode);
    res.json(result);
});
app.get('/api/proxy/status', async (_req, res) => {
    const { getProxyStatus } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    res.json(getProxyStatus());
});
app.get('/api/proxy/balance', async (req, res) => {
    const { fetchUrnBalanceDetails } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const balance = await fetchUrnBalanceDetails(forceRefresh);
    res.json({ success: true, data: balance });
});
app.get('/api/proxy/locations', async (_req, res) => {
    const { fetchBringYourLocations } = await import('./modules/providers/list/antigravity/bringyour-locations.js');
    const locations = await fetchBringYourLocations();
    const totalProviders = locations.reduce((sum, l) => sum + (l.count || 0), 0);
    res.json({
        ok: true,
        totalCountries: locations.length,
        totalProviders,
        locations,
    });
});
app.post('/api/proxy/restart', async (_req, res) => {
    const { restartProxy } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    res.json(restartProxy());
});
app.get('/api/system/settings', async (_req, res) => {
    const { readUrnAuth, getProxyToggle } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const urn = readUrnAuth();
    const proxyToggle = getProxyToggle();
    res.json({
        webAuth: {
            enabled: true,
            username: 'admin',
            hasPassword: false,
        },
        proxy: {
            enabled: proxyToggle === 'yes',
            mode: proxyToggle,
            userAuth: urn.userAuth,
            hasPassword: Boolean(urn.password),
            country: urn.country,
            region: urn.region,
            city: urn.city,
            providerId: urn.providerId,
            stable: urn.stable,
            privacy: urn.privacy,
            quantum: urn.quantum,
        },
    });
});
app.post('/api/system/settings', async (req, res) => {
    const { proxy } = req.body || {};
    const { writeUrnAuth, setProxyToggle, restartProxy } = await import('./modules/providers/list/antigravity/antigravity-proxy.js');
    const changed = [];
    if (proxy && typeof proxy === 'object') {
        if (proxy.enabled != null || proxy.mode != null) {
            const isEnabled = proxy.mode != null ? (String(proxy.mode).toLowerCase() === 'yes') : Boolean(proxy.enabled);
            const targetMode = isEnabled ? 'yes' : 'no';
            setProxyToggle(targetMode);
            changed.push(`代理模式(${targetMode === 'yes' ? '开启代理' : '直连模式'})`);
        }
        const vals = {};
        if (proxy.userAuth != null)
            vals.userAuth = String(proxy.userAuth).trim();
        if (proxy.password != null && String(proxy.password))
            vals.password = String(proxy.password);
        if (proxy.country != null)
            vals.country = String(proxy.country).trim() || 'United States';
        if (proxy.region != null)
            vals.region = String(proxy.region).trim();
        if (proxy.city != null)
            vals.city = String(proxy.city).trim();
        if (proxy.providerId != null)
            vals.providerId = String(proxy.providerId).trim();
        if (proxy.stable != null)
            vals.stable = Boolean(proxy.stable);
        if (proxy.privacy != null)
            vals.privacy = Boolean(proxy.privacy);
        if (proxy.quantum != null)
            vals.quantum = Boolean(proxy.quantum);
        if (Object.keys(vals).length > 0) {
            writeUrnAuth(vals);
            changed.push('代理凭据/出口节点设置');
        }
        if (proxy.restartImmediately) {
            restartProxy();
            changed.push('已重启 SOCKS5 守护进程');
        }
    }
    res.json({
        ok: true,
        changed,
        message: '已保存: ' + (changed.join('、') || '配置无变更'),
    });
});
// Optional API key validation (if configured)
app.use('/api', validateApiKey);
// Authentication routes (public)
app.use('/api/auth', authRoutes);
// File Tree API Routes (protected)
app.use('/api/file-tree', authenticateToken, fileTreeRoutes);
// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectModuleRoutes);
// Chat attachment upload/serving (global ~/.cloudcli/assets store, protected)
app.use('/api/assets', authenticateToken, assetsRoutes);
// Media streaming API routes (for images & Generative UI embedded in chat)
app.use('/api/media', mediaRoutes);
// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);
// Git worktree management (protected)
app.use('/api/worktrees', authenticateToken, worktreesRoutes);
// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);
// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);
// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);
app.use('/api/system', authenticateToken, systemRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);
// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);
// Plugins API Routes (protected)
app.use('/api/plugins', authenticateToken, pluginsRoutes);
// Browser MCP bridge API (local token protected)
app.use('/api/browser-use-mcp', browserUseMcpRoutes);
// Browser API Routes (protected)
app.use('/api/browser-use', authenticateToken, browserUseRoutes);
// Running sessions endpoint for protection context and activity indicators (public & reliable JSON)
app.get(['/api/running-sessions', '/api/providers/sessions/running'], async (_req, res) => {
    try {
        const { chatRunRegistry } = await import('./modules/websocket/index.js');
        const sessions = chatRunRegistry.listRunningRuns();
        res.json({ ok: true, data: { sessions } });
    }
    catch {
        res.json({ ok: true, data: { sessions: [] } });
    }
});
// Unified provider MCP routes (protected)
app.use('/api/providers', authenticateToken, providerRoutes);
app.use('/api/scheduled-messages', authenticateToken, scheduledMessagesRoutes);
// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);
app.use('/api/voice', authenticateToken, voiceRoutes);
// Serve pre-compressed .gz assets when requested with Accept-Encoding: gzip
// Reduces 3.1MB bundle to 900KB, boosting mobile/remote load speeds by 4-5x
app.get(['*.js', '*.css'], (req, res, next) => {
    const acceptEncoding = req.header('Accept-Encoding') || '';
    if (acceptEncoding.includes('gzip')) {
        const rawUrl = req.path;
        const gzCandidate = path.join(APP_ROOT, 'dist', rawUrl + '.gz');
        if (fs.existsSync(gzCandidate)) {
            const isJs = rawUrl.endsWith('.js');
            res.setHeader('Content-Type', isJs ? 'application/javascript; charset=UTF-8' : 'text/css; charset=UTF-8');
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Vary', 'Accept-Encoding');
            return res.sendFile(gzCandidate);
        }
    }
    next();
});
// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(APP_ROOT, 'dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
        else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));
// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs
// Chat uploads live under /api/assets (server/modules/assets), which stores
// images and general files in the global ~/.cloudcli/assets folder.
// Fallback for stale cached index-*.js asset chunks from client browsers
app.get('/assets/index-*.js', (req, res, next) => {
    const distAssetsDir = path.join(APP_ROOT, 'dist', 'assets');
    const requestedFile = path.basename(req.path);
    const requestedPath = path.join(distAssetsDir, requestedFile);
    if (!fs.existsSync(requestedPath)) {
        try {
            const files = fs.readdirSync(distAssetsDir);
            const activeIndex = files.find(f => f.startsWith('index-') && f.endsWith('.js') && f !== requestedFile);
            if (activeIndex) {
                res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                return res.sendFile(path.join(distAssetsDir, activeIndex));
            }
        }
        catch (_) { }
    }
    next();
});
// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }
    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(APP_ROOT, 'dist', 'index.html');
    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    }
    else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        const redirectHost = getConnectableHost(req.hostname);
        res.redirect(`${req.protocol}://${redirectHost}:${VITE_PORT}`);
    }
});
// global error middleware must be last
app.use((err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
            },
        });
    }
    console.error(err);
    return res.status(500).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        },
    });
});
const SERVER_PORT = Number.parseInt(process.env.SERVER_PORT || '3001', 10);
const HOST = process.env.HOST || '::';
const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;
const LOCAL_SERVER_MARKER_PATH = path.join(os.homedir(), '.cloudcli', 'local-server.json');
function getErrorCode(error) {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }
    return String(error.code);
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function writeLocalServerMarker() {
    const marker = {
        pid: process.pid,
        host: HOST,
        port: Number.parseInt(String(SERVER_PORT), 10),
        url: `http://${DISPLAY_HOST}:${SERVER_PORT}`,
        installMode,
        appRoot: APP_ROOT,
        updatedAt: new Date().toISOString(),
    };
    await fsPromises.mkdir(path.dirname(LOCAL_SERVER_MARKER_PATH), { recursive: true });
    await fsPromises.writeFile(LOCAL_SERVER_MARKER_PATH, JSON.stringify(marker, null, 2), 'utf8');
}
async function removeLocalServerMarker() {
    try {
        const raw = await fsPromises.readFile(LOCAL_SERVER_MARKER_PATH, 'utf8');
        const marker = JSON.parse(raw);
        if (marker.pid && marker.pid !== process.pid)
            return;
    }
    catch (error) {
        if (getErrorCode(error) === 'ENOENT')
            return;
    }
    try {
        await fsPromises.unlink(LOCAL_SERVER_MARKER_PATH);
    }
    catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            console.warn('[WARN] Could not remove local server marker:', getErrorMessage(error));
        }
    }
}
// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();
        // Configure Web Push (VAPID keys)
        configureWebPush();
        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
        const isProduction = fs.existsSync(distIndexPath);
        // Log Claude implementation mode
        console.log(`${terminalTextStyles.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log('');
        if (isProduction) {
            console.log(`${terminalTextStyles.info('[INFO]')} To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);
        }
        console.log(`${terminalTextStyles.info('[INFO]')} To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);
        server.listen(SERVER_PORT, HOST, async () => {
            const appInstallPath = APP_ROOT;
            await writeLocalServerMarker().catch((error) => {
                console.warn('[WARN] Could not write local server marker:', error.message);
            });
            console.log('');
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log(`  ${terminalTextStyles.bright('CloudCLI Server - Ready')}`);
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log('');
            console.log(`${terminalTextStyles.info('[INFO]')} Server URL:  ${terminalTextStyles.bright('http://' + DISPLAY_HOST + ':' + SERVER_PORT)}`);
            console.log(`${terminalTextStyles.info('[INFO]')} Installed at: ${terminalTextStyles.dim(appInstallPath)}`);
            console.log(`${terminalTextStyles.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');
            // Start watching the projects folder for changes
            await initializeSessionsWatcher();
            // Sends anything that came due while the server was not running,
            // then keeps polling.
            initializeScheduledMessageDispatcher(providerRuntimeService);
            // Start server-side plugin processes for enabled plugins
            startEnabledPluginServers().catch(err => {
                console.error('[Plugins] Error during startup:', err.message);
            });
        });
        // Clean up plugin processes on shutdown
        const shutdownRuntimeServices = async () => {
            try {
                await closeSessionsWatcher();
            }
            catch (err) {
                console.error('[Sessions] Error closing sessions watcher during shutdown:', getErrorMessage(err));
            }
            try {
                closeScheduledMessageDispatcher();
            }
            catch (err) {
                console.error('[Scheduler] Error closing dispatcher during shutdown:', getErrorMessage(err));
            }
            try {
                await browserUseService.stopAllSessions();
            }
            catch (err) {
                console.error('[Browser] Error stopping sessions during shutdown:', getErrorMessage(err));
            }
            try {
                await stopAllPlugins();
            }
            catch (err) {
                console.error('[Plugins] Error stopping plugins during shutdown:', getErrorMessage(err));
            }
            try {
                await removeLocalServerMarker();
            }
            catch (err) {
                console.error('[Local Server] Error removing server marker during shutdown:', getErrorMessage(err));
            }
            process.exit(0);
        };
        process.on('SIGTERM', () => void shutdownRuntimeServices());
        process.on('SIGINT', () => void shutdownRuntimeServices());
    }
    catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
//# sourceMappingURL=index.js.map