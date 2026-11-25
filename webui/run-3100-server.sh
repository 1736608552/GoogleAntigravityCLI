#!/bin/bash
# CloudCLI Antigravity 3100 端口独立保活启动脚本
PIDFILE="/tmp/agy-server-3100.pid"
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    if [ "$OLD_PID" != "$$" ] && grep -q "run-3100-server.sh" /proc/"$OLD_PID"/cmdline 2>/dev/null; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] 已有 3100 实例在运行中 (PID: $OLD_PID)，直接退出"
      exit 0
    fi
  fi
fi
echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM

export PATH="/vol5/@apphome/trim.openclaw/data/home/.nvm/versions/node/v24.19.0/bin:/vol5/@apphome/claude code/.npm-global/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$BASE_DIR/bin:$PATH"

export SERVER_PORT="3100"
export PORT="3100"
export HOST="${HOST:-::}"
export VITE_PORT="5178"
export HOME="$BASE_DIR/home"
export DATABASE_PATH="$BASE_DIR/home/.cloudcli/auth.db"
export AGY_BIN="$BASE_DIR/bin/antigravity"
export AGY_HOME="$BASE_DIR/home"
export WORKSPACES_ROOT="$BASE_DIR"
export ALLOW_ANY_WORKSPACE_PATH="true"
export ALLOW_ALL_WORKSPACES="true"
export AGY_PRINT_TIMEOUT="${AGY_PRINT_TIMEOUT:-24h}"

cd "$SCRIPT_DIR" || exit 1

# 清理可能残留的孤立端口占用
lsof -ti:$SERVER_PORT | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === 启动 3100 端口 Antigravity WebUI Server ==="

while true; do
  # 确保主 Web 服务网络直接监听不被 SOCKS5 抖动阻塞；子进程 Antigravity 自带代理注入
  unset ALL_PROXY all_proxy HTTPS_PROXY https_proxy HTTP_PROXY http_proxy
  export NO_PROXY="127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12"
  export no_proxy="127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12"

  node dist-server/server/index.js
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 3100 server 退出 (code: $EXIT_CODE)，2秒后重启..."
  sleep 2
done
