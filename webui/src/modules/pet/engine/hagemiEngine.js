// Hagemi Web Pet Engine (Native WebUI Integration)
// Based on hagemi-pet-agy by KCFindstr, converted for modern browser ESM

export async function bootHagemi({
  initialSettings = {},
  onPositionChange,
  onSettingsChange,
  onStateChange,
  onError,
} = {}) {
  if (typeof window === 'undefined') return null;

  // 1. 加载骨骼 Landmark 数据
  let rigData;
  try {
    const res = await fetch('/assets/hagemi/rig.json');
    if (!res.ok) throw new Error('Failed to load rig.json: ' + res.status);
    rigData = await res.json();
  } catch (err) {
    console.error('[Hagemi] Failed to load rig data', err);
    onError?.(err);
    return null;
  }

  const HAGEMI = { rigData };

  // 2. 依次注入渲染模块
HAGEMI.MARGIN = 220;
HAGEMI.util = {
  clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (low, high) => low + Math.random() * (high - low),
  smooth(a, b, value) {
    const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },
  gauss: (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)),
};


HAGEMI.css = `
:host { all: initial; }
.stage { position: fixed; left: 0; top: 0; pointer-events: none; will-change: transform; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hit { position: absolute; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.hit:active { cursor: grabbing; }

.bubble {
  position: fixed; left: 0; top: 0; max-width: 220px; min-width: 36px; padding: 7px 11px 8px;
  background: #fffdfb; color: #2a1b3d; border: 2px solid #a78bfa; border-radius: 13px;
  font: 500 12px/1.45 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(46, 24, 104, 0.24); pointer-events: auto; cursor: pointer;
  opacity: 0; visibility: hidden; transition: opacity 0.16s ease, visibility 0.16s; word-break: break-word; white-space: pre-wrap;
}
.bubble.show { opacity: 1; visibility: visible; }
.bubble::after {
  content: ''; position: absolute; width: 11px; height: 11px; background: inherit;
  border-right: 2px solid #a78bfa; border-bottom: 2px solid #a78bfa; left: var(--tail-x, 50%); bottom: -7.5px;
  transform: translateX(-50%) rotate(45deg); border-bottom-right-radius: 3px;
}
.bubble[data-side="right"]::after { left: -7.5px; top: 18px; bottom: auto; transform: rotate(135deg); }
.bubble[data-side="left"]::after { left: auto; right: -7.5px; top: 18px; bottom: auto; transform: rotate(-45deg); }
.mark { color: #8b5cf6; font-weight: 700; margin-right: 4px; }
.mark:empty { display: none; }

.hud {
  position: fixed; left: 0; top: 0; min-width: 200px; padding: 9px 13px; display: grid; gap: 6px;
  background: rgba(22, 14, 44, 0.96); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: #efe9ff; border: 1.5px solid rgba(167, 139, 250, 0.85); border-radius: 12px;
  font: 500 12.5px/1.4 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  box-shadow: 0 10px 32px rgba(8, 3, 24, 0.65); pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.16s ease, visibility 0.16s;
  z-index: 2147483002;
}
.hud.show { opacity: 1 !important; visibility: visible !important; }
.row { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.label { color: #c3b6ee; flex: 0 0 auto; }
.value { margin-left: auto; font-variant-numeric: tabular-nums; }
.meter { flex: 1 1 42px; min-width: 42px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.16); overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 3px; background: #fbbf24; }
.fill[data-tone="warn"] { background: #fb923c; }
.fill[data-tone="bad"] { background: #f43f5e; }

.menu {
  position: fixed; left: 0; top: 0; min-width: 176px; padding: 5px; background: #fffdfb; color: #2a1b3d;
  border: 1px solid #c4b5fd; border-radius: 11px; box-shadow: 0 10px 30px rgba(46, 24, 104, 0.32);
  font: 500 12.5px/1.3 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  pointer-events: auto; display: none;
}
.menu.show { display: block; }
.item { display: block; width: 100%; padding: 6px 10px; border: 0; background: none; color: inherit; font: inherit; text-align: left; border-radius: 7px; cursor: pointer; }
.item:hover, .item:focus-visible { background: #ede9fe; outline: none; }
.divider { height: 1px; margin: 4px 6px; background: #e9e3fb; }

.panel {
  position: fixed; left: 0; top: 0; width: 292px; max-height: min(78vh, 620px); overflow: auto; padding: 10px 13px 13px; display: none;
  background: #fffdfb; color: #2a1b3d; border: 1px solid #c4b5fd; border-radius: 13px; box-shadow: 0 12px 36px rgba(46, 24, 104, 0.34);
  font: 500 12.5px/1.35 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; pointer-events: auto;
}
.panel.show { display: block; }
.panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; margin-bottom: 4px; }
.panel-close { border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; border-radius: 6px; }
.panel-close:hover { background: #ede9fe; }
.panel-section { margin: 11px 0 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: #7c5cd6; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 0; }
.field > span { flex: 1 1 auto; color: #2a1b3d !important; font-weight: 500; }
.field select, .field select option, .field input[type="number"], .field input[type="text"], .field input[type="password"], .field textarea {
  font: inherit; color: #2a1b3d !important; background: #ffffff !important; border: 1px solid #d9cffb; border-radius: 7px; padding: 4px 8px; max-width: 148px;
}
.field select option {
  color: #2a1b3d !important;
  background-color: #ffffff !important;
  font-size: 13px !important;
}
.field input[type="number"] { width: 70px; }
.field input[type="checkbox"] { accent-color: #8b5cf6; width: 17px; height: 17px; cursor: pointer; }
.field textarea { width: 148px; resize: vertical; }
.panel-note { color: #6b5b95; }
.panel-note + .panel-note { margin-top: 5px; }
.panel-link { color: #7c3aed; margin-right: 12px; }
`;


HAGEMI.UI = {
  zhs: {
    talk: '说点什么',
    pat: '摸摸头',
    language_en: 'English',
    language_zhs: '简体中文',
    language_auto: '跟随应用语言',
    size_xs: '小巧便携 (88px)',
    size_s: '舒适微型 (112px)',
    size_m: '标准手办 (138px - 推荐)',
    size_l: '清晰赏玩 (175px)',
    size_xl: '特大展示 (225px)',
    mute: '静音 (不要说话)',
    ai: 'AI 吐槽',
    settings: '设置…',
    hide: '隐藏 1 小时',
    section_licenses: '致谢与许可',
    license_code: '插件代码：MIT 开源协议。',
    license_art: '角色美术：来自 CrossPet，采用 CC BY-NC-SA 4.0 许可。',
    license_inspired: '灵感来自 CrossPet（作者 lokicorvus 及社区贡献者）。',
    license_fan: '非官方同人衍生，与 Google 官方无关。',
    license_link_crosspet: 'GitHub 上的 CrossPet',
    license_link_art: '查看 CC BY-NC-SA 4.0',
    settings_title: '哈基米设置 (Hagemi)',
    close: '关闭',
    section_pet: '桌宠外观与表现',
    section_ai: 'AI 动态吐槽',
    section_usage: '今日用量',
    language: '界面语言',
    size: '显示尺寸',
    animation: '动画流畅度',
    animation_smooth: '高刷流畅 (60fps)',
    animation_balanced: '均衡省电 (30fps)',
    animation_saver: '极简节电 (20fps)',
    chattiness: '吐槽互动频率',
    chattiness_quiet: '安静 (偶尔冒泡)',
    chattiness_normal: '正常 (适度互动)',
    chattiness_chatty: '话痨 (元气活跃)',
    followCursor: '目光视线跟随鼠标/触摸',
    quotaHoverDelayMs: '额度悬停延迟 (毫秒)',
    ai_enabled: '开启 AI 动态吐槽',
    ai_model: '推理模型',
    ai_minIntervalMin: 'AI 吐槽最短间隔 (分钟)',
    ai_maxPerHour: '每小时上限',
    ai_maxPerDay: '每日上限',
    ai_dailyTokenBudget: '每日 Token 预算',
    ai_pauseBelowQuota: '配额低于此值停用 AI (%)',
    ai_contextLevel: '上下文信息级别',
    context_minimal: '仅工具与数字',
    context_titles: '包含会话标题',
    context_snippets: '包含关键代码摘要',
    ai_onlyWhenFocused: '仅在页面激活时',
    ai_personaExtra: '个性化人设补充',
    usage: '今日已调用 {calls} 次，约 {tokens} Token',
    hud_5h: '5小时小鱼干',
    hud_weekly: '周度小鱼干',
    hud_agents: '进行中任务',
    hud_running: '{running} 个进行中',
    hud_subagents: '{running} 个 + {subagents} 个分身',
    hud_idle: '打盹发呆中',
    hud_comments: 'AI 吐槽',
    hud_unavailable: '未连接',
  },
  en: {
    talk: 'Say something',
    pat: 'Pat her head',
    language_en: 'English',
    language_zhs: '简体中文',
    language_auto: 'Follow app language',
    size_xs: 'Pocket (88px)',
    size_s: 'Compact (112px)',
    size_m: 'Standard (138px - Recommended)',
    size_l: 'Play (175px)',
    size_xl: 'Large (225px)',
    mute: 'Mute comments',
    ai: 'AI comments',
    settings: 'Settings…',
    hide: 'Hide for 1 hour',
    section_licenses: 'Credits and licenses',
    license_code: 'Plugin code: MIT.',
    license_art: 'Character art: from CrossPet, CC BY-NC-SA 4.0.',
    license_inspired: 'Inspired by CrossPet.',
    license_fan: 'Unofficial fan project.',
    license_link_crosspet: 'CrossPet on GitHub',
    license_link_art: 'Read CC BY-NC-SA 4.0',
    settings_title: 'Hagemi Settings',
    close: 'Close',
    section_pet: 'Pet Appearance',
    section_ai: 'AI Comments',
    section_usage: 'Usage Today',
    language: 'Language',
    size: 'Size',
    animation: 'Animation',
    animation_smooth: 'Smooth (60fps)',
    animation_balanced: 'Balanced (30fps)',
    animation_saver: 'Battery saver (20fps)',
    chattiness: 'Chattiness',
    chattiness_quiet: 'Quiet (Occasional)',
    chattiness_normal: 'Normal (Moderate)',
    chattiness_chatty: 'Chatty (Very Active)',
    followCursor: 'Watch cursor / touch',
    quotaHoverDelayMs: 'Quota hover delay (ms)',
    ai_enabled: 'Use AI for comments',
    ai_model: 'Model',
    ai_minIntervalMin: 'Minutes between comments',
    ai_maxPerHour: 'Max per hour',
    ai_maxPerDay: 'Max per day',
    ai_dailyTokenBudget: 'Daily token budget',
    ai_pauseBelowQuota: 'Stop AI below quota (%)',
    ai_contextLevel: 'What she can see',
    context_minimal: 'Numbers and tools only',
    context_titles: 'Chat titles included',
    context_snippets: 'Short snippets included',
    ai_onlyWhenFocused: 'Only while window focused',
    ai_personaExtra: 'Extra persona notes',
    usage: '{calls} AI comments, ~{tokens} tokens',
    hud_5h: '5h fish',
    hud_weekly: 'Weekly fish',
    hud_agents: 'Agents',
    hud_running: '{running} running',
    hud_subagents: '{running} + {subagents} subagents',
    hud_idle: 'Napping',
    hud_comments: 'AI comments',
    hud_unavailable: 'Not connected',
  }
};

// Live2D-style puppet for painted art: each pose is one texture on a dense mesh with soft weights
// derived from its landmarks. The art is never redrawn or cut up; it only ever bends.
// Coordinates are pose pixels; every pose stands on the same floor, aligned on her eyes.
HAGEMI.STAGE = { w: 700, h: 640, cx: 350 };

HAGEMI.createRig = function createRig(canvas, onLost) {
  const { clamp, smooth, gauss } = HAGEMI.util;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;
  let destroyed = false;
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (!destroyed) onLost?.(); });

  const { STAGE, MARGIN } = HAGEMI;
  const CELL = 9;

  const program = gl.createProgram();
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  };
  compile(gl.VERTEX_SHADER, `#version 300 es
    in vec2 position; in vec2 uv; uniform mat3 view; out vec2 vUv;
    void main() { vec3 p = view * vec3(position, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); vUv = uv; }`);
  compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; uniform sampler2D tex; uniform float opacity; in vec2 vUv; out vec4 color;
    void main() { color = texture(tex, vUv) * opacity; }`);
  gl.linkProgram(program);
  gl.useProgram(program);
  const uniforms = { view: gl.getUniformLocation(program, 'view'), tex: gl.getUniformLocation(program, 'tex'), opacity: gl.getUniformLocation(program, 'opacity') };
  const attribs = { position: gl.getAttribLocation(program, 'position'), uv: gl.getAttribLocation(program, 'uv') };
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.uniform1i(uniforms.tex, 0);
  // Bitmaps are decoded premultiplied and ignore this; the composited body canvas needs it.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  // 开启高精度各向异性过滤扩展，杜绝高分屏斜角/缩放发虚
  const extAniso = gl.getExtension('EXT_texture_filter_anisotropic') ||
                   gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
                   gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const maxAnisotropy = extAniso ? gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

  function makeTexture(bitmap) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (extAniso && maxAnisotropy > 1) {
      gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAnisotropy));
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  // Coarse alpha grid: culls empty mesh cells and answers "is the cursor on her?".
  function alphaGrid(bitmap) {
    const step = 4, w = Math.ceil(bitmap.width / step), h = Math.ceil(bitmap.height / step);
    const probe = new OffscreenCanvas(w, h);
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const grid = new Uint8Array(w * h);
    for (let i = 0; i < grid.length; i++) grid[i] = data[i * 4 + 3];
    return { grid, w, h, step };
  }
  const alphaAt = (a, x, y) => {
    const gx = Math.floor(x / a.step), gy = Math.floor(y / a.step);
    return gx < 0 || gy < 0 || gx >= a.w || gy >= a.h ? 0 : a.grid[gy * a.w + gx];
  };
  const cellVisible = (a, x, y) => {
    for (let py = y - 2; py <= y + CELL + 2; py += 4) for (let px = x - 2; px <= x + CELL + 2; px += 4) if (alphaAt(a, px, py) > 0) return true;
    return false;
  };

  function offsetFor(name, info) {
    // Edge poses are cut flat along one side: that side sits exactly on the window border.
    if (name.startsWith('edge_left')) return STAGE.cx;
    if (name.startsWith('edge_right')) return STAGE.cx - info.size[0];
    const mid = info.eyes ? (info.eyes[0][0] + info.eyes[1][0]) / 2 : info.size[0] / 2;
    return STAGE.cx - mid;
  }

  // The tail is its own layer, cut along its ink, so swishing it cannot drag the hair beside it.
  // The body texture has the tail and any white pockets around it removed, with a thin seam under
  // the tail so the join stays invisible at rest.
  function bodyTexture(bitmap, cutBitmap, underBitmap, rect) {
    if (!cutBitmap) return makeTexture(bitmap);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutBitmap, rect[0], rect[1]);
    ctx.globalCompositeOperation = 'source-over';
    if (underBitmap) ctx.drawImage(underBitmap, rect[0], rect[1]);
    return makeTexture(canvas);
  }

  function makeTailLayer(bitmap, info, root) {
    const [x0, y0, w, h] = info.tailRect, step = 6, cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
    const alpha = alphaGrid(bitmap);
    const used = new Int32Array(cols * rows).fill(-1), points = [], indices = [], edges = [];
    const vertex = (c, r) => {
      const key = r * cols + c;
      if (used[key] < 0) {
        used[key] = points.length / 2;
        points.push(Math.min(c * step, w), Math.min(r * step, h));
      }
      return used[key];
    };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      let visible = false;
      for (let py = r * step - 2; py <= (r + 1) * step + 2 && !visible; py += 3) for (let px = c * step - 2; px <= (c + 1) * step + 2; px += 3) if (alphaAt(alpha, px, py) > 0) { visible = true; break; }
      if (!visible) continue;
      const a = vertex(c, r), b = vertex(c + 1, r), d = vertex(c, r + 1), e = vertex(c + 1, r + 1);
      indices.push(a, b, d, b, e, d);
      edges.push([a, b], [a, d], [b, e], [d, e]);
    }
    const n = points.length / 2;
    if (!n) return null;
    const rest = new Float32Array(n * 2), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      rest[i * 2] = points[i * 2] + x0; rest[i * 2 + 1] = points[i * 2 + 1] + y0;
      uvs[i * 2] = points[i * 2] / w; uvs[i * 2 + 1] = points[i * 2 + 1] / h;
    }
    // Distance along the tail, walked over the mesh from the root: a curled tail stays continuous
    // here, where straight-line distance would tear it where it passes close to itself.
    let start = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(rest[i * 2] - root[0], rest[i * 2 + 1] - root[1]);
      if (d < best) { best = d; start = i; }
    }
    const links = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) { links[a].push(b); links[b].push(a); }
    const walked = new Float32Array(n).fill(Infinity), queue = [start];
    walked[start] = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      for (const j of links[i]) {
        if (walked[j] === Infinity) { walked[j] = walked[i] + step; queue.push(j); }
      }
    }
    let longest = 1;
    for (let i = 0; i < n; i++) if (walked[i] !== Infinity && walked[i] > longest) longest = walked[i];
    const along = new Float32Array(n);
    for (let i = 0; i < n; i++) along[i] = walked[i] === Infinity ? 1 : walked[i] / longest;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rest.byteLength, gl.DYNAMIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 0, 0);
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, uvBuffer, indexBuffer, positionBuffer, count: indices.length, rest, pos: new Float32Array(n * 2), n, along, root: [rest[start * 2], rest[start * 2 + 1]], texture: makeTexture(bitmap) };
  }

  function buildPose(name, bitmap, blinkBitmap, tailBitmap, underBitmap, cutBitmap, info) {
    const width = bitmap.width, height = bitmap.height, offsetX = offsetFor(name, info), alpha = alphaGrid(bitmap);
    const cols = Math.ceil(width / CELL) + 1, rows = Math.ceil(height / CELL) + 1;
    const used = new Int32Array(cols * rows).fill(-1), restList = [], cellIndices = [];
    const vertex = (c, r) => {
      const key = r * cols + c;
      if (used[key] < 0) {
        used[key] = restList.length / 2;
        restList.push(Math.min(c * CELL, width), Math.min(r * CELL, height));
      }
      return used[key];
    };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      if (!cellVisible(alpha, c * CELL, r * CELL)) continue;
      const a = vertex(c, r), b = vertex(c + 1, r), d = vertex(c, r + 1), e = vertex(c + 1, r + 1);
      cellIndices.push([a, b, d, e, c * CELL, r * CELL]);
    }
    const rest = new Float32Array(restList), n = rest.length / 2;
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = rest[i * 2] / width; uvs[i * 2 + 1] = rest[i * 2 + 1] / height; }

    const makeBuffers = (uvData, indices) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 0, 0);
      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(attribs.uv);
      gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 0, 0);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, uvBuffer, indexBuffer, count: indices.length };
    };
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rest.byteLength, gl.DYNAMIC_DRAW);
    const allIndices = [];
    for (const [a, b, d, e] of cellIndices) allIndices.push(a, b, d, b, e, d);
    const body = makeBuffers(uvs, allIndices);

    // Blink patch: the painted closed-eye layer, warped by the same mesh.
    let blink = null;
    if (blinkBitmap && info.blink) {
      const [bx, by] = info.blink, bw = blinkBitmap.width, bh = blinkBitmap.height;
      const blinkUv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { blinkUv[i * 2] = (rest[i * 2] - bx) / bw; blinkUv[i * 2 + 1] = (rest[i * 2 + 1] - by) / bh; }
      const blinkIndices = [];
      for (const [a, b, d, e, x, y] of cellIndices) if (x + CELL > bx && x < bx + bw && y + CELL > by && y < by + bh) blinkIndices.push(a, b, d, b, e, d);
      blink = { ...makeBuffers(blinkUv, blinkIndices), texture: makeTexture(blinkBitmap) };
    }

    const L = landmarksFor(info, width, height);
    const W = bindWeights(rest, n, L);
    const tail = tailBitmap && info.tail ? makeTailLayer(tailBitmap, info, info.tail[0]) : null;
    return { name, width, height, offsetX, alpha, rest, pos: new Float32Array(n * 2), n, positionBuffer, body, blink, tail, texture: bodyTexture(bitmap, tail && cutBitmap, underBitmap, info.tailRect), L, W };
  }

  // Everything else about her is measured from the eyes.
  function landmarksFor(info, width) {
    const eyes = info.eyes || [[width / 2 - 50, 240], [width / 2 + 50, 240]];
    const mx = (eyes[0][0] + eyes[1][0]) / 2, my = (eyes[0][1] + eyes[1][1]) / 2;
    const gap = Math.max(50, Math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]));
    const ux = (eyes[1][0] - eyes[0][0]) / gap, uy = (eyes[1][1] - eyes[0][1]) / gap;
    const neck = [mx - uy * gap * 0.78, my + ux * gap * 0.78];
    const crown = [mx + uy * gap * 0.5, my - ux * gap * 0.5];
    return { mx, my, gap, neck, crown, earL: info.earL, earR: info.earR, ahoge: info.ahoge, tail: info.tail || null };
  }

  function bindWeights(rest, n, L) {
    const channel = () => new Float32Array(n);
    const W = { head: channel(), face: channel(), back: channel(), earL: channel(), earR: channel(), ahoge: channel(), hairL: channel(), hairR: channel(), skirt: channel(), legL: channel(), legR: channel(), chest: channel(), spine: channel() };
    const { mx, my, gap, neck, crown } = L;
    const earPivot = tip => (tip ? [tip[0] + (crown[0] - tip[0]) * 0.44, tip[1] + (crown[1] - tip[1]) * 0.44] : null);
    L.earPivotL = earPivot(L.earL);
    L.earPivotR = earPivot(L.earR);
    L.ahogeRoot = L.ahoge ? [L.ahoge[0], L.ahoge[1] + 58] : null;
    const axis = (x, y, px, py, tx, ty, near, far, half) => {
      const dx = tx - px, dy = ty - py, len = Math.hypot(dx, dy) || 1, ax = dx / len, ay = dy / len;
      const qx = x - px, qy = y - py, t = (qx * ax + qy * ay) / len, perp = Math.abs(qx * -ay + qy * ax);
      return smooth(near, far, t) * smooth(half * 1.35, half, perp);
    };
    for (let i = 0; i < n; i++) {
      const x = rest[i * 2], y = rest[i * 2 + 1];
      W.head[i] = 1 - smooth(neck[1] - 22, neck[1] + 23 + 0.22 * Math.abs(x - neck[0]), y);
      W.face[i] = gauss(x, y, mx, my + gap * 0.1, gap, gap * 0.66);
      W.back[i] = smooth(gap * 1.25, gap * 1.95, Math.hypot(x - crown[0], y - crown[1])) * smooth(neck[1] + 8, neck[1] - 85, y);
      if (L.earL) W.earL[i] = axis(x, y, L.earPivotL[0], L.earPivotL[1], L.earL[0], L.earL[1], -0.1, 0.55, gap * 0.48);
      if (L.earR) W.earR[i] = axis(x, y, L.earPivotR[0], L.earPivotR[1], L.earR[0], L.earR[1], -0.1, 0.55, gap * 0.48);
      if (L.ahoge && y < L.ahogeRoot[1] + 2 && Math.abs(x - L.ahoge[0]) < 56) W.ahoge[i] = smooth(4, 60, Math.hypot(x - L.ahogeRoot[0], y - L.ahogeRoot[1]));
      const torso = gauss(x, y, mx, neck[1] + 100, gap * 0.95, gap * 1.1);
      W.hairL[i] = smooth(neck[1] - 115, neck[1] + 85, y) * smooth(mx - gap * 0.42, mx - gap * 1.2, x) * (1 - torso) * smooth(560, 500, y);
      W.hairR[i] = smooth(neck[1] - 115, neck[1] + 85, y) * smooth(mx + gap * 0.42, mx + gap * 1.2, x) * (1 - torso) * smooth(560, 500, y);
      W.skirt[i] = smooth(430, 515, y) * smooth(575, 530, y);
      const legs = smooth(505, 600, y);
      W.legL[i] = x < mx ? legs : 0;
      W.legR[i] = x >= mx ? legs : 0;
      W.chest[i] = gauss(x, y, mx, neck[1] + 65, gap * 0.8, gap * 0.52);
      W.spine[i] = smooth(495, 360, y);
    }
    return W;
  }

  const rotateAround = (q, px, py, angle) => {
    if (!angle) return;
    const c = Math.cos(angle), s = Math.sin(angle), dx = q.x - px, dy = q.y - py;
    q.x = px + dx * c - dy * s;
    q.y = py + dx * s + dy * c;
  };

  function deform(pose, P, t) {
    const { rest, pos, n, W, L, height, offsetX } = pose, q = { x: 0, y: 0 };
    const liftFar = P.hairLift * 15, spreadFar = P.hairLift * 9, { neck, mx } = L;
    for (let i = 0; i < n; i++) {
      q.x = rest[i * 2]; q.y = rest[i * 2 + 1];
      const hl = W.hairL[i], hr = W.hairR[i];
      if (hl) {
        q.x += hl * (P.hairSwayL + P.hairWave * Math.sin(q.y * 0.021 + t * 1.15) + P.hairWave * 0.5 * Math.sin(q.y * 0.047 - t * 0.8) - spreadFar);
        q.y -= hl * (liftFar + P.hairWave * 0.35 * Math.sin(q.x * 0.03 + t * 0.9));
      }
      if (hr) {
        q.x += hr * (P.hairSwayR + P.hairWave * Math.sin(q.y * 0.023 + t * 1.05 + 1.6) + P.hairWave * 0.5 * Math.sin(q.y * 0.05 - t * 0.7 + 2.2) + spreadFar);
        q.y -= hr * (liftFar + P.hairWave * 0.35 * Math.sin(q.x * 0.03 + t * 0.85 + 1));
      }
      if (W.earL[i]) rotateAround(q, L.earPivotL[0], L.earPivotL[1], P.earL * W.earL[i]);
      if (W.earR[i]) rotateAround(q, L.earPivotR[0], L.earPivotR[1], P.earR * W.earR[i]);
      if (W.ahoge[i]) rotateAround(q, L.ahogeRoot[0], L.ahogeRoot[1], P.ahoge * W.ahoge[i]);
      if (W.skirt[i]) { q.x += W.skirt[i] * P.skirt; q.y -= W.skirt[i] * P.hairLift * 3; }
      if (W.legL[i]) q.x += W.legL[i] * P.kick * Math.sin(t * 5.5);
      if (W.legR[i]) q.x += W.legR[i] * P.kick * Math.sin(t * 5.5 + Math.PI);
      if (W.chest[i]) q.y -= W.chest[i] * P.breath;
      // Head turn parallax: features slide one way, the far hair the other.
      if (W.face[i]) { q.x += W.face[i] * P.lookX * 6; q.y += W.face[i] * P.lookY * 4; }
      if (W.back[i]) { q.x -= W.back[i] * P.lookX * 3; q.y -= W.back[i] * P.lookY * 1.8; }
      if (W.head[i]) {
        rotateAround(q, neck[0], neck[1], P.head * W.head[i]);
        q.y += W.head[i] * P.nod;
      }
      if (W.spine[i]) rotateAround(q, mx, 490, P.lean * W.spine[i]);
      // Squash and stretch from the soles.
      q.x = mx + (q.x - mx) * (1 - P.squash * 0.55);
      q.y = height + (q.y - height) * (1 + P.squash);
      pos[i * 2] = q.x + offsetX;
      pos[i * 2 + 1] = q.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pose.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  }

  // The swish starts at the root and whips out to the tip, so the seam at the body never opens.
  function deformTail(pose, P) {
    const { tail, L, height, offsetX } = pose, { rest, pos, n, along, root } = tail, q = { x: 0, y: 0 };
    const followX = smooth(430, 515, root[1]) * smooth(575, 530, root[1]) * P.skirt;
    for (let i = 0; i < n; i++) {
      q.x = rest[i * 2]; q.y = rest[i * 2 + 1];
      const u = along[i], wave = P.tailAmp * Math.sin(P.tailPhase - u * 3.2);
      rotateAround(q, root[0], root[1], (wave * 0.72 + P.tailBase + P.tailSpring) * u * (0.35 + u * 0.65));
      q.x += followX;
      q.x = L.mx + (q.x - L.mx) * (1 - P.squash * 0.55);
      q.y = height + (q.y - height) * (1 + P.squash);
      pos[i * 2] = q.x + offsetX;
      pos[i * 2 + 1] = q.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, tail.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  }

  const matrix = new Float32Array(9);
  function setView(pixelRatio, scale, P) {
    const cw = canvas.width, ch = canvas.height, k = scale * pixelRatio;
    const pivotX = STAGE.cx, pivotY = 400, c = Math.cos(P.rot), s = Math.sin(P.rot);
    const originX = (MARGIN + pivotX + P.shiftX) * k, originY = (MARGIN + pivotY + P.bob + P.shiftY) * k;
    matrix[0] = (c * k * 2) / cw; matrix[1] = (-s * k * 2) / ch; matrix[2] = 0;
    matrix[3] = (-s * k * 2) / cw; matrix[4] = (-c * k * 2) / ch; matrix[5] = 0;
    matrix[6] = ((originX - (c * pivotX - s * pivotY) * k) * 2) / cw - 1;
    matrix[7] = 1 - ((originY - (s * pivotX + c * pivotY) * k) * 2) / ch;
    matrix[8] = 1;
    gl.uniformMatrix3fv(uniforms.view, false, matrix);
  }

  function drawMesh(mesh, texture, opacity) {
    if (opacity <= 0.002 || !mesh.count) return;
    gl.uniform1f(uniforms.opacity, opacity);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  function freePose(pose) {
    gl.deleteTexture(pose.texture);
    gl.deleteBuffer(pose.positionBuffer);
    for (const mesh of [pose.body, pose.blink]) {
      if (!mesh) continue;
      gl.deleteBuffer(mesh.uvBuffer);
      gl.deleteBuffer(mesh.indexBuffer);
      gl.deleteVertexArray(mesh.vao);
    }
    if (pose.blink) gl.deleteTexture(pose.blink.texture);
    if (pose.tail) {
      gl.deleteTexture(pose.tail.texture);
      gl.deleteBuffer(pose.tail.positionBuffer);
      gl.deleteBuffer(pose.tail.uvBuffer);
      gl.deleteBuffer(pose.tail.indexBuffer);
      gl.deleteVertexArray(pose.tail.vao);
    }
  }

  return {
    buildPose,
    freePose,
    resize(width, height) {
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    },
    // Crossfade: the new pose fades in over the old so she is never see-through mid-change.
    draw(current, previous, fade, P, t, blink, pixelRatio, scale) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      setView(pixelRatio, scale, P);
      const opacity = P.opacity;
      if (previous && fade < 1) {
        deform(previous, P, t);
        const fading = opacity * clamp((1 - fade) * 2.2, 0, 1);
        drawMesh(previous.body, previous.texture, fading);
        if (previous.tail) { deformTail(previous, P); drawMesh(previous.tail, previous.tail.texture, fading); }
      }
      if (current) {
        deform(current, P, t);
        const showing = opacity * clamp(fade * 1.8, 0, 1);
        drawMesh(current.body, current.texture, showing);
        if (current.blink && fade >= 1) drawMesh(current.blink, current.blink.texture, opacity * blink);
        if (current.tail) { deformTail(current, P); drawMesh(current.tail, current.tail.texture, showing); }
      }
    },
    // Is this art-space point on her? For click-through in the empty parts of her box.
    opaqueAt(pose, stageX, stageY) {
      if (!pose) return false;
      const x = stageX - pose.offsetX, y = stageY;
      for (const [dx, dy] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]]) if (alphaAt(pose.alpha, x + dx, y + dy) > 40) return true;
      return false;
    },
    destroy() {
      destroyed = true;
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
};


// Soft particles, her dish of dried fish (quota) and mini clones (subagents). Clones are the real art
// scaled down; particles stay small, round and pastel so the painted pose keeps the spotlight.
HAGEMI.createFx = function createFx(backCanvas, frontCanvas) {
  const { clamp, rand, lerp } = HAGEMI.util;
  const { STAGE } = HAGEMI;
  const back = backCanvas.getContext('2d'), front = frontCanvas.getContext('2d');
  const OUTLINE = '#2f2a6e';
  let particles = [];

  const star = (ctx, x, y, r, inner = 0.3) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2, d = i % 2 ? r * inner : r;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.closePath();
  };
  const heart = (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.95);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.75, y - r * 1.1, x, y - r * 0.35);
    ctx.bezierCurveTo(x + r * 0.75, y - r * 1.1, x + r * 1.5, y - r * 0.1, x, y + r * 0.95);
    ctx.closePath();
  };

  // One 小鱼干: curled from drying, silver back, warm belly, inked like the rest of her world.
  function fish(ctx, x, y, length, angle, flip) {
    const k = length / 62;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(flip ? -k : k, k);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-31, 2);
      ctx.bezierCurveTo(-25, -10, -6, -13, 10, -7);
      ctx.quadraticCurveTo(16, -4.5, 20, -2);
      ctx.quadraticCurveTo(26, -7, 33, -11);
      ctx.quadraticCurveTo(29, -1, 33, 8);
      ctx.quadraticCurveTo(25, 5, 20, 2);
      ctx.quadraticCurveTo(14, 6, 8, 7.5);
      ctx.bezierCurveTo(-8, 11.5, -24, 10, -31, 2);
      ctx.closePath();
    };
    body();
    const skin = ctx.createLinearGradient(0, -12, 0, 11);
    skin.addColorStop(0, '#7d86bd');
    skin.addColorStop(0.42, '#c9cee8');
    skin.addColorStop(0.72, '#f7e6bf');
    skin.addColorStop(1, '#e8b877');
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.save();
    body();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.quadraticCurveTo(0, -9, 10, -4.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(47, 42, 110, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-16, -6);
    ctx.quadraticCurveTo(-12, 0, -15, 7);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-22.5, -1, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(-22.8, -0.8, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // All that is left of the last one.
  function fishbone(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.08);
    ctx.lineCap = 'round';
    for (const [width, color] of [[4.4, OUTLINE], [2, '#f2eeff']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(17, 0);
      for (const rib of [-8, -1, 6]) { ctx.moveTo(rib + 2, -6); ctx.lineTo(rib - 1, 6); }
      ctx.moveTo(17, 0); ctx.lineTo(23, -5);
      ctx.moveTo(17, 0); ctx.lineTo(23, 5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.quadraticCurveTo(-20, -7, -14, -3);
    ctx.lineTo(-14, 3);
    ctx.quadraticCurveTo(-20, 7, -24, 0);
    ctx.closePath();
    ctx.fillStyle = '#f2eeff';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  const KINDS = {
    fish(ctx, p) { fish(ctx, 0, 0, p.size, 0, p.flip); },
    star(ctx, p) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.45, p.color);
      glow.addColorStop(1, p.color);
      star(ctx, 0, 0, p.size);
      ctx.fillStyle = glow;
      ctx.fill();
    },
    heart(ctx, p) {
      heart(ctx, 0, 0, p.size);
      const fill = ctx.createLinearGradient(0, -p.size, 0, p.size);
      fill.addColorStop(0, '#ffb3cb');
      fill.addColorStop(1, p.color);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    text(ctx, p) {
      ctx.font = `700 ${p.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ffffffd0';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
    },
    confetti(ctx, p) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(-p.size / 2, -p.size / 4, p.size, p.size / 2, p.size / 6);
      ctx.fill();
    },
    drop(ctx, p) {
      const fill = ctx.createLinearGradient(0, -p.size, 0, p.size);
      fill.addColorStop(0, '#ffffffc0');
      fill.addColorStop(0.5, p.color);
      fill.addColorStop(1, p.color);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.quadraticCurveTo(p.size, p.size * 0.4, 0, p.size);
      ctx.quadraticCurveTo(-p.size, p.size * 0.4, 0, -p.size);
      ctx.fill();
    },
    puff(ctx, p) {
      const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      fill.addColorStop(0, p.color);
      fill.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    },
  };
  const PALETTE = ['#b79cff', '#8fd8ff', '#ffb3d9', '#ffe08a', '#d4c4ff', '#a8f0e4'];

  function emit(kind, x, y, options = {}) {
    if (particles.length > 160) return;
    particles.push({
      kind, x, y,
      vx: options.vx ?? 0, vy: options.vy ?? 0, ax: options.ax ?? 0, ay: options.ay ?? 0,
      life: 0, ttl: options.ttl ?? 1.4,
      size: options.size ?? 10, spin: options.spin ?? 0, angle: options.angle ?? 0,
      color: options.color ?? PALETTE[(Math.random() * PALETTE.length) | 0],
      text: options.text, flip: options.flip, drag: options.drag ?? 0, front: options.front !== false, wobble: options.wobble ?? 0, phase: Math.random() * 6.28,
    });
  }

  const BURSTS = {
    confetti(x, y, n = 36) {
      for (let i = 0; i < n; i++) emit('confetti', x, y - 120, { vx: rand(-260, 260), vy: rand(-380, -90), ay: 300, ttl: rand(1.1, 2.1), size: rand(10, 18), spin: rand(-9, 9), drag: 0.7 });
      for (let i = 0; i < 10; i++) emit('star', x, y - 120, { vx: rand(-210, 210), vy: rand(-290, -60), ay: 130, ttl: rand(0.9, 1.5), size: rand(9, 17), spin: rand(-5, 5), drag: 0.9 });
    },
    sparkles(x, y, n = 12) {
      for (let i = 0; i < n; i++) emit('star', x + rand(-190, 190), y + rand(-300, 120), { vy: rand(-46, -14), ttl: rand(0.7, 1.4), size: rand(7, 15), spin: rand(-3, 3) });
    },
    hearts(x, y, n = 6) {
      for (let i = 0; i < n; i++) emit('heart', x + rand(-110, 110), y - 230 + rand(-30, 30), { vy: rand(-92, -46), vx: rand(-22, 22), ttl: rand(1.1, 1.9), size: rand(10, 16), color: '#fb7199', wobble: 26 });
    },
    sweat(x, y, n = 6) {
      for (let i = 0; i < n; i++) emit('drop', x + 90, y - 250, { vx: rand(40, 170), vy: rand(-150, -30), ay: 480, ttl: 0.75, size: rand(5, 9), color: '#8dd0f7' });
    },
    steam(x, y, n = 12) {
      for (const side of [-1, 1]) for (let i = 0; i < n / 2; i++) emit('puff', x + side * 130, y - 260, { vx: side * rand(40, 130), vy: rand(-100, -40), ttl: rand(0.5, 1), size: rand(12, 24), color: 'rgba(255,255,255,0.85)', drag: 1.4 });
    },
    dust(x, y, n = 10) {
      for (let i = 0; i < n; i++) emit('puff', x + rand(-110, 110), y + 230, { vx: rand(-80, 80), vy: rand(-30, -5), ttl: rand(0.4, 0.8), size: rand(9, 18), color: 'rgba(190,180,230,0.6)', drag: 1.6 });
    },
    fish(x, y, n = 16) {
      for (let i = 0; i < n; i++) emit('fish', x + rand(-190, 190), y - 340 + rand(-40, 20), { vy: rand(40, 170), ay: 340, ttl: rand(0.9, 1.5), size: rand(44, 66), spin: rand(-4, 4), angle: rand(-1, 1), flip: i % 2 === 0, front: i % 2 === 0 });
    },
    notes(x, y, n = 4) {
      for (let i = 0; i < n; i++) emit('text', x + rand(-130, 130), y - 250, { text: Math.random() < 0.5 ? '♪' : '♫', size: rand(24, 32), vy: rand(-70, -30), wobble: 24, ttl: rand(1.1, 1.8), color: '#8b6bf0' });
    },
  };

  function stepParticles(dt, t) {
    const alive = [];
    for (const p of particles) {
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
      p.x += p.vx * dt + (p.wobble ? Math.cos(t * 3 + p.phase) * p.wobble * dt : 0);
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      alive.push(p);
    }
    particles = alive;
  }
  function drawParticles(ctx, frontLayer) {
    for (const p of particles) {
      if (p.front !== frontLayer) continue;
      const fade = clamp((p.ttl - p.life) / (p.ttl * 0.3), 0, 1), grow = clamp(p.life / 0.12, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(grow, grow);
      ctx.globalAlpha = fade;
      KINDS[p.kind](ctx, p);
      ctx.restore();
    }
  }

  // ---- Her dish of dried fish: quota is 小鱼干, and the pile is the meter ---------------------
  const stash = { show: 0, target: 0, level: 1, label: '' };
  // Lowest row first: as quota drains, the top of the pile goes before the bottom.
  const PILE = [[-27, -8, 0.32, 0.9], [-6, -12, -0.2, 1], [17, -8, 0.14, 0.95], [32, -6, -0.46, 0.8], [-17, -21, -0.42, 0.95], [7, -24, 0.3, 1], [25, -19, -0.2, 0.88], [-5, -34, 0.5, 0.92], [13, -36, -0.36, 0.86]];
  function drawStash(ctx, dt, t) {
    stash.show = lerp(stash.show, stash.target, 1 - Math.exp(-dt * 7));
    if (stash.show < 0.01) return;
    ctx.save();
    ctx.translate(STAGE.cx - 268 + Math.sin(t * 1.1) * 5, 205 + Math.sin(t * 1.7) * 8);
    ctx.rotate(Math.sin(t * 0.9) * 0.04);
    const pop = stash.show * (1 + 0.14 * Math.sin(stash.show * Math.PI));
    ctx.scale(pop * 1.42, pop * 1.42);
    ctx.globalAlpha = clamp(stash.show * 1.4, 0, 1);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Inside of the bowl.
    ctx.beginPath();
    ctx.ellipse(0, -2, 47, 13, 0, 0, Math.PI * 2);
    const inside = ctx.createLinearGradient(0, -15, 0, 11);
    inside.addColorStop(0, '#574a9c');
    inside.addColorStop(1, '#8a78d4');
    ctx.fillStyle = inside;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    const count = stash.level <= 0.001 ? 0 : Math.max(1, Math.ceil(stash.level * PILE.length));
    if (!count) fishbone(ctx, 2, -3);
    for (let i = count - 1; i >= 0; i--) {
      const [x, y, angle, size] = PILE[i];
      fish(ctx, x, y + Math.sin(t * 2 + i) * 0.5, 52 * size, angle, i % 2 === 0);
    }
    // Front wall of the bowl hides the bottom of the pile.
    ctx.beginPath();
    ctx.moveTo(-47, -2);
    ctx.bezierCurveTo(-44, 8, -44, 22, -30, 31);
    ctx.quadraticCurveTo(0, 37, 30, 31);
    ctx.bezierCurveTo(44, 22, 44, 8, 47, -2);
    ctx.bezierCurveTo(30, 16, -30, 16, -47, -2);
    ctx.closePath();
    const wall = ctx.createLinearGradient(0, -2, 0, 36);
    wall.addColorStop(0, '#fbf8ff');
    wall.addColorStop(0.55, '#d9cdfb');
    wall.addColorStop(1, '#a896ee');
    ctx.fillStyle = wall;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    // A soft shine and her star on the bowl.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-36, 11);
    ctx.quadraticCurveTo(-30, 20, -21, 25);
    ctx.stroke();
    if (stash.label) {
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = '#ffffffd8';
      ctx.strokeText(stash.label, 2, 21);
      ctx.fillStyle = OUTLINE;
      ctx.fillText(stash.label, 2, 21);
    }
    ctx.restore();
  }

  // ---- Mini clones: one tiny Hagemi per running subagent ----------------------------------
  let clones = [], cloneImage = null;
  function drawClones(ctx, dt, t, frontLayer) {
    if (!cloneImage) return;
    for (const clone of clones) {
      clone.show = lerp(clone.show, clone.target, 1 - Math.exp(-dt * 6));
      const angle = t * clone.speed + clone.phase;
      const depth = Math.sin(angle);
      if ((depth > 0) !== frontLayer) continue;
      const x = STAGE.cx + Math.cos(angle) * 320, y = 370 + depth * 70 + Math.sin(t * 3 + clone.phase) * 12;
      const height = (118 + depth * 20) * clone.show;
      if (height < 3) continue;
      const width = height * (cloneImage.width / cloneImage.height);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 2 + clone.phase) * 0.14);
      ctx.globalAlpha = clamp(clone.show * 1.4, 0, 1);
      ctx.drawImage(cloneImage, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
    clones = clones.filter(clone => clone.target || clone.show > 0.02);
  }

  let zTimer = 0;
  return {
    burst(name, x, y, ...rest) { if (BURSTS[name]) BURSTS[name](x, y, ...rest); },
    setStash(value) {
      stash.target = value ? 1 : 0;
      if (value) { stash.level = clamp(value.level, 0, 1); stash.label = value.label || ''; }
    },
    setCloneImage(bitmap) { cloneImage = bitmap; },
    setClones(count) {
      while (clones.length < count) clones.push({ show: 0, target: 1, phase: Math.random() * 6.28, speed: rand(0.45, 0.75) * (Math.random() < 0.5 ? -1 : 1) });
      clones.forEach((clone, index) => { clone.target = index < count ? 1 : 0; });
    },
    resize(width, height) {
      for (const canvas of [backCanvas, frontCanvas]) if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    },
    draw(dt, t, k, marginPx, pose) {
      stepParticles(dt, t);
      if (pose.sleeping) {
        zTimer -= dt;
        if (zTimer <= 0) {
          zTimer = 1.25;
          emit('text', STAGE.cx + 130, 150, { text: 'z', size: rand(26, 40), vy: -34, vx: 22, wobble: 16, ttl: 2.2, color: '#7f70e8' });
        }
      }
      for (const [ctx, isFront] of [[back, false], [front, true]]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(k, 0, 0, k, marginPx + pose.shiftX * k, marginPx + (pose.bob * 0.5 + pose.shiftY) * k);
        drawClones(ctx, dt, t, isFront);
        drawParticles(ctx, isFront);
        if (isFront) drawStash(ctx, dt, t);
      }
    },
    clear() { particles = []; clones = []; },
  };
};


// Decides which painted pose she wears and how it moves. Poses carry the expression and the
// story; parameters, gestures and springs keep the art breathing between them.
HAGEMI.REST = {
  rot: 0, squash: 0, bob: 0, shiftX: 0, shiftY: 0, lean: 0, head: 0, nod: 0, lookX: 0, lookY: 0,
  earL: 0, earR: 0, ahoge: 0, hairSwayL: 0, hairSwayR: 0, hairWave: 2.2, hairLift: 0.2,
  tailBase: 0, tailAmp: 0.1, tailFreq: 0.55, tailSpring: 0, kick: 0, skirt: 0, breath: 1, opacity: 1,
};

// `pose` is a name, or a list to rotate through every `swap` seconds.
HAGEMI.STATES = {
  idle: { pose: ['idle', 'idle-2', 'idle-3'], swap: 34, float: 0.45 },
  listening: { pose: 'listening', lookY: 0.4, tailAmp: 0.18, tailFreq: 0.95, earL: -0.06, earR: 0.06, float: 0.35 },
  thinking: { pose: 'thinking', tailAmp: 0.09, tailFreq: 0.4, float: 0.35, head: -0.015, sway: 0.012 },
  deepthink: { pose: 'thinking', tailAmp: 0.06, tailFreq: 0.3, float: 0.15, sway: 0.03, breath: 0.7 },
  reading: { pose: 'reading', tailAmp: 0.09, float: 0.25, nodRate: 0.32, nodSize: 1.8 },
  writing: { pose: 'writing', tailAmp: 0.18, tailFreq: 1, float: 0.2, nodRate: 1.4, nodSize: 1.5 },
  running: { pose: 'running', tailAmp: 0.26, tailFreq: 1.5, float: 0.2, bounce: 7, bounceRate: 3.2 },
  searching: { pose: 'searching', tailAmp: 0.18, tailFreq: 0.9, float: 0.3, sway: 0.03, lookSweep: 0.7 },
  drawing: { pose: 'drawing', tailAmp: 0.24, tailFreq: 1.2, float: 0.3, sway: 0.022 },
  delegating: { pose: 'delegating', tailAmp: 0.22, tailFreq: 1, float: 0.45 },
  compacting: { pose: 'compact', tailAmp: 0.08, float: 0, squeeze: 0.02 },
  asking: { pose: 'asking', tailAmp: 0.3, tailFreq: 1.5, float: 0.3, bounce: 5, bounceRate: 2.4, earL: -0.08, earR: 0.08 },
  busy: { pose: ['busy_left', 'busy_right'], swap: 3.6, tailAmp: 0.26, tailFreq: 1.4, float: 0.15 },
  swamped: { pose: ['swamped_left', 'swamped_right'], swap: 1.5, tailAmp: 0.44, tailFreq: 2.1, wobble: 0.04, float: 0.1 },
  tired: { pose: 'tired', hairLift: 0, tailAmp: 0.05, tailFreq: 0.28, float: 0.05, ahoge: 0.26, earL: 0.1, earR: -0.1, breath: 0.8 },
  exhausted: { pose: 'tired', rot: 0.2, hairLift: 0.5, hairWave: 1.2, tailBase: 0.2, tailAmp: 0.02, tailFreq: 0.16, float: 0.75, ahoge: 0.6, earL: 0.22, earR: -0.22, stash: true, breath: 0.5 },
  resetSoon: { pose: 'forgiven', tailAmp: 0.36, tailFreq: 1.5, float: 0.45, bounce: 4, bounceRate: 2.2, stash: true },
  sleeping: { pose: 'sleeping', float: 0.8, hairWave: 1.3, tailAmp: 0.04, tailFreq: 0.14, breath: 2.1, sleeping: true, rot: 0.03, noBlink: true },
  dragged: { pose: 'surprised', kick: 5, hairWave: 3, tailAmp: 0.22, tailFreq: 1.1, float: 0, noFidget: true },
  dizzy: { pose: 'dizzy', wobble: 0.12, float: 0.1, tailAmp: 0.2, tailFreq: 1 },
  petted: { pose: 'pat', tailAmp: 0.3, tailFreq: 0.6, float: 0.4, nodRate: 1.1, nodSize: 2.2, earL: 0.1, earR: -0.1 },
  coaxed: { pose: 'coaxed', tailAmp: 0.24, tailFreq: 0.7, float: 0.35 },
  annoyed: { pose: 'annoyed', tailAmp: 0.3, tailFreq: 1.9, float: 0.12 },
  puffed: { pose: 'puffed', tailAmp: 0.46, tailFreq: 2.4, float: 0.08, squeeze: 0.012 },
  redhot: { pose: 'redhot', tailAmp: 0.6, tailFreq: 3, float: 0.05, shake: 2.4 },
  sulk: { pose: 'sulk', tailAmp: 0.14, tailFreq: 0.66, float: 0.03, noFidget: true },
  forgiven: { pose: 'forgiven', tailAmp: 0.3, tailFreq: 0.9, float: 0.4 },
  happy: { pose: 'happy', tailAmp: 0.34, tailFreq: 1.3, float: 0.45 },
  proud: { pose: 'proud', tailAmp: 0.3, tailFreq: 1.1, float: 0.5 },
  oops: { pose: 'oops', tailAmp: 0.2, tailFreq: 1.4, float: 0.1 },
  surprised: { pose: 'surprised', tailAmp: 0.34, tailFreq: 1.6, float: 0.2 },
  hum: { pose: 'hum', tailAmp: 0.18, tailFreq: 0.6, float: 0.5, nodRate: 0.9, nodSize: 2.4, sway: 0.025 },
  float: { pose: 'float', float: 1, hairLift: 0.3, hairWave: 3.4, kick: 2.4, rot: -0.04, tailBase: -0.1, tailAmp: 0.14, tailFreq: 0.4 },
  stretch: { pose: 'stretch', tailAmp: 0.2, float: 0.3, squeeze: -0.03 },
  yawn: { pose: 'yawn', tailAmp: 0.06, tailFreq: 0.3, float: 0.2 },
  gift: { pose: 'update', tailAmp: 0.34, tailFreq: 1.4, float: 0.45, bounce: 8, bounceRate: 2.4 },
  bye: { pose: 'bye', tailAmp: 0.2, float: 0.3 },
  dockLeft: { pose: 'edge_left', float: 0, tailAmp: 0.06, tailFreq: 0.4, docked: true, hairWave: 1.2 },
  dockLeftPeek: { pose: 'edge_left_peek', float: 0, tailAmp: 0.14, tailFreq: 0.8, docked: true, hairWave: 1.4 },
  dockRight: { pose: 'edge_right', float: 0, tailAmp: 0.06, tailFreq: 0.4, docked: true, hairWave: 1.2 },
  dockRightPeek: { pose: 'edge_right_peek', float: 0, tailAmp: 0.14, tailFreq: 0.8, docked: true, hairWave: 1.4 },
};

for (const scene of ['greet_morning', 'greet_noon', 'greet_afternoon', 'greet_evening', 'greet_night', 'greet_dawn', 'fest_halloween', 'fest_christmas', 'fest_newyear', 'fest_spring', 'fest_lantern', 'fest_dragonboat', 'fest_midautumn', 'fest_national']) {
  HAGEMI.STATES[scene] = { pose: scene, tailAmp: 0.24, tailFreq: 1, float: 0.4 };
}

// Which painted face a remark calls for.
HAGEMI.MOODS = {
  happy: 'happy', smug: 'proud', proud: 'proud', love: 'petted', excited: 'gift', surprised: 'surprised',
  worried: 'oops', sad: 'tired', angry: 'puffed', sleepy: 'yawn', thinking: 'thinking', embarrassed: 'coaxed', wink: 'proud', shocked: 'oops',
};

const easeInOut = p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const hump = p => Math.sin(Math.PI * p);
const GESTURES = {
  hop: { ms: 620, run(p, a) { a.bob -= 62 * hump(p); a.squash += p < 0.16 ? -0.09 * hump(p / 0.16) : p > 0.84 ? -0.07 * hump((1 - p) / 0.16) : 0.035; a.hairLift += 0.6 * hump(p); } },
  bounce: { ms: 1180, run(p, a) { const q = p * 2 % 1, big = p < 0.5 ? 1 : 0.62; a.bob -= 64 * big * hump(q); a.squash += q < 0.14 ? -0.08 * hump(q / 0.14) : q > 0.86 ? -0.06 * hump((1 - q) / 0.14) : 0.03; a.hairLift += 0.55 * hump(q); } },
  spin: { ms: 1100, noMotion: true, run(p, a) { a.rot += easeInOut(p) * Math.PI * 2; a.bob -= 92 * hump(p); a.hairLift += 1.1 * hump(p); a.squash += 0.04 * hump(p); } },
  shiver: { ms: 720, run(p, a, t) { a.shiftX += Math.sin(t * 74) * 3.6 * (1 - p); } },
  nod: { ms: 760, run(p, a) { a.nod += 9 * Math.sin(p * Math.PI * 4) * (1 - p * 0.4); } },
  shake: { ms: 800, run(p, a) { a.head += 0.1 * Math.sin(p * Math.PI * 6) * (1 - p); a.lookX += 0.8 * Math.sin(p * Math.PI * 6) * (1 - p); } },
  earFlick: { ms: 340, run(p, a) { a.earR += 0.3 * hump(p); } },
  earFlickL: { ms: 340, run(p, a) { a.earL -= 0.3 * hump(p); } },
  tailSwish: { ms: 1100, run(p, a) { const e = hump(p); a.tailAmp += 0.5 * e; a.tailFreq += 1 * e; } },
  lookAround: { ms: 2600, run(p, a) { const e = Math.min(1, Math.min(p, 1 - p) * 5); a.lookX += Math.sin(p * Math.PI * 3) * 0.95 * e; a.lookY -= 0.2 * e; a.head += Math.sin(p * Math.PI * 3) * 0.04 * e; } },
  gasp: { ms: 540, run(p, a) { const e = hump(p); a.squash += 0.07 * e; a.shiftY -= 22 * e; a.ahoge -= 0.22 * e; a.tailSpring -= 0.3 * e; } },
  recoil: { ms: 520, run(p, a) { const e = hump(p); a.shiftX -= 18 * e; a.lean -= 0.06 * e; a.head -= 0.08 * e; } },
  squish: { ms: 460, run(p, a) { a.squash -= 0.09 * hump(p); } },
  pop: { ms: 300, soft: true, run(p, a) { a.squash += 0.035 * Math.sin(p * Math.PI * 2) * (1 - p); } },
  drift: { ms: 5200, run(p, a) { const e = hump(p); a.shiftY -= 38 * e; a.hairLift += 0.85 * e; a.kick += 2.6 * e; a.rot += Math.sin(p * Math.PI * 2) * 0.07; a.tailBase -= 0.1 * e; } },
  flop: { ms: 900, run(p, a) { const e = hump(p); a.squash -= 0.07 * e; a.ahoge += 0.45 * e; a.head += 0.08 * e; } },
  talk: { ms: 340, soft: true, run(p, a) { a.nod += 2.2 * hump(p); a.squash += 0.008 * hump(p); } },
  leave: { ms: 1300, run(p, a) { a.opacity -= Math.max(0, p - 0.5) * 2; a.shiftY -= p * p * 70; a.hairLift += p; } },
};

HAGEMI.createAnimator = function createAnimator(fx) {
  const { lerp, rand, clamp } = HAGEMI.util;
  const P = { ...HAGEMI.REST }, target = { ...HAGEMI.REST };
  const zero = Object.fromEntries(Object.keys(HAGEMI.REST).map(key => [key, 0]));
  let state = 'idle', overrideState = null, overrideUntil = 0, overrideThen = null;
  let mood = { quota: 'ok', late: false, stashLevel: null, stashLabel: '', subagents: 0, showStash: false };
  let gestures = [];
  let poseIndex = 0, poseClock = 0, lastPoseState = null;
  // Accumulated, never computed as time * frequency: with that, easing the frequency after a state
  // change sweeps the phase at a rate proportional to her uptime, which reads as violent shaking.
  let tailPhase = 0;
  let blink = 0, blinkStage = 0, blinkClock = 0, nextBlink = rand(1.5, 4), doubleBlink = false;
  let nextFidget = rand(9, 18), reducedMotion = false, talking = false, talkClock = 0;
  const springs = { hairL: [0, 0], hairR: [0, 0], ahoge: [0, 0], tail: [0, 0], skirt: [0, 0] };
  const stepSpring = (s, goal, k, c, dt) => { s[1] += (goal - s[0]) * k * dt - s[1] * c * dt; s[0] += s[1] * dt; return s[0]; };

  function play(name) {
    const gesture = GESTURES[name];
    if (!gesture || (reducedMotion && gesture.noMotion)) return;
    gestures = gestures.filter(g => g.name !== name);
    gestures.push({ name, run: gesture.run, ms: gesture.ms, born: performance.now() });
    // Big movements jostle her. Talking and pose changes must not, or the tail twitches through them.
    if (gesture.soft) return;
    springs.tail[1] += rand(-0.6, 0.6);
    springs.ahoge[1] += rand(-1.6, 1.6);
  }

  function current() {
    if (overrideState && performance.now() < overrideUntil) return overrideState;
    if (overrideState) { overrideState = null; if (overrideThen) { const then = overrideThen; overrideThen = null; then(); } }
    return state;
  }

  // Little scenes she plays when nothing else is going on.
  const VIGNETTES = { hum: { ms: 5200, burst: 'notes' }, stretch: { ms: 2600, gesture: 'pop' }, yawn: { ms: 2600 }, float: { ms: 7200, burst: 'sparkles' } };
  function fidget() {
    const active = current(), S = HAGEMI.STATES[active] || {};
    nextFidget = active === 'idle' ? rand(13, 30) : rand(18, 40);
    if (S.noFidget || S.docked || active === 'sleeping' || active === 'exhausted') return;
    if (active !== 'idle') {
      play(['earFlick', 'earFlickL', 'tailSwish'][(Math.random() * 3) | 0]);
      return;
    }
    const pool = mood.quota === 'ok' && !mood.late
      ? ['lookAround', 'earFlick', 'tailSwish', 'drift', 'hop', 'lookAround', 'hum', 'float', 'stretch']
      : ['earFlick', 'stretch', 'yawn', 'yawn', 'lookAround', 'flop'];
    const pick = pool[(Math.random() * pool.length) | 0];
    const scene = VIGNETTES[pick];
    if (scene) {
      overrideState = pick;
      overrideUntil = performance.now() + scene.ms;
      if (scene.burst) fx.burst(scene.burst, HAGEMI.STAGE.cx, 400, 6);
      if (scene.gesture) play(scene.gesture);
      nextFidget = rand(20, 40);
    } else {
      play(pick);
      if (pick === 'drift') fx.burst('sparkles', HAGEMI.STAGE.cx, 400, 6);
    }
  }

  function update(dt, t, motion) {
    const activeName = current();
    const S = HAGEMI.STATES[activeName] || HAGEMI.STATES.idle;
    const now = performance.now();

    // Which painted pose.
    if (lastPoseState !== activeName) { lastPoseState = activeName; poseClock = 0; }
    const poses = Array.isArray(S.pose) ? S.pose : [S.pose];
    if (poses.length > 1) {
      poseClock += dt;
      if (poseClock >= (S.swap || 30)) { poseClock = 0; poseIndex++; }
    }
    const poseName = poses[poseIndex % poses.length];

    // Sustained motion.
    Object.assign(target, HAGEMI.REST);
    for (const key of Object.keys(target)) if (S[key] !== undefined) target[key] = S[key];
    const float = S.float ?? 0.3;
    target.shiftY = -float * 8;
    target.hairLift = S.hairLift ?? 0.08 + float * 0.4;
    target.hairWave = S.hairWave ?? 1.5 + float * 1.2;
    target.kick = S.kick ?? float * 1.2;
    target.bob = reducedMotion ? 0 : Math.sin(t * 1.5) * (1.5 + float * 8);
    if (S.bounce && !reducedMotion) target.bob -= Math.abs(Math.sin(t * S.bounceRate * Math.PI)) * S.bounce;
    target.breath = (S.breath ?? 1) * (Math.sin(t * 2) * 0.5 + 0.5) * 2.2;
    if (S.squeeze) target.squash = S.squeeze * (Math.sin(t * 3.4) * 0.5 + 0.5);
    if (S.sway) target.head += Math.sin(t * 1.3) * S.sway;
    if (S.nodRate) target.nod = Math.sin(t * S.nodRate * 6.283) * S.nodSize;
    if (S.lookSweep) target.lookX = Math.sin(t * 2) * S.lookSweep;
    if (S.wobble) { target.rot += Math.sin(t * 5.5) * S.wobble; target.head += Math.sin(t * 7) * S.wobble * 0.6; }
    if (S.shake) target.shiftX = Math.sin(t * 64) * S.shake;

    // Being low on dried fish sags whatever she is doing, more so at rest.
    const resting = activeName === 'idle';
    const sag = mood.quota === 'critical' ? 1 : mood.quota === 'low' ? 0.5 : 0;
    if (sag && activeName !== 'exhausted' && !S.docked) {
      const weight = sag * (resting ? 1 : 0.5);
      target.ahoge += 0.28 * weight;
      target.earL += 0.1 * weight;
      target.earR -= 0.1 * weight;
      target.hairLift *= 1 - 0.8 * weight;
      target.tailAmp *= 1 - 0.55 * weight;
      target.tailFreq *= 1 - 0.3 * weight;
      target.shiftY *= 1 - 0.8 * weight;
    }

    const add = { ...zero };
    gestures = gestures.filter(g => {
      const p = (now - g.born) / g.ms;
      if (p >= 1) return false;
      g.run(p, add, t);
      return true;
    });

    const rate = 1 - Math.exp(-dt * (activeName === 'dragged' ? 16 : 6));
    for (const key of Object.keys(P)) P[key] = lerp(P[key], target[key], rate);

    // Follow-through: hair and tail trail the body, the ahoge rings.
    const vx = clamp(motion.vx, -2600, 2600), vy = clamp(motion.vy, -2600, 2600);
    const hairL = stepSpring(springs.hairL, -vx * 0.017, 60, 7, dt);
    const hairR = stepSpring(springs.hairR, -vx * 0.02, 52, 6, dt);
    const ahoge = stepSpring(springs.ahoge, -vx * 0.00032 + vy * 0.0002, 120, 8, dt);
    const tail = stepSpring(springs.tail, vx * 0.00048 + vy * 0.00016, 30, 7.5, dt);
    const skirt = stepSpring(springs.skirt, -vx * 0.006, 80, 7, dt);

    const output = {};
    for (const key of Object.keys(P)) output[key] = P[key] + add[key];
    output.hairSwayL = hairL;
    output.hairSwayR = hairR;
    output.ahoge += ahoge + Math.sin(t * 2.3) * 0.016;
    output.tailSpring += tail;
    tailPhase = (tailPhase + dt * Math.max(0, output.tailFreq) * 6.283) % 6.283;
    output.tailPhase = tailPhase;
    output.skirt = skirt + Math.sin(t * 1.15) * 0.9;
    output.lean = clamp(output.lean + vx * 0.00002, -0.28, 0.28);
    output.rot += clamp(vx * 0.00004, -0.34, 0.34);
    output.opacity = clamp(1 + add.opacity, 0, 1);

    if (talking) {
      talkClock -= dt;
      if (talkClock <= 0) { play('talk'); talkClock = rand(0.34, 0.6); }
    }

    // Blinks: down fast, up slower, sometimes twice.
    nextBlink -= dt;
    if (blinkStage === 0 && nextBlink <= 0 && !S.noBlink) { blinkStage = 1; blinkClock = 0; doubleBlink = Math.random() < 0.16; nextBlink = rand(2.2, 6.2); }
    if (blinkStage === 1) {
      blinkClock += dt;
      blink = clamp(blinkClock / 0.06, 0, 1);
      if (blinkClock >= 0.1) { blinkStage = 2; blinkClock = 0; }
    } else if (blinkStage === 2) {
      blinkClock += dt;
      blink = 1 - clamp(blinkClock / 0.1, 0, 1);
      if (blinkClock >= 0.1) {
        if (doubleBlink) { doubleBlink = false; blinkStage = 1; blinkClock = 0; } else blinkStage = 0;
      }
    } else blink = 0;

    if (!reducedMotion) {
      nextFidget -= dt;
      if (nextFidget <= 0) fidget();
    }

    const showStash = (S.stash || mood.showStash || mood.quota === 'low' || mood.quota === 'critical');
    fx.setStash(showStash ? { level: mood.stashLevel ?? 1, label: mood.stashLabel || '' } : null);
    fx.setClones(activeName === 'exhausted' || activeName === 'sleeping' || S.docked ? 0 : mood.subagents);

    return { P: output, poseName, activeName, blink, sleeping: !!S.sleeping };
  }

  return {
    update,
    play,
    setState(name) { if (HAGEMI.STATES[name]) state = name; },
    override(name, ms, then) {
      if (HAGEMI.STATES[name]) { overrideState = name; overrideUntil = performance.now() + ms; overrideThen = then || null; }
    },
    clearOverride(name) { if (!name || overrideState === name) { overrideState = null; overrideThen = null; } },
    setMood(next) { mood = { ...mood, ...next }; },
    setReducedMotion(value) { reducedMotion = value; },
    setTalking(value) { talking = value; talkClock = 0; },
    get state() { return current(); },
    get busy() { return gestures.length > 0 || current() === 'dragged'; },
  };
};


// The pet's presence on screen: stage, pose loading, drag and throw, petting, bubble, menu and
// the bridge to the sidecar. It all lives in a closed shadow root so the app's UI is untouched.
HAGEMI.boot = async function boot(send, options = {}) {
  const { clamp, lerp, rand } = HAGEMI.util;
  const { STAGE, MARGIN } = HAGEMI;
  // 舒适适中手办尺寸梯度，触碰手感绝佳，超清无锯齿
  const SIZES = { xs: 88, s: 112, m: 138, l: 175, xl: 225 };
  const HOST_ID = 'hagemi-pet-host';
  const FADE_MS = 120;
  const POSE_CACHE = 10;

  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(HAGEMI.css);
  root.adoptedStyleSheets = [sheet];

  const make = (tag, className, parent = root) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  };
  const stage = make('div', 'stage');
  const backCanvas = make('canvas', 'layer', stage);
  const glCanvas = make('canvas', 'layer', stage);
  const frontCanvas = make('canvas', 'layer', stage);
  const hit = make('div', 'hit', stage);
  const bubble = make('div', 'bubble');
  const bubbleMark = make('span', 'mark', bubble);
  const bubbleText = make('span', 'text', bubble);
  const hud = make('div', 'hud');
  const menu = make('div', 'menu');
  menu.setAttribute('role', 'menu');
  const panel = make('div', 'panel');
  panel.setAttribute('role', 'dialog');

  let leaving = 0, running = true;
  const rig = HAGEMI.createRig(glCanvas, () => { if (running) { dispose(); send({ type: 'remount' }); } });
  if (!rig) { send({ type: 'error', message: 'webgl2-unavailable' }); return null; }
  const fx = HAGEMI.createFx(backCanvas, frontCanvas);
  const animator = HAGEMI.createAnimator(fx);

  // 立即继承上次拖拽保存的精确坐标，第一帧就放置在记忆位置
  const initPos = options.initialSettings?.position;
  let savedAiSettings = {};
  try {
    const rawAi = localStorage.getItem('hagemi_ai_settings');
    if (rawAi) savedAiSettings = JSON.parse(rawAi);
  } catch {}

  let settings = {
    language: options.initialSettings?.lang || 'zhs',
    size: options.initialSettings?.size || 'm',
    hidden: options.initialSettings?.enabled === false,
    muted: options.initialSettings?.chattiness === 'silent',
    animation: 'balanced',
    followCursor: true,
    quotaHoverDelayMs: 650,
    position: initPos && Number.isFinite(initPos.x) && Number.isFinite(initPos.y) ? { ...initPos } : null,
    ai: {
      enabled: false,
      model: 'auto',
      apiBaseUrl: '',
      apiKey: '',
      customModel: '',
      contextLevel: 'titles',
      minIntervalMin: 3,
      maxPerHour: 12,
      maxPerDay: 80,
      dailyTokenBudget: 50000,
      pauseBelowQuota: 0.1,
      onlyWhenFocused: true,
      personaExtra: '',
      ...savedAiSettings,
    },
  };
  const getUiDict = (lang) => HAGEMI.UI[lang === 'en' ? 'en' : 'zhs'] || HAGEMI.UI.zhs;
  let ui = { ...getUiDict(settings.language) };
  let hudRows = [];
  try {
    const cachedHud = localStorage.getItem('hagemi_last_quota_hud');
    if (cachedHud) {
      const parsed = JSON.parse(cachedHud);
      if (Array.isArray(parsed) && parsed.length > 0) hudRows = parsed;
    }
  } catch {}
  let scale = 0, pixelRatio = 0, spriteW = 0, spriteH = 0;
  let x = 0, y = 0, vx = 0, vy = 0;
  let dragging = null;
  const abort = new AbortController();
  const listen = (target, type, handler, extra = {}) => target.addEventListener(type, handler, { signal: abort.signal, ...extra });

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  animator.setReducedMotion(reducedMotion.matches);
  listen(reducedMotion, 'change', () => animator.setReducedMotion(reducedMotion.matches));

  // ---- Art: requested over the sidecar bridge, one pose at a time --------------------------
  const blobs = new Map(), pendingArt = new Map(), poses = new Map(), building = new Map();
  let current = null, previous = null, fade = 1, fadeStart = 0, wantedPose = null;

  function requestArt(name) {
    if (blobs.has(name)) return Promise.resolve(blobs.get(name));
    if (pendingArt.has(name)) return pendingArt.get(name).promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pendingArt.set(name, { promise, resolve });
    send({ type: 'art', name });
    return promise;
  }
  function receiveArt(name, data) {
    const entry = pendingArt.get(name);
    let blob = null;
    if (data) {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      blob = new Blob([bytes], { type: 'image/webp' });
      blobs.set(name, blob);
    }
    pendingArt.delete(name);
    entry?.resolve(blob);
  }
  const decode = blob => createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });

  async function ensurePose(name) {
    if (poses.has(name)) return poses.get(name);
    if (building.has(name)) return building.get(name);
    const job = (async () => {
      const info = HAGEMI.rigData[name];
      if (!info) return null;
      const files = await Promise.all([
        requestArt(name),
        info.blink ? requestArt(`blink/${name}`) : null,
        ...['tail', 'under', 'cut'].map(layer => (info.tailRect ? requestArt(`${layer}/${name}`) : null)),
      ]);
      if (!files[0] || !running) return null;
      const layers = await Promise.all(files.map(blob => (blob ? decode(blob) : null)));
      const pose = rig.buildPose(name, ...layers, info);
      for (const layer of layers) layer?.close();
      poses.set(name, pose);
      // Keep only the poses in recent use on the GPU; the compressed art stays in memory.
      if (poses.size > POSE_CACHE) for (const [other, value] of poses) {
        if (value !== current && value !== previous && other !== wantedPose) { rig.freePose(value); poses.delete(other); break; }
      }
      return pose;
    })().finally(() => building.delete(name));
    building.set(name, job);
    return job;
  }
  async function preloadClones() {
    const art = await requestArt('idle');
    if (!art || !running) return;
    fx.setCloneImage(await createImageBitmap(art, { resizeWidth: 222, resizeHeight: 256, resizeQuality: 'high' }));
  }
  function usePose(name) {
    if (wantedPose === name || !name) return;
    wantedPose = name;
    ensurePose(name).then(pose => {
      if (!pose || wantedPose !== name || current === pose) return;
      previous = current;
      current = pose;
      fade = previous ? 0 : 1;
      fadeStart = performance.now();
      if (previous) animator.play('pop');
    });
  }

  function applySize() {
    const height = SIZES[settings.size] || SIZES.m;
    scale = height / STAGE.h;
    // 超清视网膜高分屏支持，最低 2x 采样，最高 3x 超采样，画质极其锋利细腻
    pixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    spriteW = 500 * scale;
    spriteH = height;
    const cssW = (STAGE.w + MARGIN * 2) * scale, cssH = (STAGE.h + MARGIN * 2) * scale;
    const pixelW = Math.round(cssW * pixelRatio), pixelH = Math.round(cssH * pixelRatio);
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    hit.style.left = `${MARGIN * scale}px`;
    hit.style.top = `${MARGIN * scale}px`;
    hit.style.width = `${STAGE.w * scale}px`;
    hit.style.height = `${spriteH}px`;
    rig.resize(pixelW, pixelH);
    fx.resize(pixelW, pixelH);
    keepInBounds();
  }

  // 手机端软键盘适配：优先读取 visualViewport 视口，输入法弹起时自动缩小可视区域
  const viewW = () => (window.visualViewport ? window.visualViewport.width : window.innerWidth);
  const viewH = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);

  function keepInBounds() {
    if (docked) {
      x = docked === 'left' ? 0 : viewW();
      y = clamp(y, spriteH * 0.3, Math.max(spriteH * 0.3, viewH() - spriteH * 0.3));
      return;
    }
    const marginX = spriteW * 0.22, marginY = spriteH * 0.2;
    x = clamp(x, marginX, Math.max(marginX, viewW() - marginX));
    // 手机端软键盘弹起时向上避让安全区，绝不遮挡输入法
    const bottomSafe = viewH() < window.innerHeight * 0.8 ? spriteH * 0.35 : marginY;
    y = clamp(y, marginY, Math.max(marginY, viewH() - bottomSafe));
  }

  // Her spot is kept as a fraction of the window: a hidden window measures zero when she
  // arrives, and a resize should carry her along rather than strand her.
  let anchor = null, docked = null;
  function placeInitial() {
    const p = settings.position;
    anchor = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    docked = p && (p.dock === 'left' || p.dock === 'right') ? p.dock : null;
    settle();
  }
  function settle() {
    if (viewW() < 8 || viewH() < 8) return;
    if (!anchor) anchor = { x: 1 - (spriteW * 0.7) / viewW(), y: 1 - (spriteH * 0.62) / viewH() };
    x = anchor.x * viewW();
    y = anchor.y * viewH();
    keepInBounds();
  }

  // ---- Bubble ---------------------------------------------------------------------------
  let lastKeyAt = -1e9, lastPointerAt = performance.now();
  let speech = null, speechQueue = [];
  function placeBubble() {
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    const headX = docked === 'left' ? x + spriteW * 0.26 : docked === 'right' ? x - spriteW * 0.26 : x, top = y - spriteH * 0.52;
    let left = clamp(headX - width / 2, 8, viewW() - width - 8), topPx = top - height - 4, side = 'above';
    if (topPx < 6) {
      const roomRight = viewW() - (x + spriteW * 0.5);
      if (roomRight > width + 12) { left = x + spriteW * 0.46; side = 'right'; } else { left = Math.max(8, x - spriteW * 0.46 - width); side = 'left'; }
      topPx = clamp(y - spriteH * 0.38, 6, viewH() - height - 6);
    }
    bubble.style.transform = `translate3d(${left}px, ${topPx}px, 0)`;
    bubble.dataset.side = side;
    bubble.style.setProperty('--tail-x', `${clamp(headX - left, 18, width - 18)}px`);
  }
  function startSpeech(item) {
    if (!item || !item.text) return;
    if (settings.hidden || (settings.hiddenUntil && Date.now() < settings.hiddenUntil)) {
      speech = null;
      speechQueue = [];
      closeBubble();
      return;
    }
    const cjk = /[㐀-鿿぀-ヿ]/.test(item.text);
    speech = { ...item, chars: Array.from(item.text), shown: 0, clock: 0, step: cjk ? 0.042 : 0.019, finished: 0, hold: item.ms || clamp(1900 + item.text.length * (cjk ? 110 : 48), 2900, 9500) };
    bubbleText.textContent = '';
    bubbleMark.textContent = item.ai ? '✦' : '';
    bubble.style.display = '';
    bubble.classList.add('show');
    placeBubble();
    const mood = HAGEMI.MOODS[item.mood];
    if (mood && !sulking && !dragging && !docked) animator.override(mood, speech.hold + 600);
    animator.setTalking(true);
  }
  function stepSpeech(dt, now) {
    if (settings.hidden || (settings.hiddenUntil && Date.now() < settings.hiddenUntil)) {
      if (speech || bubble.classList.contains('show')) closeBubble();
      speechQueue = [];
      return;
    }
    if (!speech) {
      // Keep quiet while someone is typing, then speak.
      if (speechQueue.length && (now - lastKeyAt > 1400 || now - speechQueue[0].queuedAt > 12000)) startSpeech(speechQueue.shift());
      return;
    }
    if (speech.shown < speech.chars.length) {
      speech.clock += dt;
      while (speech.clock >= speech.step && speech.shown < speech.chars.length) {
        speech.clock -= speech.step;
        speech.shown++;
      }
      bubbleText.textContent = speech.chars.slice(0, speech.shown).join('');
      placeBubble();
      if (speech.shown >= speech.chars.length) { speech.finished = now; animator.setTalking(false); }
    } else if (!bubble.matches(':hover') && now - speech.finished > speech.hold) {
      closeBubble();
    }
  }
  function closeBubble() {
    speech = null;
    animator.setTalking(false);
    bubble.classList.remove('show');
    bubbleText.textContent = '';
    bubbleMark.textContent = '';
  }
  listen(bubble, 'click', closeBubble);

  // ---- HUD and menu ---------------------------------------------------------------------
  function sanitizeQuotaTextZh(val) {
    if (!val) return '';
    let s = String(val);
    // 匹配 Google 官方英文长句: "(You have used some of your 5-hour limit, it will fully refresh in 3 hours.)"
    const mRefresh = s.match(/(?:fully\s+refresh|resets?|access\s+again)\s+in\s+(\d+)\s*(?:hours?|h)(?:\s*(?:and\s*)?(\d+)\s*(?:min(?:ute)?s?|m))?/i);
    if (mRefresh) {
      const h = mRefresh[1], m = mRefresh[2];
      const timeStr = h && m ? `${h}小时${m}分钟` : `${h}小时`;
      s = s.replace(/\([^\)]*(?:fully\s+refresh|resets?|access\s+again)[^\)]*\)/gi, `(${timeStr})`);
    }
    // 英文天数+小时: "6 days, 7 hours" -> "6天 7小时"
    s = s.replace(/(\d+)\s*days?(?:\s*,?\s*(\d+)\s*hours?)?/gi, (_, d, h) => (h && h !== '0' ? `${d}天 ${h}小时` : `${d}天`));
    // 英文小时+分钟: "3 hours, 20 minutes" -> "3小时 20分钟"
    s = s.replace(/(\d+)\s*hours?(?:\s*,?\s*(\d+)\s*(?:min(?:ute)?s?|m))?/gi, (_, h, m) => (m && m !== '0' ? `${h}小时 ${m}分钟` : `${h}小时`));
    // 英文分钟: "45 minutes" -> "45分钟"
    s = s.replace(/(\d+)\s*(?:min(?:ute)?s?|m)\b/gi, '$1分钟');
    return s;
  }

  function renderHud() {
    hud.replaceChildren();
    const titleRow = make('div', 'row', hud);
    titleRow.style.cssText = 'border-bottom:1px solid rgba(167,139,250,0.35);padding-bottom:3px;margin-bottom:2px;font-weight:700;color:#c4b5fd;display:flex;align-items:center;gap:5px;font-size:11px;';
    make('span', '', titleRow).textContent = '🐟 小鱼干配额 (Antigravity主算力)';
    for (const row of hudRows) {
      const line = make('div', 'row', hud);
      make('span', 'label', line).textContent = row.label;
      if (row.level != null) {
        const meter = make('span', 'meter', line);
        const fill = make('span', 'fill', meter);
        fill.style.width = `${Math.round(row.level * 100)}%`;
        fill.dataset.tone = row.level < 0.1 ? 'bad' : row.level < 0.25 ? 'warn' : 'ok';
      }
      make('span', 'value', line).textContent = sanitizeQuotaTextZh(row.value);
    }
  }
  function placeHud() {
    const width = hud.offsetWidth || 220, height = hud.offsetHeight || 64;
    const left = clamp(x - width / 2, 8, Math.max(8, viewW() - width - 8));
    // 优先显示在猫娘头顶上方；当头顶紧贴屏幕上沿时才向下避让
    const above = y - spriteH * 0.52 - height - 8;
    const top = above >= 8 ? above : clamp(y + spriteH * 0.52 + 8, 8, Math.max(8, viewH() - height - 8));
    hud.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }
  let hoverTimer = 0;
  let autoHideTimer = 0;
  let hudLockedUntil = 0;
  function showHud(autoHideMs = 2600) {
    if (!hudRows || !hudRows.length) {
      try {
        const cached = localStorage.getItem('hagemi_last_quota_hud');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) hudRows = parsed;
        }
      } catch {}
    }
    if (!hudRows || !hudRows.length) {
      hudRows = [
        { label: '5h小鱼干', level: 0.8, value: '计算中...' },
        { label: '周度小鱼干', level: 0.8, value: '计算中...' }
      ];
    }
    if (!dragging && !menu.classList.contains('show') && !panel.classList.contains('show')) {
      clearTimeout(hoverTimer);
      clearTimeout(autoHideTimer);
      closeBubble();
      renderHud();
      hud.classList.add('show');
      hud.style.opacity = '1';
      hud.style.visibility = 'visible';
      hud.style.display = 'grid';
      placeHud();
      animator.setMood({ showStash: true });
      
      const duration = autoHideMs || 2600;
      hudLockedUntil = performance.now() + 600; // 600ms 锁定门阀，防止手机手指抬起微小抖动秒关
      autoHideTimer = setTimeout(() => {
        hideHud(true);
      }, duration);
    }
  }
  function hideHud(force = false) {
    if (!force && performance.now() < hudLockedUntil) {
      // 处于点击锁定时间窗口内，防止手机触屏抬起 pointerleave 闪退误关
      return;
    }
    clearTimeout(hoverTimer);
    clearTimeout(autoHideTimer);
    hudLockedUntil = 0;
    hud.classList.remove('show');
    hud.style.opacity = '0';
    hud.style.visibility = 'hidden';
    animator.setMood({ showStash: false });
  }

  // ---- AI 动态吐槽与即兴互动引擎 -------------------------------------------------------------
  let isAiGenerating = false;
  async function handleTalkAction(forceAi = false) {
    let ai = settings.ai || {};
    try {
      const rawAi = localStorage.getItem('hagemi_ai_settings');
      if (rawAi) ai = { ...ai, ...JSON.parse(rawAi) };
    } catch {}

    const hasCustomConfig = Boolean(ai.apiKey || ai.apiBaseUrl);
    const isOfficial = !hasCustomConfig || ai.model === 'official' || (!ai.apiKey && !ai.apiBaseUrl);

    // 1. 如果用户选择“官方原生模式”或未配置第三方 API，直接触发官方原生元气台词（100% 成功，0 门槛）
    if (isOfficial) {
      if (isAiGenerating) return;
      const officialLines = [
        '今天也要元气满满地敲代码喵！',
        '百万上下文在手，天下我有喵~',
        '坐久了记得起来伸个懒腰，喝口温水喵！',
        '键盘火花带闪电，Bug全部逃不掉！',
        '本喵的小鱼干储备超充沛，随时为你护航喵~',
        '悄悄告诉你，本喵最喜欢看你认真写代码了~',
        '盯——有什么有趣的难题需要本喵参谋吗？',
        '主人写代码的样子真帅气喵！',
        '遇到报错别慌，本喵随时为你加油打气喵！',
        '今天代码写得超顺，继续保持元气节奏喵~'
      ];
      const pick = officialLines[Math.floor(Math.random() * officialLines.length)];
      animator.override('gift', 1800);
      fx.burst('notes', STAGE.cx, 380, 8);
      startSpeech({ text: `✨ ${pick}`, mood: 'happy', ms: 4000 });
      return;
    }

    // 2. 第三方大模型接管模式
    if (forceAi || ai.enabled) {
      if (isAiGenerating) return;

      isAiGenerating = true;
      animator.override('thinking', 3000);
      startSpeech({ text: '💭 正在灵光一闪中喵...', mood: 'smug', ms: 10000 });

      try {
        let baseUrl = (ai.apiBaseUrl || 'https://api.openai.com/v1').trim();
        baseUrl = baseUrl.replace(/\/+$/, '');
        let endpoint = baseUrl;
        if (!endpoint.endsWith('/chat/completions')) {
          endpoint = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`;
        }

        let targetModel = (ai.customModel || '').trim();
        if (!targetModel && ai.model && ai.model !== 'auto' && ai.model !== 'custom' && ai.model !== 'official') {
          targetModel = ai.model.trim();
        }

        // 防呆检测：如果使用 SiliconFlow 等第三方地址，且未指定模型或误设为 gemini，自动纠偏
        if (endpoint.includes('siliconflow') && (!targetModel || targetModel.includes('gemini'))) {
          targetModel = (ai.customModel || 'Qwen/Qwen3.5-4B').trim();
        }

        if (!targetModel) {
          startSpeech({ text: '请在哈基米设置中填入您 API 支持的模型名称喵~', mood: 'sad', ms: 4000 });
          isAiGenerating = false;
          return;
        }

        const systemPrompt = `你是一只陪伴主人写代码的二次元猫娘桌面宠物“哈基米（Hagemi）”。性格活泼可爱、喜欢吃小鱼干、口癖带“喵~”。
针对主人的写代码场景即兴吐槽或闲聊。纯中文，20字以内，末尾带“喵~”，严禁输出任何引号或解释。
${ai.personaExtra ? `主人补充设定：${ai.personaExtra}` : ''}`;

        const headers = {
          'Content-Type': 'application/json',
        };
        if (ai.apiKey) {
          headers['Authorization'] = `Bearer ${ai.apiKey.trim()}`;
        }

        // 放宽到 25 秒超时，充分包容云端大模型高峰期排队与网络延迟
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: targetModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: '主人戳了戳你，让你说点什么喵~' }
            ],
            max_tokens: 45,
            temperature: 0.8,
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn('[Hagemi AI] Error:', res.status, errText);
          startSpeech({ text: `呜，AI接口报错(${res.status})，请检查API和Key喵~`, mood: 'sad', ms: 4000 });
          return;
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          const cleanText = text.replace(/^["'“”]+|["'“”]+$/g, '');
          animator.override('happy', 2200);
          fx.burst('notes', STAGE.cx, 380, 8);
          startSpeech({ text: `✨ ${cleanText}`, mood: 'proud', ms: 5000 });
        } else {
          startSpeech({ text: '脑子里一片空白喵……', mood: 'sad', ms: 3000 });
        }
      } catch (err) {
        console.warn('[Hagemi AI] Request failed:', err);
        const isAbort = err?.name === 'AbortError';
        startSpeech({
          text: isAbort ? '外部AI响应有点慢超时了喵，请稍后再试一次喵~' : '连接API失败，请检查网络或跨域设置喵~',
          mood: 'sad',
          ms: 4500
        });
      } finally {
        isAiGenerating = false;
      }
      return;
    }

    // 默认兜底台词
    const preset = [
      '今天也要元气满满地敲代码喵！',
      '百万上下文在手，天下我有喵~',
      '坐久了记得起来伸个懒腰，喝口水喵！',
      '键盘火花带闪电，Bug全部逃不掉！',
      '本喵的小鱼干储备还充足吗喵？',
      '悄悄告诉你，本喵最喜欢看你写代码了~',
      '盯——有什么有趣的难题需要本喵参谋吗？'
    ];
    const pick = preset[Math.floor(Math.random() * preset.length)];
    animator.override('gift', 1500);
    startSpeech({ text: pick, mood: 'happy', ms: 3500 });
  }

  // 定时自主 AI 吐槽调度器
  let aiIntervalTimer = null;
  function scheduleAiComments() {
    if (aiIntervalTimer) clearInterval(aiIntervalTimer);
    let ai = settings.ai || {};
    try {
      const rawAi = localStorage.getItem('hagemi_ai_settings');
      if (rawAi) ai = { ...ai, ...JSON.parse(rawAi) };
    } catch {}

    if (!ai.enabled || (!ai.apiKey && !ai.apiBaseUrl)) return;
    const intervalMin = Math.max(1, Math.min(60, Number(ai.minIntervalMin) || 3));
    aiIntervalTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && !settings.muted && !dragging) {
        handleTalkAction(false);
      }
    }, intervalMin * 60 * 1000);
  }

  function openMenu(px, py) {
    // The status panel would open behind the menu once the hover delay ran out.
    clearTimeout(hoverTimer);
    hideHud();
    menu.replaceChildren();
    const item = (label, action, checked) => {
      const button = make('button', 'item', menu);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = (checked ? '✓ ' : '') + label;
      button.addEventListener('click', () => { closeMenu(); action(); });
    };
    const divider = () => make('div', 'divider', menu);
    item('✨ 召唤 AI 即兴吐槽', () => handleTalkAction(true));
    item(ui.talk || '说点什么', () => handleTalkAction(false));
    item(ui.pat || '摸摸头', () => petted());
    divider();
    item(ui.language_zhs || '简体中文', () => patch({ language: 'zhs' }), settings.language === 'zhs');
    item(ui.language_en || 'English', () => patch({ language: 'en' }), settings.language === 'en');
    item(ui.language_auto || '跟随应用语言', () => patch({ language: 'auto' }), settings.language === 'auto');
    divider();
    for (const [key, label] of [
      ['xs', ui.size_xs || '小巧便携 (88px)'],
      ['s', ui.size_s || '舒适微型 (112px)'],
      ['m', ui.size_m || '标准手办 (138px - 推荐)'],
      ['l', ui.size_l || '清晰赏玩 (175px)'],
      ['xl', ui.size_xl || '特大展示 (225px)'],
    ]) item(label, () => patch({ size: key }), settings.size === key);
    divider();
    item(ui.mute || '静音 (不要说话)', () => patch({ muted: !settings.muted }), settings.muted);
    item(ui.ai || 'AI 动态吐槽', () => patch({ ai: { enabled: !settings.ai?.enabled } }), settings.ai?.enabled);
    item(ui.settings || '哈基米设置…', () => openPanel());
    item(ui.hide || '隐藏 1 小时', () => patch({ hiddenUntil: Date.now() + 3600000 }));
    menu.classList.add('show');
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.transform = `translate3d(${clamp(px, 6, viewW() - width - 6)}px, ${clamp(py, 6, viewH() - height - 6)}px, 0)`;
  }
  function closeMenu() { menu.classList.remove('show'); }
  // A closed shadow root hides its insides from the window, so clicks are told apart in two places:
  // the window only sees clicks elsewhere in the app, and the root sees which of her parts was hit.
  listen(window, 'pointerdown', event => {
    if (!event.composedPath().includes(host)) {
      closeMenu();
      closePanel();
      hideHud(true);
    }
  }, { capture: true });
  listen(root, 'pointerdown', event => {
    const path = event.composedPath();
    if (!path.includes(menu)) closeMenu();
    if (!path.includes(panel) && !path.includes(menu)) closePanel();
  }, { capture: true });

  // Settings live on the pet: the app offers plugins no way to open a pane on demand.
  let modelChoices = [], usage = null;
  function openPanel() {
    panel.replaceChildren();
    const s = settings, ai = settings.ai || {};
    const head = make('div', 'panel-head', panel);
    make('b', '', head).textContent = ui.settings_title || '哈基米设置 (Hagemi)';
    const close = make('button', 'panel-close', head);
    close.type = 'button';
    close.setAttribute('aria-label', ui.close || '关闭');
    close.textContent = '×';
    close.addEventListener('click', closePanel);
    const section = title => { make('div', 'panel-section', panel).textContent = title; };
    const field = (label, control) => {
      const row = make('label', 'field', panel);
      make('span', '', row).textContent = label;
      row.appendChild(control);
    };
    const select = (value, options, onChange) => {
      const control = document.createElement('select');
      for (const [key, text] of options) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = text || key;
        option.style.cssText = 'color:#2a1b3d !important;background-color:#ffffff !important;';
        control.appendChild(option);
      }
      control.value = value;
      control.addEventListener('change', () => onChange(control.value));
      return control;
    };
    const check = (value, onChange) => {
      const control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = !!value;
      control.addEventListener('change', () => onChange(control.checked));
      return control;
    };
    const number = (value, min, max, onChange) => {
      const control = document.createElement('input');
      control.type = 'number';
      control.min = min;
      control.max = max;
      control.value = value;
      control.addEventListener('change', () => onChange(Number(control.value)));
      return control;
    };
    const textInput = (value, placeholder, isPassword, onChange) => {
      const control = document.createElement('input');
      control.type = isPassword ? 'password' : 'text';
      control.value = value || '';
      control.placeholder = placeholder || '';
      control.style.cssText = 'color:#2a1b3d !important;background-color:#ffffff !important;border:1px solid #d9cffb;border-radius:7px;padding:4px 8px;font-size:12px;width:148px;box-sizing:border-box;';
      control.addEventListener('input', () => onChange(control.value.trim()));
      return control;
    };
    section(ui.section_pet || '桌宠外观与表现');
    field(ui.language || '界面语言', select(s.language, [['zhs', ui.language_zhs || '简体中文'], ['auto', ui.language_auto || '跟随系统'], ['en', ui.language_en || 'English']], value => patch({ language: value })));
    field(ui.size || '显示尺寸', select(s.size, [['xs', ui.size_xs || '小巧便携 (88px)'], ['s', ui.size_s || '舒适微型 (112px)'], ['m', ui.size_m || '标准手办 (138px)'], ['l', ui.size_l || '清晰赏玩 (175px)'], ['xl', ui.size_xl || '特大展示 (225px)']], value => patch({ size: value })));
    field(ui.animation || '动画流畅度', select(s.animation, [['smooth', ui.animation_smooth || '高刷流畅 (60fps)'], ['balanced', ui.animation_balanced || '均衡省电 (30fps)'], ['saver', ui.animation_saver || '极简节电 (20fps)']], value => patch({ animation: value })));
    field(ui.chattiness || '吐槽互动频率', select(s.chattiness, [['quiet', ui.chattiness_quiet || '安静 (偶尔冒泡)'], ['normal', ui.chattiness_normal || '正常 (适度互动)'], ['chatty', ui.chattiness_chatty || '话痨 (元气活跃)']], value => patch({ chattiness: value })));
    field(ui.followCursor || '视线跟随鼠标/触摸', check(s.followCursor, value => patch({ followCursor: value })));
    field(ui.quotaHoverDelayMs || '额度悬停延迟 (毫秒, 0 = 立即)', number(s.quotaHoverDelayMs, 0, 10000, value => patch({ quotaHoverDelayMs: value })));
    field(ui.mute || '静音 (不要说话)', check(s.muted, value => patch({ muted: value })));
    section(ui.section_ai || 'AI 动态吐槽');
    const aiNote = make('div', 'panel-note', panel);
    aiNote.style.cssText = 'color:#6b21a8;background:rgba(237,233,254,0.7);border-left:3px solid #8b5cf6;padding:5px 8px;margin:3px 0 8px;border-radius:4px;font-size:11px;line-height:1.4;';
    aiNote.textContent = '💡 提示：此处自定义 API（如 SiliconFlow）仅用于驱动猫娘即兴发声吐槽；头顶「小鱼干配额」用于监控当前 Google Antigravity 主站算力，两者互不影响。';
    field(ui.ai_enabled || '开启 AI 动态吐槽', check(ai.enabled, value => patch({ ai: { enabled: value } })));
    field('API 接口地址', textInput(ai.apiBaseUrl, 'https://... (默认系统)', false, value => patch({ ai: { apiBaseUrl: value } })));
    field('API 密钥 (Key)', textInput(ai.apiKey, 'sk-... (留空走系统)', true, value => patch({ ai: { apiKey: value } })));
    
    // 清晰划分官方原生模式与第三方大模型接管模式
    const modelOptions = [
      ['official', '✨ 官方原生元气陪伴（开箱即用，免配置）'],
      ['custom', '🤖 第三方大模型接管（需下方填Key和模型）'],
      ['gemini-3.8-flash', 'Google Gemini 3.8 Flash（需配Gemini Key）'],
    ];
    if (ai.model && !modelOptions.some(m => m[0] === ai.model)) {
      modelOptions.push([ai.model, ai.model]);
    }
    field(ui.ai_model || '推理模型', select(ai.model || 'official', modelOptions, value => patch({ ai: { model: value } })));
    field('自定义模型名', textInput(ai.customModel, '输入您 API 支持的模型名称', false, value => patch({ ai: { customModel: value } })));

    // 专属 API 连通性测试按钮与实时诊断容器
    const testRow = make('div', 'panel-test-row', panel);
    testRow.style.cssText = 'margin: 8px 0 10px; display: flex; flex-direction: column; gap: 6px;';
    
    const testBtn = make('button', 'panel-test-btn', testRow);
    testBtn.type = 'button';
    testBtn.textContent = '🧪 立即测试 API 连通性';
    testBtn.style.cssText = 'width: 100%; padding: 7px 12px; background: #8b5cf6; color: #ffffff; border: 0; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; transition: background 0.15s; box-shadow: 0 2px 6px rgba(139, 92, 246, 0.35);';
    testBtn.addEventListener('mouseenter', () => { testBtn.style.background = '#7c3aed'; });
    testBtn.addEventListener('mouseleave', () => { testBtn.style.background = '#8b5cf6'; });

    const testResult = make('div', 'panel-test-result', testRow);
    testResult.style.cssText = 'font-size: 11.5px; line-height: 1.4; border-radius: 6px; padding: 0; display: none; word-break: break-all;';

    testBtn.addEventListener('click', async () => {
      let currentAi = settings.ai || {};
      try {
        const raw = localStorage.getItem('hagemi_ai_settings');
        if (raw) currentAi = { ...currentAi, ...JSON.parse(raw) };
      } catch {}

      const hasCfg = Boolean(currentAi.apiKey || currentAi.apiBaseUrl);
      if (!hasCfg && !currentAi.apiKey) {
        testResult.style.display = 'block';
        testResult.style.padding = '6px 8px';
        testResult.style.background = '#fef2f2';
        testResult.style.color = '#dc2626';
        testResult.textContent = '请先填写 API 接口地址与 API 密钥 (Key) 喵~';
        return;
      }

      testBtn.disabled = true;
      testBtn.textContent = '⏳ 正在向模型发起测试握手...';
      testResult.style.display = 'block';
      testResult.style.padding = '6px 8px';
      testResult.style.background = '#f3f4f6';
      testResult.style.color = '#4b5563';
      testResult.textContent = '正在连接端点，请稍候...';

      try {
        let baseUrl = (currentAi.apiBaseUrl || 'https://api.openai.com/v1').trim();
        baseUrl = baseUrl.replace(/\/+$/, '');
        let endpoint = baseUrl;
        if (!endpoint.endsWith('/chat/completions')) {
          endpoint = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`;
        }

        let targetModel = (currentAi.customModel || '').trim();
        if (!targetModel && currentAi.model && currentAi.model !== 'auto' && currentAi.model !== 'custom') {
          targetModel = currentAi.model.trim();
        }
        if (!targetModel) {
          targetModel = 'gemini-3.8-flash';
        }

        const headers = { 'Content-Type': 'application/json' };
        if (currentAi.apiKey) headers['Authorization'] = `Bearer ${currentAi.apiKey.trim()}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const startTime = performance.now();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: targetModel,
            messages: [
              { role: 'user', content: '测试握手，请回复：连接成功喵！' }
            ],
            max_tokens: 30,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const elapsed = Math.round(performance.now() - startTime);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          testResult.style.background = '#fef2f2';
          testResult.style.color = '#dc2626';
          if (res.status === 401) {
            testResult.textContent = `✗ 错误 401 (未授权)：API Key 密钥错误或已失效，请检查 Key`;
          } else if (res.status === 404) {
            testResult.textContent = `✗ 错误 404 (未找到)：API 接口地址或模型名称不存在(${targetModel})`;
          } else {
            testResult.textContent = `✗ HTTP 错误 ${res.status}：${errText.slice(0, 100)}`;
          }
          return;
        }

        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || '连接就绪';
        testResult.style.background = '#f0fdf4';
        testResult.style.color = '#15803d';
        testResult.textContent = `✓ 连通成功！(${elapsed}ms) [${targetModel}] 回复：“${reply}”`;

        // 自动激活 AI 动态吐槽
        patch({ ai: { enabled: true } });
        animator.override('happy', 2000);
        fx.burst('notes', STAGE.cx, 380, 8);
        startSpeech({ text: '✨ 连通成功！猫娘随时准备吐槽啦喵~', mood: 'proud', ms: 4000 });
      } catch (err) {
        testResult.style.background = '#fef2f2';
        testResult.style.color = '#dc2626';
        const isAbort = err?.name === 'AbortError';
        testResult.textContent = isAbort
          ? '✗ 请求超时：端点未在 10 秒内响应，请检查网络或地址'
          : `✗ 连接失败：${err?.message || '网络无法访问或不支持跨域(CORS)'}`;
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🧪 立即测试 API 连通性';
      }
    });

    field(ui.ai_contextLevel || '上下文信息级别', select(ai.contextLevel, [['minimal', ui.context_minimal || '仅工具与数字'], ['titles', ui.context_titles || '包含会话标题'], ['snippets', ui.context_snippets || '包含关键代码摘要']], value => patch({ ai: { contextLevel: value } })));
    field(ui.ai_minIntervalMin || '最短间隔 (分钟)', number(ai.minIntervalMin, 1, 1440, value => patch({ ai: { minIntervalMin: value } })));
    field(ui.ai_maxPerHour || '每小时上限', number(ai.maxPerHour, 0, 60, value => patch({ ai: { maxPerHour: value } })));
    field(ui.ai_maxPerDay || '每日上限', number(ai.maxPerDay, 0, 500, value => patch({ ai: { maxPerDay: value } })));
    field(ui.ai_dailyTokenBudget || '每日 Token 预算', number(ai.dailyTokenBudget, 0, 500000, value => patch({ ai: { dailyTokenBudget: value } })));
    field(ui.ai_pauseBelowQuota || '低于此配额暂停 AI (%)', number(Math.round((ai.pauseBelowQuota ?? 0.1) * 100), 0, 100, value => patch({ ai: { pauseBelowQuota: value / 100 } })));
    field(ui.ai_onlyWhenFocused || '仅在页面激活时', check(ai.onlyWhenFocused, value => patch({ ai: { onlyWhenFocused: value } })));
    const persona = document.createElement('textarea');
    persona.rows = 2;
    persona.maxLength = 600;
    persona.value = ai.personaExtra || '';
    persona.addEventListener('change', () => patch({ ai: { personaExtra: persona.value } }));
    field(ui.ai_personaExtra || '人设补充说明', persona);
    if (usage) {
      section(ui.section_usage || '今日用量统计');
      make('div', 'panel-note', panel).textContent = (ui.usage || '今日已调用 {calls} 次，约 {tokens} Token').replace('{calls}', usage.calls).replace('{tokens}', usage.tokens);
    }
    section(ui.section_licenses || '致谢与许可协议');
    for (const key of ['license_code', 'license_art', 'license_inspired', 'license_fan']) make('div', 'panel-note', panel).textContent = ui[key] || '';
    const links = make('div', 'panel-note', panel);
    for (const [key, href] of [['license_link_crosspet', 'https://github.com/lokicorvus/crosspet'], ['license_link_art', 'https://creativecommons.org/licenses/by-nc-sa/4.0/']]) {
      const link = make('a', 'panel-link', links);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = ui[key] || href;
    }
    panel.classList.add('show');
    const width = panel.offsetWidth, height = panel.offsetHeight;
    const left = x + spriteW * 0.5 + width + 10 < viewW() ? x + spriteW * 0.5 : Math.max(8, x - spriteW * 0.5 - width);
    panel.style.transform = `translate3d(${clamp(left, 8, viewW() - width - 8)}px, ${clamp(y - height / 2, 8, Math.max(8, viewH() - height - 8))}px, 0)`;
    send({ type: 'panelOpened' });
  }
  function closePanel() { panel.classList.remove('show'); }
  // Typing in the form must not reach the app's keyboard shortcuts or composer.
  for (const type of ['keydown', 'keyup', 'keypress']) listen(panel, type, event => { event.stopPropagation(); if (event.key === 'Escape') closePanel(); });

  function patch(change) {
    settings = { ...settings, ...change, ai: { ...settings.ai, ...change.ai } };
    try {
      if (settings.ai) {
        localStorage.setItem('hagemi_ai_settings', JSON.stringify(settings.ai));
      }
    } catch {}
    scheduleAiComments();
    if (change.language) {
      ui = { ...getUiDict(settings.language) };
    }
    applyVisibility();
    applySize();
    send({ type: 'settings', patch: change });
  }
  function applyVisibility() {
    const hidden = Boolean(settings.hidden || (settings.hiddenUntil && Date.now() < settings.hiddenUntil));
    if (host) host.style.display = hidden ? 'none' : '';
    if (stage) stage.style.display = hidden ? 'none' : 'block';
    if (bubble) bubble.style.display = hidden ? 'none' : '';
    if (hud) hud.style.display = hidden ? 'none' : '';
    if (menu) menu.style.display = hidden ? 'none' : '';
    if (hidden) {
      speechQueue = [];
      closeBubble();
      hideHud();
      closeMenu();
    }
  }

  // ---- Touch: pokes, pats, shakes, a short temper -----------------------------------------
  let annoyance = 0, rub = 0, lastRub = { x: 0, y: 0, at: 0 }, pettedUntil = 0, sulking = false;
  const inHead = py => py < y - spriteH * 0.06;
  function petted() {
    const now = performance.now();
    if (sulking) {
      sulking = false;
      annoyance = 0;
      animator.clearOverride('sulk');
      animator.override('coaxed', 1700, () => animator.override('forgiven', 2200));
      send({ type: 'touch', kind: 'coax' });
      return;
    }
    if (now > pettedUntil) send({ type: 'touch', kind: 'pet' });
    pettedUntil = now + 2400;
    animator.override('petted', 2400);
    if (Math.random() < 0.5) fx.burst('hearts', STAGE.cx, 400, 3);
    annoyance = Math.max(0, annoyance - 1.5);
  }
  function poked(head) {
    if (head) { petted(); return; }
    if (sulking) { animator.play('recoil'); return; }
    annoyance += 1;
    if (annoyance >= 7) {
      sulking = true;
      animator.override('sulk', 14000, () => { sulking = false; annoyance = 0; });
      send({ type: 'touch', kind: 'sulk' });
    } else if (annoyance >= 5.5) {
      animator.override('redhot', 2400);
      fx.burst('steam', STAGE.cx, 400);
      send({ type: 'touch', kind: 'redhot' });
    } else if (annoyance >= 4) {
      animator.override('puffed', 2600);
      animator.play('squish');
      send({ type: 'touch', kind: 'puffed' });
    } else if (annoyance >= 2.5) {
      animator.override('annoyed', 2200);
      animator.play('shake');
      send({ type: 'touch', kind: 'annoyed' });
    } else {
      animator.override('surprised', 1100);
      animator.play('gasp');
      send({ type: 'touch', kind: 'poke' });
    }
  }

  // 触控热区判定：始终保持可触，杜绝触摸穿透或范围变小的 Bug
  function updateHitTest(event) {
    if (dragging) return;
    if (hit.style.pointerEvents !== 'auto') hit.style.pointerEvents = 'auto';
  }

  let lastClickAt = 0, shakeFlips = 0, shakeSign = 0, shakeClock = 0;
  let longPressTimer = null;

  listen(hit, 'pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    hit.setPointerCapture(event.pointerId);
    clearTimeout(longPressTimer);
    dragging = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - x, offsetY: event.clientY - y, moved: false, at: performance.now(), px: event.clientX, py: event.clientY };
    closeBubble();

    // 移动端长按 520ms 触发展示快捷菜单（完美解决手机端无右键问题，带触觉振动）
    longPressTimer = setTimeout(() => {
      if (dragging && !dragging.moved) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(35); } catch {}
        }
        openMenu(dragging.px, dragging.py);
      }
    }, 520);
  });

  listen(hit, 'pointermove', event => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const dragThreshold = isTouch ? 18 : 6;
    if (!dragging.moved && Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > dragThreshold) {
      clearTimeout(longPressTimer);
      dragging.moved = true;
      if (docked) {
        // Pulled out of the wall: she pops back to full size under the cursor.
        dragging.offsetX = 0;
        dragging.offsetY = 0;
        docked = null;
      }
      animator.override('dragged', 1e9);
      send({ type: 'touch', kind: 'grab' });
    }
    dragging.px = event.clientX;
    dragging.py = event.clientY;
  });

  const endDrag = event => {
    clearTimeout(longPressTimer);
    if (!dragging || (event.pointerId !== undefined && event.pointerId !== dragging.id)) return;
    const now = performance.now();
    const heldAt = dragging.at;
    const startY = dragging.startY;
    const moveDist = Math.hypot((dragging.px || event.clientX) - dragging.startX, (dragging.py || event.clientY) - dragging.startY);
    // 关键防抖：移动端轻点时手指自然抖动 < 22px 且时长 < 450ms，强制判定为点击 Tap
    let wasDrag = dragging.moved;
    if (wasDrag && moveDist < 22 && now - heldAt < 450) {
      wasDrag = false;
    }
    dragging = null;

    if (wasDrag) {
      animator.clearOverride('dragged');
      const speed = Math.hypot(vx, vy);

      if (shakeFlips >= 4) {
        animator.override('dizzy', 3200);
        send({ type: 'touch', kind: 'shaken' });
        vx = 0;
        vy = 0;
        keepInBounds();
        savePosition();
      } else if (speed < 450 && (x < spriteW * 0.25 || x > viewW() - spriteW * 0.25)) {
        // 慢速贴边拖放时才触发边缘吸附
        docked = x < spriteW * 0.25 ? 'left' : 'right';
        vx = 0;
        vy = 0;
        keepInBounds();
        savePosition();
      } else if (speed > 1100) {
        animator.override('surprised', 700);
      }
      shakeFlips = 0;

      // 慢速拖动平稳释放瞬间立即保存；高速甩出抛掷时保留初速度，尽情触发满屏反弹蹦跳特效
      if (speed < 120 && !docked) {
        keepInBounds();
        savePosition();
      }
    } else if (!menu.classList.contains('show')) {
      handlePetTap(startY);
    }
  };

  let lastTapHandledAt = 0;
  function handlePetTap(clickY) {
    const now = performance.now();
    // 120ms 内的重复派发属于触屏合成事件，直接去重
    if (now - lastTapHandledAt < 120) return;

    // 真正双击要求间隔在 140ms ~ 420ms 之间
    const isDouble = now - lastClickAt >= 140 && now - lastClickAt < 420;
    lastClickAt = now;
    lastTapHandledAt = now;

    if (menu.classList.contains('show') || panel.classList.contains('show')) return;

    if (isDouble) {
      handleTalkAction(true);
      return;
    }

    poked(inHead(clickY ?? y));

    // 1. 关闭任何可能残留的气泡，确保 HUD 卡片拥有独立干净的展示空间，杜绝文字重叠
    closeBubble();

    // 2. 头顶弹出精致半透明小鱼干卡片（带彩色进度条、百分比、中文倒计时，2.6秒后丝滑自动淡出消失）
    showHud(2600);

    // 3. 召唤手绘小鱼干瓷碗动画
    animator.setMood({ showStash: true });

    // 4. 空中跳跃小鱼干金光粒子特效！
    fx.burst('fish', STAGE.cx, 380, 10);
  }

  listen(hit, 'click', event => {
    // 移动端或桌面端原生 click 事件双重保险
    if (!dragging || !dragging.moved) {
      handlePetTap(event.clientY);
    }
  });
  listen(hit, 'pointerup', endDrag);
  listen(hit, 'pointercancel', endDrag);
  listen(hit, 'contextmenu', event => { event.preventDefault(); openMenu(event.clientX, event.clientY); });
  listen(hit, 'pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimeout(hoverTimer);
    if (settings.quotaHoverDelayMs === 0) showHud(2600);
    else hoverTimer = setTimeout(() => showHud(2600), settings.quotaHoverDelayMs);
  });
  listen(hit, 'pointerleave', (event) => {
    // 手机触摸屏抬起手指时会派发 pointerleave，绝对不能秒关 HUD 卡片
    if (event.pointerType === 'touch') return;
    clearTimeout(hoverTimer);
    hideHud();
  });
  listen(hit, 'pointermove', event => {
    // A slow back-and-forth over her head is a pat.
    if (dragging || !inHead(event.clientY)) return;
    const now = performance.now();
    if (now - lastRub.at > 420) { rub = 0; lastRub = { x: event.clientX, y: event.clientY, at: now }; }
    rub += Math.hypot(event.clientX - lastRub.x, event.clientY - lastRub.y);
    lastRub = { x: event.clientX, y: event.clientY, at: now };
    if (rub > 260) { rub = 120; petted(); }
  });

  let pointerX = 0, pointerY = 0;
  listen(window, 'pointermove', event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    lastPointerAt = performance.now();
    updateHitTest(event);
  }, { passive: true, capture: true });
  // Only the time of the keystroke is ever used; the key itself is never read.
  listen(window, 'keydown', () => { lastKeyAt = performance.now(); }, { passive: true, capture: true });
  listen(window, 'resize', () => { applySize(); settle(); }, { passive: true });
  // 手机端输入法软键盘弹起/收回实时防遮挡监听
  if (typeof window !== 'undefined' && window.visualViewport) {
    listen(window.visualViewport, 'resize', () => {
      keepInBounds();
      const isKeyboardOpen = window.visualViewport.height < window.innerHeight * 0.75;
      stage.style.opacity = isKeyboardOpen ? '0.35' : '1';
    }, { passive: true });
  }

  // Tell the sidecar when nobody is looking, so she does not spend tokens on an empty room.
  const presence = () => send({ type: 'presence', visible: !document.hidden, focused: document.hasFocus(), idleMs: Math.round(performance.now() - Math.max(lastPointerAt, lastKeyAt)), language: navigator.language });
  listen(document, 'visibilitychange', presence);
  listen(window, 'focus', presence);
  listen(window, 'blur', presence);
  const presenceTimer = setInterval(presence, 15000);

  // ---- Frame loop -----------------------------------------------------------------------
  let lastFrame = performance.now(), t = rand(0, 100), raf = 0;
  let saveTimer = 0, savedAt = { x: -1, y: -1 }, lastMessageAt = performance.now();

  function savePosition() {
    savedAt = { x, y };
    anchor = { x: x / viewW(), y: y / viewH() };
    settings.position = docked ? { ...anchor, dock: docked } : anchor;
    send({ type: 'settings', patch: { position: settings.position } });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!host.isConnected) { dispose(); return; }
    if (document.hidden || stage.style.display === 'none') { lastFrame = now; return; }
    const lively = animator.busy || dragging || Math.hypot(vx, vy) > 3 || speech || fade < 1;
    const fpsCap = settings.animation === 'saver' ? 20 : settings.animation === 'smooth' || lively ? 60 : 30;
    if (now - lastFrame < 1000 / fpsCap - 2) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    t += dt;
    if (!anchor) settle();

    if (dragging && dragging.moved) {
      const goalX = dragging.px - dragging.offsetX, goalY = dragging.py - dragging.offsetY;
      const nextX = lerp(x, goalX, 1 - Math.exp(-dt * 24)), nextY = lerp(y, goalY, 1 - Math.exp(-dt * 24));
      vx = (nextX - x) / Math.max(dt, 0.001);
      vy = (nextY - y) / Math.max(dt, 0.001);
      x = nextX;
      y = nextY;
      shakeClock += dt;
      const sign = Math.sign(vx);
      if (Math.abs(vx) > 700 && sign && sign !== shakeSign) { shakeSign = sign; shakeFlips++; shakeClock = 0; }
      if (shakeClock > 0.6) shakeFlips = 0;
    } else if (!dragging && !docked) {
      // Thrown: no gravity here, just drag and soft walls.
      x += vx * dt;
      y += vy * dt;
      const friction = Math.exp(-dt * 2.6);
      vx *= friction;
      vy *= friction;
      const minX = spriteW * 0.22, maxX = viewW() - spriteW * 0.22, minY = spriteH * 0.2, maxY = viewH() - spriteH * 0.2;
      let bumped = 0;
      if (x < minX) { bumped = Math.abs(vx); x = minX; vx = Math.abs(vx) * 0.55; }
      if (x > maxX) { bumped = Math.abs(vx); x = maxX; vx = -Math.abs(vx) * 0.55; }
      if (y < minY) { bumped = Math.max(bumped, Math.abs(vy)); y = minY; vy = Math.abs(vy) * 0.55; }
      if (y > maxY) { bumped = Math.max(bumped, Math.abs(vy)); y = maxY; vy = -Math.abs(vy) * 0.55; }
      if (bumped > 420) {
        animator.play('squish');
        if (animator.state !== 'dizzy') animator.override('oops', 800);
        fx.burst('dust', STAGE.cx, 400, 6);
      }
      if (Math.abs(vx) < 2) vx = 0;
      if (Math.abs(vy) < 2) vy = 0;
    }
    stage.style.transform = `translate3d(${x - (STAGE.w / 2 + MARGIN) * scale}px, ${y - (STAGE.h / 2 + MARGIN) * scale}px, 0)`;

    // Persist where she was left, once she has settled.
    if (!dragging && !vx && !vy && (Math.abs(x - savedAt.x) > 1 || Math.abs(y - savedAt.y) > 1)) {
      saveTimer += dt;
      if (saveTimer > 0.3) { saveTimer = 0; savePosition(); }
    }

    // Docked at a window edge she watches from the wall, peeking out as the cursor nears.
    if (docked && !dragging) {
      // Only over the part of her that shows: about 290 art pixels out from the wall, 360 once she
      // leans out, so the cursor has to leave what it can see before she hides again.
      const peeking = animator.state === `dock${docked === 'left' ? 'Left' : 'Right'}Peek`;
      const reach = (peeking ? 380 : 310) * scale;
      const near = Math.abs(pointerX - x) < reach && Math.abs(pointerY - y) < spriteH * 0.5 && now - lastPointerAt < 2000;
      const dockState = `dock${docked === 'left' ? 'Left' : 'Right'}${near ? 'Peek' : ''}`;
      animator.override(dockState, 1200);
    }

    const frameData = animator.update(dt, t, { vx, vy });
    const { P } = frameData;
    usePose(frameData.poseName);

    // She watches the cursor when it is active, the keyboard while you type.
    if (settings.followCursor) {
      const fresh = now - lastPointerAt < 3500;
      if (fresh && !['sleeping', 'sulk', 'exhausted'].includes(frameData.activeName)) {
        const dx = (pointerX - x) / 420, dy = (pointerY - (y - spriteH * 0.2)) / 340;
        const weight = frameData.activeName === 'idle' ? 1 : 0.35;
        P.lookX = lerp(P.lookX, clamp(dx, -1, 1), weight);
        P.lookY = lerp(P.lookY, clamp(dy, -1, 1), weight);
        P.head += clamp(dx, -1, 1) * 0.04 * weight;
      }
    }
    if (now - lastKeyAt < 1600 && frameData.activeName === 'idle') P.lookY = lerp(P.lookY, 0.85, 0.75);

    // Wall-clock, not frame count: a slow frame must not stretch the overlap into a ghost.
    if (fade < 1) {
      fade = Math.min(1, (now - fadeStart) / FADE_MS);
      if (fade >= 1) previous = null;
    }
    rig.draw(current, previous, fade, P, t, frameData.blink, pixelRatio, scale);
    fx.draw(dt, t, scale * pixelRatio, MARGIN * scale * pixelRatio, { shiftX: P.shiftX, shiftY: P.shiftY, bob: P.bob, sleeping: frameData.sleeping });

    stepSpeech(dt, now);
    if (speech) placeBubble();
    if (hud.classList.contains('show')) placeHud();

    // Sidecar gone: say goodbye instead of haunting the window.
    if (!options.standalone && now - lastMessageAt > 90000 && !leaving) leave();
    if (leaving && now > leaving) dispose();
  }

  function leave() {
    if (leaving) return;
    leaving = performance.now() + 1250;
    closeBubble();
    hideHud();
    animator.override('bye', 1400);
    animator.play('leave');
  }

  function dispose() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    clearInterval(presenceTimer);
    clearTimeout(hoverTimer);
    if (aiIntervalTimer) clearInterval(aiIntervalTimer);
    abort.abort();
    rig.destroy();
    fx.clear();
    host.remove();
  }

  function receive(message) {
    lastMessageAt = performance.now();
    switch (message.t) {
      case 'hello':
        settings = { ...settings, ...message.settings };
        ui = { ...getUiDict(settings.language), ...(message.ui || {}) };
        applySize();
        placeInitial();
        applyVisibility();
        break;
      case 'settings':
        settings = { ...settings, ...message.settings };
        ui = { ...getUiDict(settings.language), ...(message.ui || {}) };
        applySize();
        if (message.settings?.position) {
          placeInitial();
        }
        applyVisibility();
        break;
      case 'art':
        receiveArt(message.name, message.data);
        break;
      case 'facts':
        if (!sulking) animator.setState(message.state);
        animator.setMood({ quota: message.quota || 'ok', late: !!message.late, stashLevel: message.stashLevel ?? null, stashLabel: message.stashLabel || '', subagents: message.subagents || 0 });
        if (Array.isArray(message.hud) && message.hud.length > 0) {
          hudRows = message.hud;
          try {
            localStorage.setItem('hagemi_last_quota_hud', JSON.stringify(message.hud));
          } catch {}
        }
        if (hud.classList.contains('show')) { renderHud(); placeHud(); }
        break;
      case 'react':
        if (message.state && !sulking && !dragging && !docked) animator.override(message.state, message.ms || 2600);
        if (message.gesture) for (const name of [].concat(message.gesture)) animator.play(name);
        if (message.burst) for (const name of [].concat(message.burst)) fx.burst(name, STAGE.cx, 400);
        break;
      case 'say':
        if (settings.hidden || (settings.hiddenUntil && Date.now() < settings.hiddenUntil)) break;
        if (settings.muted && !message.force) break;
        speechQueue.push({ text: message.text, mood: message.mood, ai: message.ai, ms: message.ms, queuedAt: performance.now() });
        if (speechQueue.length > 2) speechQueue.shift();
        break;
      case 'models':
        modelChoices = message.models || modelChoices;
        usage = message.usage || usage;
        break;
      case 'heartbeat':
        applyVisibility();
        break;
      case 'bye':
        leave();
        break;
      default:
        break;
    }
  }

  document.documentElement.appendChild(host);
  hit.style.pointerEvents = 'none';
  applySize();
  placeInitial();
  usePose('idle');
  preloadClones();
  raf = requestAnimationFrame(frame);
  presence();
  scheduleAiComments();
  send({ type: 'ready' });
  return { receive, dispose, animator, get position() { return { x, y }; } };
};


  // 3. 通信与事件桥接
  let petInstance = null;
  const send = (message) => {
    try {
      if (message.type === 'art') {
        const name = message.name;
        fetch(`/assets/hagemi/${name}.webp`)
          .then(r => {
            if (!r.ok) throw new Error('Not found: ' + name);
            return r.blob();
          })
          .then(blob => {
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result ? reader.result.split(',')[1] : null;
              if (petInstance) {
                petInstance.receive({ t: 'art', name, data: base64 });
              }
            };
            reader.readAsDataURL(blob);
          })
          .catch(() => {
            if (petInstance) petInstance.receive({ t: 'art', name, data: null });
          });
        return;
      }

      if (message.type === 'settings' && message.patch) {
        if (message.patch.position) {
          onPositionChange?.(message.patch.position);
        }
        onSettingsChange?.(message.patch);
      }

      if (message.type === 'ready') {
        // 就绪后打招呼并初始化设置
        if (petInstance) {
          petInstance.receive({
            t: 'hello',
            settings: {
              language: initialSettings.lang || 'zhs',
              size: initialSettings.size || 'm',
              position: initialSettings.position || { x: 0.88, y: 0.72 },
              hidden: !initialSettings.enabled,
              muted: initialSettings.chattiness === 'silent',
              followCursor: true,
            },
            ui: {
              badge_active: '运行中',
              badge_idle: '空闲',
              title_settings: '哈基米设置',
            }
          });
        }
      }
    } catch (e) {
      console.warn('[Hagemi] Bridge message error', e);
    }
  };

  try {
    petInstance = await HAGEMI.boot(send, { standalone: true, initialSettings });
    return petInstance;
  } catch (e) {
    console.error('[Hagemi] Boot failed', e);
    onError?.(e);
    return null;
  }
}
