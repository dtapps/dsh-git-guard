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
    en:usage) printf 'Usage: %s [--profile NAME] [--undo]\n' "$@" ;;
    zh:usage) printf '用法：%s [--profile 名称] [--undo]\n' "$@" ;;
    en:unknown_arg) printf 'unknown argument: %s\n' "$@" ;;
    zh:unknown_arg) printf '未知参数：%s\n' "$@" ;;
    en:invalid_profile) printf 'invalid --profile: %s (expected a single directory name)\n' "$@" ;;
    zh:invalid_profile) printf '无效的 --profile：%s（应为单层目录名）\n' "$@" ;;
    en:auto_detected) printf 'profile not specified; detected: %s\n' "$@" ;;
    zh:auto_detected) printf '未指定 profile，自动检测到：%s\n' "$@" ;;
    en:no_profiles) printf 'no profile directory under %s; specify one with --profile\n' "$@" ;;
    zh:no_profiles) printf '%s 下没有 profile 目录，请用 --profile 指定\n' "$@" ;;
    en:multiple_profiles) printf 'multiple profiles under %s: %s; specify one with --profile\n' "$@" ;;
    zh:multiple_profiles) printf '%s 下有多个 profile：%s；请用 --profile 指定其中一个\n' "$@" ;;
    en:select_title) printf 'multiple profiles found; choose one:\n' ;;
    zh:select_title) printf '检测到多个 profile，请选择一个：\n' ;;
    en:select_prompt) printf 'enter number or name:\n' ;;
    zh:select_prompt) printf '输入序号或名称：\n' ;;
    en:select_retry) printf 'invalid choice; try again\n' ;;
    zh:select_retry) printf '输入无效，请重试\n' ;;
    en:selected) printf 'using profile: %s\n' "$@" ;;
    zh:selected) printf '使用 profile：%s\n' "$@" ;;
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

dsh_home="${DSH_HOME:-$HOME/.dsh}"
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

if [ -n "$profile" ]; then
  case "$profile" in
    "." | ".." | */* | *\\*)
      msg invalid_profile "$profile" >&2
      exit 1
      ;;
  esac
else
  count=0
  names=""
  display=""
  for d in "$dsh_home"/profiles/*; do
    [ -d "$d" ] || continue
    count=$((count + 1))
    name="${d##*/}"
    if [ -n "$names" ]; then
      names="$names
$name"
      display="$display $name"
    else
      names="$name"
      display="$name"
    fi
  done
  if [ "$count" -eq 0 ]; then
    msg no_profiles "$dsh_home/profiles" >&2
    exit 1
  elif [ "$count" -gt 1 ]; then
    if [ -r /dev/tty ] && [ "${DSH_NON_INTERACTIVE:-0}" != "1" ]; then
      msg select_title >&2
      printf '%s\n' "$names" | awk '{ printf "  %d) %s\n", NR, $0 }' >&2
      while :; do
        msg select_prompt >/dev/tty
        if ! read -r choice </dev/tty; then
          msg multiple_profiles "$dsh_home/profiles" "$display" >&2
          exit 1
        fi
        case "$choice" in
          '' | *[!0-9]*)
            if printf '%s\n' "$names" | awk -v want="$choice" '$0 == want { found = 1 } END { exit !found }'; then
              profile="$choice"
              break
            fi
            msg select_retry >&2
            ;;
          *)
            if [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then
              profile="$(printf '%s\n' "$names" | sed -n "${choice}p")"
              break
            fi
            msg select_retry >&2
            ;;
        esac
      done
      msg selected "$profile"
    else
      msg multiple_profiles "$dsh_home/profiles" "$display" >&2
      exit 1
    fi
  else
    profile="$name"
    msg auto_detected "$profile"
  fi
fi

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
