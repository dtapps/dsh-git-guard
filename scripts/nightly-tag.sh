#!/usr/bin/env bash
# Create and push the nightly git tag at the built commit. tag_push events
# already carry their tag; nightly (crontab / web_trigger) does not, and the
# Release needs the tag to bind to, so we create it here.
set -euo pipefail

# 输出语言：优先 DSH_LANG，否则按 LC_ALL > LC_MESSAGES > LANG 自动判断。
case "${DSH_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in
  zh* | ZH*) DSH_LANG=zh ;;
  *) DSH_LANG=en ;;
esac

msg() {
  local key="$1"
  shift
  case "$DSH_LANG:$key" in
    en:required_env) printf '%s is required\n' "$@" ;;
    zh:required_env) printf '缺少必需的环境变量 %s\n' "$@" ;;
    en:tag_exists_moving) printf '==> tag %s already exists, moving to %s\n' "$@" ;;
    zh:tag_exists_moving) printf '==> 标签 %s 已存在，将移动到 %s\n' "$@" ;;
    en:creating_tag) printf '==> creating tag %s -> %s\n' "$@" ;;
    zh:creating_tag) printf '==> 创建标签 %s -> %s\n' "$@" ;;
    en:dry_run_push) printf '[dry-run] git push origin refs/tags/%s\n' "$@" ;;
    zh:dry_run_push) printf '[dry-run] git push origin refs/tags/%s\n' "$@" ;;
    en:pushed_tag) printf '==> pushed tag %s\n' "$@" ;;
    zh:pushed_tag) printf '==> 已推送标签 %s\n' "$@" ;;
  esac
}

require() {
  if [ -z "$(printenv "$1" 2>/dev/null)" ]; then
    msg required_env "$1" >&2
    exit 1
  fi
}

require TAG
require CNB_COMMIT
DRY_RUN="${DRY_RUN:-0}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  msg tag_exists_moving "$TAG" "$CNB_COMMIT"
  [ "$DRY_RUN" = "1" ] || git tag -f "$TAG" "$CNB_COMMIT"
else
  msg creating_tag "$TAG" "$CNB_COMMIT"
  [ "$DRY_RUN" = "1" ] || git tag "$TAG" "$CNB_COMMIT"
fi

if [ "$DRY_RUN" = "1" ]; then
  msg dry_run_push "$TAG"
else
  git push origin "refs/tags/${TAG}"
  msg pushed_tag "$TAG"
fi
