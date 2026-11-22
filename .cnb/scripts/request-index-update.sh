#!/bin/sh
# 发布流水线最后一步：在一条固定 Issue 上 @NPC 重建 market/index.json。
#
# 为什么用固定 Issue 而不是每次新建：索引更新是长期重复任务，历史留在同一条的
# 评论里，Issue 列表不会每天多一条。标题固定，脚本按标题（不按 keyword，避免
# 中文 keyword 匹配不准）查找；找到 closed 的就重新打开。
#
# 依赖：cnbcool/cnb-cli 镜像里的 cnb、CNB 注入的 CNB_TOKEN / CNB_REPO_SLUG。
# 失败只告警不退出：派活是附加动作，不能把已经成功的发布标红。
set -eu

info() { printf '  %s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
skip() { warn "$*"; exit 0; }

REPO="${CNB_REPO_SLUG:-${CNB_REPO_SLUG_LOWERCASE:-}}"
[ -n "$REPO" ] || skip "缺少 CNB_REPO_SLUG，跳过索引更新派活"

VERSION="${1:-${VERSION:-}}"
[ -n "$VERSION" ] || skip "缺少版本号，跳过索引更新派活"

TITLE='[NPC] 更新插件市场索引源'
LABEL='索引维护'
NPC_HANDLE='@dtapp/dsh-git-guard(索引更新员)'

tmp="$(mktemp -d 2>/dev/null || true)"
if [ -z "${tmp}" ]; then
  tmp="/tmp/index-update-request"
  mkdir -p "${tmp}"
fi
trap 'rm -rf "${tmp}"' EXIT

# cnb CLI 列表输出是 util.inspect 风格（number/title 逐行），按「上一个 number
# 行 + 当前 title 行」配对取精确匹配的编号；number 与 title 都可能带引号。
find_number_in() {
  awk -v t="${TITLE}" '
    BEGIN { q = sprintf("%c", 39) }
    /^[[:space:]]*(-[[:space:]]+)?number: / {
      v = $NF; gsub(/[^0-9]/, "", v); if (v != "") n = v
    }
    /^[[:space:]]*(-[[:space:]]+)?title: / {
      line = $0
      sub(/^[[:space:]]*(-[[:space:]]+)?title: /, "", line)
      gsub("^[" q "\",]+|[" q "\",]+$", "", line)
      if (line == t && n != "") { print n; exit }
    }
  ' "$1"
}

NUMBER=""
FOUND_STATE=""
for issue_state in open closed; do
  list_file="${tmp}/issues-${issue_state}.txt"
  cnb issues list-issues \
    --repo "${REPO}" \
    --state "${issue_state}" \
    --page 1 \
    --page-size 100 \
    >"${list_file}" 2>&1 || true
  NUMBER="$(find_number_in "${list_file}" || true)"
  if [ -n "${NUMBER}" ]; then
    FOUND_STATE="${issue_state}"
    break
  fi
done

BODY_FILE="${tmp}/body.md"
{
  printf '本 Issue 由发布流水线维护：每次发布新版本后，在这里 @NPC 重建插件市场索引源。\n\n'
  printf '| 项目 | 值 |\n| --- | --- |\n'
  printf '| 最近发布版本 | `%s` |\n' "${VERSION}"
  printf '| 索引文件 | `market/index.json` |\n'
  printf '| 索引地址 | https://cnb.cool/dtapp/dsh-git-guard/-/git/raw/main/market/index.json |\n'
  printf '| 构建脚本 | `node market/build-index.mjs`（零依赖） |\n'
} >"${BODY_FILE}"

IS_NEW=no
if [ -n "${NUMBER}" ]; then
  info "找到 Issue #${NUMBER}（${FOUND_STATE}）"
  if [ "${FOUND_STATE}" = "closed" ]; then
    cnb issues update-issue --repo "${REPO}" --number "${NUMBER}" --state open \
      >"${tmp}/reopen.txt" 2>&1 || warn "重新打开 #${NUMBER} 失败"
  fi
  cnb issues update-issue --repo "${REPO}" --number "${NUMBER}" --body-file "${BODY_FILE}" \
    >"${tmp}/update.txt" 2>&1 || warn "更新 Issue 正文失败"
else
  IS_NEW=yes
  cnb repo-labels post-label \
    --repo "${REPO}" \
    --name "${LABEL}" \
    --color "52c41a" \
    --description "插件市场索引源自动更新" \
    >/dev/null 2>&1 || true
  if ! cnb issues create-issue \
    --repo "${REPO}" \
    --title "${TITLE}" \
    --body-file "${BODY_FILE}" \
    --labels "${LABEL}" \
    >"${tmp}/create.txt" 2>&1; then
    cnb issues create-issue \
      --repo "${REPO}" \
      --title "${TITLE}" \
      --body-file "${BODY_FILE}" \
      >"${tmp}/create.txt" 2>&1 || true
  fi
  NUMBER="$(grep -oE 'number: .?[0-9]+' "${tmp}/create.txt" 2>/dev/null \
    | head -n 1 | grep -oE '[0-9]+' || true)"
  [ -n "${NUMBER}" ] || skip "创建 Issue 失败或没解析到编号：$(head -n 5 "${tmp}/create.txt" 2>/dev/null | tr '\n' ' ' || true)"
  info "已创建 Issue #${NUMBER}"
fi

COMMENT_FILE="${tmp}/comment.md"
{
  printf '%s 版本 %s\n' "${NPC_HANDLE}" "${VERSION}"
  printf '\n<!-- index-update-state:%s -->\n' "${VERSION}"
} >"${COMMENT_FILE}"

if cnb issues post-issue-comment \
  --repo "${REPO}" \
  --number "${NUMBER}" \
  --body-file "${COMMENT_FILE}" \
  >"${tmp}/post.txt" 2>&1; then
  info "✓ 已在 Issue #${NUMBER} ${NPC_HANDLE} 派活"
else
  warn "发布评论失败：$(head -n 5 "${tmp}/post.txt" 2>/dev/null | tr '\n' ' ' || true)"
fi
