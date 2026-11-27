#!/bin/bash
# 飞牛 fnOS fpk 打包脚本
# 前置条件：在 webui/ 目录下已完成 npm install（arm64 架构）与 npm run build，
# 产出 dist/（前端）、dist-server/（服务端）、node_modules/（arm64 原生模块）。
# 产物：dist/../GoogleAntigravityCLI-v<version>-arm.fpk
#
# 结构对齐 v1.37.4 官方 fpk：
#   fpk/
#   ├── app.tgz            # server/{package.json,node_modules,dist,dist-server} + ui/ + config/
#   ├── cmd/{main,*_init,*_callback}
#   ├── config/{privilege,resource}
#   ├── ICON.PNG / ICON_256.PNG
#   ├── manifest           # version + checksum(app.tgz 的 MD5)
#   └── wizard/install
#
# 与 v1.37.4 相比的修复：cmd/main 启动入口 dist-server/index.js -> dist-server/server/index.js
set -euo pipefail

WEBUI_DIR="${1:-.}"
cd "$WEBUI_DIR"

VERSION=$(node -p "require('./package.json').version")
STAGE=$(mktemp -d)
OUT_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> 版本: $VERSION"

# ---------- app.tgz 内容 ----------
mkdir -p "$STAGE/server"
cp package.json "$STAGE/server/package.json"
cp -r dist "$STAGE/server/dist"
cp -r dist-server "$STAGE/server/dist-server"
cp -r node_modules "$STAGE/server/node_modules"

mkdir -p "$STAGE/ui/images"
cat > "$STAGE/ui/config" << 'EOF'
{
    ".url": {
        "GoogleAntigravityCLI.Application": {
            "title": "Google Antigravity CLI",
            "icon": "images/icon_{0}.png",
            "type": "url",
            "protocol": "http",
            "port": "3100",
            "url": "/",
            "allUsers": true
        }
    }
}
EOF
cp dist/logo-64.png "$STAGE/ui/images/icon_64.png"
cp dist/logo-256.png "$STAGE/ui/images/icon_256.png"

mkdir -p "$STAGE/config"
cat > "$STAGE/config/privilege" << 'EOF'
{
    "defaults":
    {
        "run-as": "package"
    }
}
EOF
cat > "$STAGE/config/resource" << 'EOF'
{
  "data-share": {
    "shares": [
      {
        "name": "GoogleAntigravityCLI"
      },
      {
        "name": "GoogleAntigravityCLI/data"
      }
    ]
  }
}
EOF

find "$STAGE" -name ".DS_Store" -delete 2>/dev/null || true

echo "==> 打包 app.tgz（node_modules 约 7 万文件，需要几分钟）..."
( cd "$STAGE" && tar czf app.tgz server ui config )

APP_MD5=$(md5sum "$STAGE/app.tgz" | cut -d' ' -f1)
echo "==> app.tgz MD5: $APP_MD5"

# ---------- fpk 组装 ----------
mkdir -p "$OUT_DIR/fpk/cmd" "$OUT_DIR/fpk/config" "$OUT_DIR/fpk/wizard"
mv "$STAGE/app.tgz" "$OUT_DIR/fpk/app.tgz"
cp dist/logo-64.png "$OUT_DIR/fpk/ICON.PNG"
cp dist/logo-256.png "$OUT_DIR/fpk/ICON_256.PNG"

# cmd/main —— 注意：修复 v1.37.4 的错误入口（dist-server/index.js 不存在，真实入口是 dist-server/server/index.js）
cat > "$OUT_DIR/fpk/cmd/main" << 'EOF'
#!/bin/bash

LOG_FILE="${TRIM_PKGVAR}/info.log"
PID_FILE="${TRIM_PKGVAR}/app.pid"

# write the command to start your program here
export PATH="/var/apps/nodejs_v22/target/bin:/var/apps/nodejs_v20/target/bin:/usr/local/bin:${PATH}"
APP_PORT="${wizard_port:-3100}"
CMD="cd ${TRIM_APPDEST}/server && PORT=${APP_PORT} NODE_ENV=production exec node dist-server/server/index.js"

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> ${LOG_FILE}
}

start_process() {
    if status; then
        return 0
    fi

    log_msg "Starting process ..."
    # run cmd to start process
    bash -c "${CMD}" >> ${LOG_FILE} 2>&1 &
    # write pid to pidfile
    printf "%s" "$!" > ${PID_FILE}
    return 0
}

stop_process() {
    log_msg "Stopping process ..."

    if [ -r "${PID_FILE}" ]; then
        pid=$(head -n 1 "${PID_FILE}" | tr -d '[:space:]')

        log_msg "pid=${pid}"
        if ! check_process "${pid}"; then
            # process not exist, delete pidfile
            rm -f "${PID_FILE}"
            log_msg "remove pid file 1"
            return
        fi

        log_msg "send TERM signal to PID:${pid}..."
        kill -TERM ${pid} >> ${LOG_FILE} 2>&1

        local count=0
        while check_process "${pid}" && [ $count -lt 10 ]; do
            sleep 1
            count=$((count + 1))
            log_msg "waiting process terminal... (${count}s/10s)"
        done

        if check_process "${pid}"; then
            log_msg "send KILL signal to PID:${pid}..."
            kill -KILL "${pid}"
            sleep 1
            rm -f "${PID_FILE}"
        else
            log_msg "process killed... "
        fi
    fi

    return 0
}

check_process() {
    local pid=$1
    if kill -0 "${pid}" 2>/dev/null; then
        return 0  # process exist
    else
        return 1  # process not exist
    fi
}

status() {
    if [ -f "${PID_FILE}" ]; then
        pid=$(head -n 1 "${PID_FILE}" | tr -d '[:space:]')
        if check_process "${pid}"; then
            return 0
        else
            # Process is not running but pidfile exists - clean it up
            rm -f "${PID_FILE}"
        fi
    fi

    return 1
}

case $1 in
start)
    # run start command. exit 0 if success, exit 1 if failed
    start_process
    ;;
stop)
    # run stop command. exit 0 if success, exit 1 if failed
    stop_process
    ;;
status)
    # check application status command. exit 0 if running, exit 3 if not running
    if status; then
        exit 0
    else
        exit 3
    fi
    ;;
*)
    exit 1
    ;;
esac
EOF

# 生命周期占位脚本（与 v1.37.4 一致）
for f in install_init install_callback upgrade_init upgrade_callback config_init config_callback uninstall_init uninstall_callback; do
  printf '#!/bin/bash\n\n### This script is called %s.\n\nexit 0\n' "at ${f%_*} ${f#*_}" > "$OUT_DIR/fpk/cmd/$f"
done
chmod 755 "$OUT_DIR/fpk/cmd/"*

cat > "$OUT_DIR/fpk/config/privilege" << 'EOF'
{
    "defaults":
    {
        "run-as": "package"
    }
}
EOF
cp "$STAGE/config/resource" "$OUT_DIR/fpk/config/resource"

cat > "$OUT_DIR/fpk/wizard/install" << 'EOF'
[
  {
    "stepTitle": "服务配置",
    "items": [
      {
        "type": "text",
        "field": "wizard_port",
        "label": "WebUI 服务端口",
        "initValue": "3100",
        "rules": [
          {
            "required": true,
            "message": "请输入服务端口号（默认 3100）"
          }
        ]
      }
    ]
  }
]
EOF

cat > "$OUT_DIR/fpk/manifest" << EOF
appname               = GoogleAntigravityCLI
version               = $VERSION
display_name          = Google Antigravity CLI
desc                  = 面向 Google Antigravity 的全功能 WebUI 与移动端协作工作台
platform              = arm
source                = thirdparty
maintainer            = 1736608552
distributor           = 1736608552
desktop_uidir         = ui
desktop_applaunchname = GoogleAntigravityCLI.Application
service_port          = 3100
checksum              = $APP_MD5
EOF

echo "==> 组装最终 fpk..."
( cd "$OUT_DIR/fpk" && tar czf "$OUT_DIR/GoogleAntigravityCLI-v${VERSION}-arm.fpk" app.tgz cmd config ICON.PNG ICON_256.PNG manifest wizard )

mkdir -p ../artifacts
mv "$OUT_DIR/GoogleAntigravityCLI-v${VERSION}-arm.fpk" "../artifacts/"
echo "==> 完成: artifacts/GoogleAntigravityCLI-v${VERSION}-arm.fpk"
ls -la ../artifacts/
