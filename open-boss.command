#!/bin/zsh
BOSS_FRAMEWORK_DIR="${0:A:h}"
cd "$BOSS_FRAMEWORK_DIR" || exit 2
if [[ ! -f runtime.local.json ]]; then
  print '先按 README 运行 npm ci 和 npm run setup 生成本机配置。'
  exit 2
fi
BOSS_FRAMEWORK_PORT=$(node -e 'const r=JSON.parse(require("node:fs").readFileSync("runtime.local.json"));if(!Number.isInteger(r.port)||r.port<1||r.port>65535)process.exit(2);console.log(r.port)') || exit 2
if /usr/bin/curl --fail --silent --max-time 2 "http://127.0.0.1:$BOSS_FRAMEWORK_PORT/json/version" >/dev/null; then
  print '已有可连接的 Chrome，请保留一个已登录的 BOSS 招聘端标签。'
  exit 0
fi
BOSS_FRAMEWORK_BROWSER_DIR="$HOME/Library/Application Support/boss-framework/chrome"
/usr/bin/open -na 'Google Chrome' --args "--remote-debugging-port=$BOSS_FRAMEWORK_PORT" "--user-data-dir=$BOSS_FRAMEWORK_BROWSER_DIR" 'https://www.zhipin.com/web/chat/recommend'
print '请在新窗口亲自登录本人已授权的招聘账号。'
