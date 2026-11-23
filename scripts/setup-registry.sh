#!/bin/sh
# 幂等地设置（或撤销）某个 DSH profile 的 .npmrc 中的 @dtapp scope registry。
# 仅由用户显式调用，且只改动这一行配置。
set -eu

REGISTRY="https://npm.cnb.cool/dtapp/dsh/-/packages/"
SCOPE_KEY="@dtapp:registry"
CANONICAL="${SCOPE_KEY}=${REGISTRY}"

# 输出语言：优先 DSH_LANG，否则按 LC_ALL > LC_MESSAGES > LANG 自动判断。
case "${DSH_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in
  zh* | ZH*) DSH_LANG=zh ;;
  *) DSH_LANG=en ;;
esac

msg() {
  key=$1
  shift
  case "$DSH_LANG:$key" in
    en:usage) printf 'Usage: %s --profile <name> [--undo]\n' "$@" ;;
    zh:usage) printf '用法：%s --profile <名称> [--undo]\n' "$@" ;;
    en:unknown_arg) printf 'unknown argument: %s\n' "$@" ;;
    zh:unknown_arg) printf '未知参数：%s\n' "$@" ;;
    en:invalid_profile) printf 'missing or invalid --profile (expected a single directory name)\n' ;;
    zh:invalid_profile) printf '缺少或无效的 --profile（应为单层目录名）\n' ;;
    en:unchanged) printf '%s unchanged\n' "$@" ;;
    zh:unchanged) printf '%s 未变更\n' "$@" ;;
    en:removed) printf 'removed %s in %s\n' "$@" ;;
    zh:removed) printf '已移除 %s（%s）\n' "$@" ;;
    en:set) printf 'set %s in %s\n' "$@" ;;
    zh:set) printf '已设置 %s（%s）\n' "$@" ;;
    en:created) printf 'created %s with %s\n' "$@" ;;
    zh:created) printf '已创建 %s（写入 %s）\n' "$@" ;;
    en:nothing_to_undo) printf '%s does not exist; nothing to undo\n' "$@" ;;
    zh:nothing_to_undo) printf '%s 不存在，无需撤销\n' "$@" ;;
  esac
}

usage() {
  msg usage "${0##*/}" >&2
}

profile=""
undo=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      [ "$#" -ge 2 ] || {
        usage
        exit 1
      }
      profile="$2"
      shift 2
      ;;
    --undo)
      undo=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      msg unknown_arg "$1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$profile" in
  "" | "." | ".." | */* | *\\*)
    msg invalid_profile >&2
    exit 1
    ;;
esac

dsh_home="${DSH_HOME:-$HOME/.dsh}"
dir="${dsh_home}/profiles/${profile}"
file="${dir}/.npmrc"
tmp="$(mktemp "${TMPDIR:-/tmp}/setup-registry.XXXXXX")"
trap 'rm -f "$tmp"' 0

if [ -f "$file" ]; then
  awk -v key="${SCOPE_KEY}=" -v canonical="$CANONICAL" -v undo="$undo" '
		{
			sub(/\r$/, "")
			t = $0
			sub(/^[[:space:]]+/, "", t)
			if (index(t, key) == 1) {
				found = 1
				if (!undo) {
					if (blank > 0) { print ""; blank = 0 }
					print canonical
				}
				next
			}
			if ($0 == "") { blank++; next }
			if (blank > 0) { print ""; blank = 0 }
			print
		}
		END {
			if (!found && !undo) {
				if (blank > 0) print ""
				print canonical
			}
		}
	' "$file" >"$tmp"

  if cmp -s "$tmp" "$file"; then
    msg unchanged "$file"
  else
    cat "$tmp" >"$file"
    if [ "$undo" -eq 1 ]; then
      msg removed "$SCOPE_KEY" "$file"
    else
      msg set "$SCOPE_KEY" "$file"
    fi
  fi
elif [ "$undo" -eq 1 ]; then
  msg nothing_to_undo "$file"
else
  mkdir -p "$dir"
  printf '%s\n' "$CANONICAL" >"$file"
  msg created "$file" "$SCOPE_KEY"
fi
