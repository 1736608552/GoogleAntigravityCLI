#!/usr/bin/env bash
# Google Antigravity Web UI — 自动保活脚本(单例锁,防多实例)
cd "$(dirname "$0")"
export PATH="/vol5/@apphome/trim.openclaw/data/home/.nvm/versions/node/v24.19.0/bin:/vol5/@apphome/claude code/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="$(pwd)/home"

PORT="${PORT:-3100}"
PIDFILE="/tmp/antigravity-webui-keepalive-v2.pid"
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    if [ "$OLD_PID" != "$$" ] && grep -q "keepalive.sh" /proc/"$OLD_PID"/cmdline 2>/dev/null; then
      echo "[keepalive] 已有实例在跑 (PID: $OLD_PID), 退出"
      exit 0
    fi
  fi
fi
echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM

COUNT=0

# 启动 URnetwork SOCKS5 守护进程（仅代理 Gemini 认证流量）
URNETWORK_SOCKS="$(pwd)/urnetwork/urnetwork-socks"
URNETWORK_SOCKS_PORT=19999
URNETWORK_SOCKS_LOG="$(pwd)/urnetwork/socks.log"

URN_AUTH_FILE="$(pwd)/data/urn-auth.env"

if [ -x "$URNETWORK_SOCKS" ]; then
  # 代理生命周期严格由 WebUI Scale-to-Zero 智能调度器统一托管：
  # 仅在设置处于代理状态且有活跃对话时按需瞬间拉起；对话结束 60 秒后自动优雅退出断开，向平台交割并回收质押流量
  echo "[socks] SOCKS5 代理生命周期由 WebUI 现代化 Scale-to-Zero 调度器托管（按需唤醒 + 60s优雅回收）"
fi

echo "[keepalive] 准备启动现代化 Antigravity WebUI (端口 3100)..."
exec /bin/bash "$(cd "$(dirname "$0")" && pwd)/webui/run-3100-server.sh"
