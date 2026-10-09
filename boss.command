#!/bin/zsh
# 双击只预检。greet 必须另行提供本轮明确授权文件。
BOSS_FRAMEWORK_DIR="${0:A:h}"
cd "$BOSS_FRAMEWORK_DIR" || exit 2
if [[ $# -eq 0 ]]; then
  exec node "$BOSS_FRAMEWORK_DIR/scripts/boss_live.mjs" doctor --runtime "$BOSS_FRAMEWORK_DIR/runtime.local.json"
fi
if [[ "$1" == "plan" || "$1" == "run" || "$1" == "reconcile" ]]; then
  exec node "$BOSS_FRAMEWORK_DIR/scripts/boss_workflow.mjs" "$@"
fi
if [[ "$1" == "greet" ]]; then
  shift
  exec node "$BOSS_FRAMEWORK_DIR/scripts/boss_send.mjs" "$@"
fi
exec node "$BOSS_FRAMEWORK_DIR/scripts/boss_live.mjs" "$@" --runtime "$BOSS_FRAMEWORK_DIR/runtime.local.json"
