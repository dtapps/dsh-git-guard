#!/usr/bin/env bash
# 根据输入的 version 解析出要发布的版本号。
#
# 环境变量输入：
#   VERSION   原始版本输入（crontab 任务的 env，或显式指定的大写变量）。
#   version   web_trigger 表单注入的小写输入：CNB 按 input key 原样注入环境变量，
#             所以 .cnb/web_trigger.yml 里的小写 `version` 到达脚本时是 $version，
#             而不是 $VERSION。两者同时存在时以 $VERSION 为准；都没填则默认 nightly。
#             取值之一：
#             1.2.3                    正式版
#             1.2.3-rc.1               预发布（rc 渠道）
#             1.2.3-beta.1             预发布（beta 渠道）
#             1.2.3-alpha.1            预发布（alpha 渠道）
#             1.2.3-nightly.20260101   预发布（nightly 渠道）
#             nightly                  展开为 <最新正式版 + 1 补丁>-nightly.<日期>；
#                                      日期跟随调度器时区：CNB 用北京时间（内置变量
#                                      CNB 的值为 true），GitHub Actions 用 UTC。
#   SCOPE     包 scope（从 package.json 推导，一般无需覆盖）
# 输出（写入 $GITHUB_OUTPUT 风格的文件，默认 .version.env）：
#   VERSION       规范化后的 semver，不带前导 v（如 0.2.8-nightly.20261114）
#   TAG           git 标签名（如 v0.2.8-nightly.20261114）
#   CHANNEL       stable | rc | beta | alpha | nightly 之一
#   DIST_TAG      npm dist-tag：正式版为 latest，其余为对应渠道
#   PRERELEASE    任意预发布渠道为 true，正式版为 false
#
# 包名来自 package.json 与 CNB 内置环境变量（见
# https://docs.cnb.cool/zh/build/build-in-env.md）：
#   * 包名 / scope：以 package.json 为准，兜底用 CNB_REPO_NAME_LOWERCASE /
#     CNB_GROUP_SLUG_LOWERCASE
#   * 制品库路径：共用的 dtapp/dsh 制品库（不是 git 仓库路径——代码仓库叫
#     dsh-git-guard，制品库叫 dsh），不能由 CNB_REPO_SLUG 推导，这里和
#     .cnb.yml 的 publish.registry 都写死。
# 访问制品库只是为了查 nightly 的基准版本；发布本身由 tencentcom/npm 插件完成，
# 不在这里做。
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
    en:cannot_determine_pkg) printf 'resolve-version: cannot determine package name (package.json or CNB_REPO_NAME_LOWERCASE)\n' ;;
    zh:cannot_determine_pkg) printf 'resolve-version：无法确定包名（package.json 或 CNB_REPO_NAME_LOWERCASE）\n' ;;
    en:version_required) printf "resolve-version: VERSION input is required (a semver, or the literal 'nightly')\n" ;;
    zh:version_required) printf "resolve-version：缺少 VERSION 输入（需为 semver 或字面量 'nightly'）\n" ;;
    en:invalid_semver) printf "resolve-version: '%s' is not a semver (expected 1.2.3 or 1.2.3-rc.1, or 'nightly')\n" "$@" ;;
    zh:invalid_semver) printf "resolve-version：'%s' 不是合法的 semver（应为 1.2.3、1.2.3-rc.1 或 'nightly'）\n" "$@" ;;
    en:resolved) printf 'resolved: version=%s tag=%s channel=%s dist-tag=%s prerelease=%s\n' "$@" ;;
    zh:resolved) printf '已解析：version=%s tag=%s channel=%s dist-tag=%s prerelease=%s\n' "$@" ;;
  esac
}

OUTPUT_FILE="${OUTPUT_FILE:-.version.env}"

# PKG_NAME from package.json, else @<group>/<repo> from the built-in env.
PKG_NAME="${PKG_NAME:-$(node -p "require('./package.json').name" 2>/dev/null || true)}"
[ -n "$PKG_NAME" ] || PKG_NAME="@${CNB_GROUP_SLUG_LOWERCASE:-}/${CNB_REPO_NAME_LOWERCASE:-}"
[ -n "$PKG_NAME" ] || {
  msg cannot_determine_pkg >&2
  exit 1
}
SCOPE="${PKG_NAME%%/*}"
SCOPE="${SCOPE#/}"

# Shared artifact repo `dsh`; code repo `dsh-git-guard` no longer mirrors it.
NPM_REGISTRY="${NPM_REGISTRY:-https://npm.cnb.cool/dtapp/dsh/-/packages/}"

# VERSION precedence: uppercase VERSION (crontab job env / explicit override), then
# lowercase version (web_trigger form input key), else default to nightly.
raw="${VERSION:-${version:-nightly}}"
# Trim whitespace and a single leading `v` (v1.2.3 -> 1.2.3).
raw="${raw#"${raw%%[![:space:]]*}"}"
raw="${raw%"${raw##*[![:space:]]}"}"
raw="${raw#v}"

SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+(\.[0-9A-Za-z.-]+)*)?$'

channel_of() {
  case "$1" in
    *-rc.*) echo rc ;;
    *-beta.*) echo beta ;;
    *-alpha.*) echo alpha ;;
    *-nightly.*) echo nightly ;;
    *-*) echo prerelease ;;
    *) echo stable ;;
  esac
}

# latest_stable <registry> <encoded package name>
# Prints the highest stable (non-prerelease) version. The `latest` dist-tag is only
# trusted when it points to a stable version: this registry currently keeps nightly
# builds in `latest`, and bumping those would drift the nightly baseline upward.
latest_stable() {
  local registry="$1" pkg="$2" json latest
  json="$(curl -fsSL --max-time 30 "${registry%/}/${pkg}" 2>/dev/null || true)"
  if [ -n "$json" ]; then
    latest="$(
      printf '%s' "$json" | node -e '
			let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
				try{const j=JSON.parse(s);const t=j["dist-tags"]||{};
					const stable=v=>typeof v==="string"&&!/[-]/.test(v);
					if(stable(t.latest))return console.log(t.latest);
					const vs=Object.keys(j.versions||{}).filter(stable);
					if(vs.length){vs.sort((a,b)=>{const p=x=>x.split(".").map(Number);const A=p(a),B=p(b);for(let i=0;i<3;i++)if(A[i]!==B[i])return B[i]-A[i];return 0;});return console.log(vs[0]);}
				}catch{}
			});'
    )"
    if [ -n "$latest" ]; then
      echo "$latest"
      return
    fi
  fi
  # Fall back to the newest stable git tag on the remote.
  local tag
  tag="$(git -C "$(git rev-parse --show-toplevel)" tag --list 'v[0-9]*' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
  if [ -n "$tag" ]; then
    echo "${tag#v}"
    return
  fi
  echo "0.0.0"
}

bump_patch() {
  local v="$1" maj min pat
  maj="${v%%.*}"
  v="${v#*.}"
  min="${v%%.*}"
  pat="${v#*.}"
  # Drop any prerelease suffix left on the patch segment.
  pat="${pat%%-*}"
  echo "${maj}.${min}.$((pat + 1))"
}

# Nightly 日期跟随调度器时区，避免跨零点时算出昨天的日期：
#   CNB（内置变量 CNB 的值为 true）：crontab 按 Asia/Shanghai 触发，用北京时间（UTC+8）。
#   GitHub Actions（GITHUB_ACTIONS=true）与本地：schedule 按 UTC 触发，用 UTC。
nightly_date() {
  if [ "${CNB:-}" = "true" ]; then
    # 用 Node 做固定 +8 偏移，避免依赖镜像里的 tzdata。
    node -e 'const d=new Date(Date.now()+8*3600*1000);process.stdout.write(d.toISOString().slice(0,10).replace(/-/g,""))'
  else
    date -u +%Y%m%d
  fi
}

if [ "$raw" = "nightly" ]; then
  base="$(latest_stable "$NPM_REGISTRY" "$PKG_NAME")"
  case "$base" in
    *[-]*) base="$(echo "$base" | sed 's/-.*//')" ;;
  esac
  VERSION="$(bump_patch "$base")-nightly.$(nightly_date)"
elif [ -z "$raw" ]; then
  msg version_required >&2
  exit 1
elif [[ ! $raw =~ $SEMVER_RE ]]; then
  msg invalid_semver "$raw" >&2
  exit 1
else
  VERSION="$raw"
fi

CHANNEL="$(channel_of "$VERSION")"
case "$CHANNEL" in
  stable)
    DIST_TAG="latest"
    PRERELEASE="false"
    ;;
  prerelease)
    # Unrecognized prerelease id: publish under `next`, still a prerelease.
    DIST_TAG="next"
    PRERELEASE="true"
    ;;
  *)
    DIST_TAG="$CHANNEL"
    PRERELEASE="true"
    ;;
esac
TAG="v${VERSION}"

{
  echo "VERSION=${VERSION}"
  echo "TAG=${TAG}"
  echo "CHANNEL=${CHANNEL}"
  echo "DIST_TAG=${DIST_TAG}"
  echo "PRERELEASE=${PRERELEASE}"
} >"$OUTPUT_FILE"

# CNB `exports` maps job-result keys to env vars; result keys are produced only
# by `##[set-output key=value]` lines on stdout. Without these, downstream
# stages (tag-nightly / publish / release) receive empty VERSION/TAG/....
# GitHub Actions 会把这种格式当成自家已废弃的 set-output 命令解析并报错，
# 而它从 .version.env 写入 $GITHUB_OUTPUT 的逻辑在发布工作流里，故这里跳过。
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  for key in VERSION TAG CHANNEL DIST_TAG PRERELEASE; do
    echo "##[set-output ${key}=${!key}]"
  done
fi

msg resolved "$VERSION" "$TAG" "$CHANNEL" "$DIST_TAG" "$PRERELEASE"
cat "$OUTPUT_FILE"
