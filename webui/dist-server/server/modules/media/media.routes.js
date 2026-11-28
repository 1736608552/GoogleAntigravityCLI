import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
const router = express.Router();
const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
};
const BLOCKED_PATTERNS = [
    /\/\.ssh(\/|$)/i,
    /\/\.env(\.|$)/i,
    /auth\.db/i,
    /token\.json/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\/etc\/shadow/i,
    /\/etc\/passwd/i,
];
/**
 * 规范化并清洗用户请求的本地路径
 */
function normalizeMediaPath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string')
        return null;
    let cleaned = rawPath.trim();
    // 去除 file:/// 前缀
    if (cleaned.startsWith('file://')) {
        cleaned = cleaned.replace(/^file:\/\//, '');
    }
    // 解码 URI 组件
    try {
        cleaned = decodeURIComponent(cleaned);
    }
    catch (_) { }
    // 去除可能的首尾引号
    cleaned = cleaned.replace(/^["'`]|["'`]$/g, '').trim();
    if (!cleaned)
        return null;
    const resolved = path.resolve(cleaned);
    // 安全检查：拦截敏感文件
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(resolved)) {
            return null;
        }
    }
    return resolved;
}
/**
 * GET /api/media/file?path=<absolute_path>
 * GET /api/media/view?path=<absolute_path>
 * 提供聊天框、Markdown、Generative UI 中本地生成的图片与内联组件静态访问
 */
const handleMediaRequest = (req, res) => {
    const rawPath = String(req.query.path || req.query.uri || req.query.src || '');
    if (!rawPath) {
        return res.status(400).json({ error: 'Missing path parameter' });
    }
    const resolvedPath = normalizeMediaPath(rawPath);
    if (!resolvedPath) {
        return res.status(403).json({ error: 'Access denied: sensitive or invalid file path' });
    }
    fs.stat(resolvedPath, (err, stats) => {
        if (err || !stats.isFile()) {
            return res.status(404).json({ error: 'Media file not found' });
        }
        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Access-Control-Allow-Origin', '*');
        // 允许在前端同源或嵌入环境中作为 iframe 渲染 HTML
        if (ext === '.html' || ext === '.htm') {
            res.removeHeader('X-Frame-Options');
        }
        const rangeHeader = req.headers.range;
        if (rangeHeader && stats.size > 0) {
            const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
            if (!match) {
                res.setHeader('Content-Range', `bytes */${stats.size}`);
                return res.status(416).end();
            }
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2] ? Math.min(Number.parseInt(match[2], 10), stats.size - 1) : stats.size - 1;
            if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
                res.setHeader('Content-Range', `bytes */${stats.size}`);
                return res.status(416).end();
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            res.setHeader('Content-Length', end - start + 1);
            const stream = fs.createReadStream(resolvedPath, { start, end });
            stream.pipe(res);
            stream.on('error', (streamErr) => {
                console.error('[MediaRoute] Range stream error:', streamErr);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming media' });
                }
            });
            return;
        }
        res.setHeader('Content-Length', stats.size);
        const stream = fs.createReadStream(resolvedPath);
        stream.pipe(res);
        stream.on('error', (streamErr) => {
            console.error('[MediaRoute] Stream error:', streamErr);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error streaming media' });
            }
        });
    });
};
router.get('/file', handleMediaRequest);
router.get('/view', handleMediaRequest);
router.get('/embed', handleMediaRequest);
export default router;
export const mediaRoutes = router;
//# sourceMappingURL=media.routes.js.map