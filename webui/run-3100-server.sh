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

# ---------- 动态定位 node：只认 v24 大版本，小版本升级（v24.x.x）无需改脚本 ----------
# 顺序：PATH 中已有 node(主版本>=20) → 无版本号的固定安装路径 → nvm 风格 v24.* glob 取最高版
resolve_node() {
  local c maj
  c="$(command -v node 2>/dev/null)"
  if [ -n "$c" ] && [ -x "$c" ]; then
    maj="$("$c" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    case "$maj" in ''|*[!0-9]*) ;; *) [ "$maj" -ge 20 ] && { printf '%s\n' "$c"; return 0; } ;; esac
  fi
  for c in /var/apps/nodejs_v24/target/bin/node /var/apps/nodejs_v22/target/bin/node; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  c="$(ls -v /vol*/*/*/data/home/.nvm/versions/node/v24.*/bin/node /vol*/*/.nvm/versions/node/v24.*/bin/node 2>/dev/null | tail -1)"
  [ -n "$c" ] && [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  return 1
}

NODE_BIN="$(resolve_node)"
if [ -z "$NODE_BIN" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [FATAL] 未找到可用的 node（v24.x / nodejs_v24 / nodejs_v22 均不存在），停止启动。"
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [node] 使用: $NODE_BIN ($("$NODE_BIN" -v 2>/dev/null))"
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin:$PATH"
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
export AGY_PRINT_TIMEOUT="${AGY_PRINT_TIMEOUT:-15m}"

cd "$SCRIPT_DIR" || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === 启动 3100 端口 Antigravity WebUI Server ==="

while true; do
  # 每次拉起前清理可能残留的孤立端口占用，避免 EADDRINUSE 循环崩溃
  lsof -ti:$SERVER_PORT | xargs -r kill -9 2>/dev/null || true
  sleep 0.5

  # 确保主 Web 服务网络直接监听不被 SOCKS5 抖动阻塞；子进程 Antigravity 自带代理注入
  unset ALL_PROXY all_proxy HTTPS_PROXY https_proxy HTTP_PROXY http_proxy
  export NO_PROXY="127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12"
  export no_proxy="127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12"

  "$NODE_BIN" dist-server/server/index.js
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 3100 server 退出 (code: $EXIT_CODE)，2秒后重启..."
  sleep 2
done
