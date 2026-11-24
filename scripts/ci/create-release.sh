#!/usr/bin/env bash
# Create (or replace) the Release for TAG.
# Nightly 清理由发布流水线单独调用 scripts/ci/delete-release.sh 完成。
#
# Used by both tag_push and nightly: it looks the Release up by tag and replaces
# it, so re-running a version is idempotent (mirrors git:release's default
# overlying=false behavior).
#
# Required environment:
#   CNB_TOKEN      CI token (injected automatically)
#   CNB_REPO_SLUG  <org>/<repo>
#   CNB_COMMIT     commit SHA the tag points at
#   TAG            git tag (e.g. v1.2.3 or v0.2.8-nightly.20261114)
#   VERSION        normalized version, no leading v
#   CHANNEL        stable | rc | beta | alpha | nightly
#   PRERELEASE     true | false
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
    en:dry_run_api) printf '[dry-run] %s %s%s\n' "$@" ;;
    zh:dry_run_api) printf '[dry-run] %s %s%s\n' "$@" ;;
    en:create_release) printf '==> create release %s (prerelease=%s, latest=%s)\n' "$@" ;;
    zh:create_release) printf '==> 创建 Release %s（预发布=%s，最新=%s）\n' "$@" ;;
    en:release_exists) printf '==> release for %s exists (id %s), replacing\n' "$@" ;;
    zh:release_exists) printf '==> %s 的 Release 已存在（id %s），将替换\n' "$@" ;;
    en:release_ready) printf '==> release %s ready\n' "$@" ;;
    zh:release_ready) printf '==> Release %s 已就绪\n' "$@" ;;
    en:description_nightly) printf 'Nightly build of %s (UTC %s). Not for production use.\n' "$@" ;;
    zh:description_nightly) printf '%s 的 nightly 构建（UTC %s），不用于生产环境。\n' "$@" ;;
    en:description_stable) printf '%s %s (%s).\n' "$@" ;;
    zh:description_stable) printf '%s %s（%s）。\n' "$@" ;;
  esac
}

require() {
  if [ -z "$(printenv "$1" 2>/dev/null)" ]; then
    msg required_env "$1" >&2
    exit 1
  fi
}

require CNB_TOKEN
require CNB_REPO_SLUG
require CNB_COMMIT
require TAG
require VERSION
require CHANNEL
require PRERELEASE

API="https://api.cnb.cool"
DRY_RUN="${DRY_RUN:-0}"

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ "$DRY_RUN" = "1" ]; then
    msg dry_run_api "$method" "$API$path" "${body:+--data '$body'}"
    return 0
  fi
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer ${CNB_TOKEN}" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer ${CNB_TOKEN}" \
      -H "Accept: application/json"
  fi
}

# Display name for the Release title/body: read from package.json, not hardcoded.
PKG_NAME="$(node -p "require('./package.json').name" 2>/dev/null || echo "${CNB_REPO_NAME_LOWERCASE:-dsh-git-guard}")"
TITLE="${PKG_NAME} ${VERSION}"
if [ "$CHANNEL" = "nightly" ]; then
  DESCRIPTION="$(msg description_nightly "${CNB_COMMIT_SHORT:-${CNB_COMMIT:0:8}}" "$(date -u +%Y-%m-%d)")"
else
  DESCRIPTION="$(msg description_stable "$PKG_NAME" "$VERSION" "$CHANNEL")"
fi
MAKE_LATEST="false"
[ "$PRERELEASE" = "false" ] && MAKE_LATEST="true"

BODY="$(printf '{"tag_name":"%s","name":"%s","body":"%s","prerelease":%s,"make_latest":%s,"target_commitish":"%s"}' \
  "$TAG" "$TITLE" "$DESCRIPTION" "$PRERELEASE" "$MAKE_LATEST" "$CNB_COMMIT")"

msg create_release "$TAG" "$PRERELEASE" "$MAKE_LATEST"
existing="$(api GET "/${CNB_REPO_SLUG}/-/releases/tags/${TAG}" 2>/dev/null || true)"
existing_id="$(printf '%s' "$existing" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j&&j.id!==undefined)console.log(j.id)}catch{}})' 2>/dev/null || true)"
if [ -n "$existing_id" ]; then
  msg release_exists "$TAG" "$existing_id"
  api DELETE "/${CNB_REPO_SLUG}/-/releases/${existing_id}" >/dev/null
fi
api POST "/${CNB_REPO_SLUG}/-/releases" "$BODY" >/dev/null

msg release_ready "$TAG"
