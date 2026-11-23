#!/usr/bin/env bash
# Resolve the version to publish from the `version` input.
#
# Inputs (environment):
#   VERSION   raw version input (crontab job env, or an explicitly uppercase input).
#   version   raw version input from the web_trigger form: CNB injects input keys
#             verbatim, so `.cnb/web_trigger.yml`'s lowercase `version` arrives as
#             `$version`, NOT `$VERSION`. `VERSION` wins when both are set.
#             Defaults to `nightly` when both are unset/empty. One of:
#             1.2.3                    stable
#             1.2.3-rc.1               prerelease, channel rc
#             1.2.3-beta.1             prerelease, channel beta
#             1.2.3-alpha.1            prerelease, channel alpha
#             1.2.3-nightly.20260101   prerelease, channel nightly
#             nightly                  expands to <latest stable + 1 patch>-nightly.<UTC date>
#   SCOPE     package scope (derived from package.json; rarely needs overriding)
# Outputs (written to $GITHUB_OUTPUT-style file given by OUTPUT_FILE, default .version.env):
#   VERSION       normalized semver without the leading `v` (e.g. 0.2.8-nightly.20261114)
#   TAG           git tag name (e.g. v0.2.8-nightly.20261114)
#   CHANNEL       one of: stable | rc | beta | alpha | nightly
#   DIST_TAG      npm dist-tag to publish under (latest for stable, else the channel)
#   PRERELEASE    true for any prerelease channel, false for stable
#
# Package name comes from package.json and CNB built-in env vars (see
# https://docs.cnb.cool/zh/build/build-in-env.md):
#   * package name / scope : read from package.json (authoritative), falling back to
#                            CNB_REPO_NAME_LOWERCASE / CNB_GROUP_SLUG_LOWERCASE
#   * artifact repo path   : shared `dtapp/dsh` registry (NOT the git repo path —
#                            code repo is dsh-git-guard, artifact repo is dsh),
#                            hardcoded here and in .cnb.yml `publish.registry`
# The registry is only needed to look up the latest stable for `nightly` expansion;
# publishing itself is done by the tencentcom/npm plugin, not here.
set -euo pipefail

OUTPUT_FILE="${OUTPUT_FILE:-.version.env}"

# PKG_NAME from package.json, else @<group>/<repo> from the built-in env.
PKG_NAME="${PKG_NAME:-$(node -p "require('./package.json').name" 2>/dev/null || true)}"
[ -n "$PKG_NAME" ] || PKG_NAME="@${CNB_GROUP_SLUG_LOWERCASE:-}/${CNB_REPO_NAME_LOWERCASE:-}"
[ -n "$PKG_NAME" ] || {
  echo "resolve-version: cannot determine package name (package.json or CNB_REPO_NAME_LOWERCASE)" >&2
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

if [ "$raw" = "nightly" ]; then
  base="$(latest_stable "$NPM_REGISTRY" "$PKG_NAME")"
  case "$base" in
    *[-]*) base="$(echo "$base" | sed 's/-.*//')" ;;
  esac
  VERSION="$(bump_patch "$base")-nightly.$(date -u +%Y%m%d)"
elif [ -z "$raw" ]; then
  echo "resolve-version: VERSION input is required (a semver, or the literal 'nightly')" >&2
  exit 1
elif [[ ! $raw =~ $SEMVER_RE ]]; then
  echo "resolve-version: '$raw' is not a semver (expected 1.2.3 or 1.2.3-rc.1, or 'nightly')" >&2
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
for key in VERSION TAG CHANNEL DIST_TAG PRERELEASE; do
  echo "##[set-output ${key}=${!key}]"
done

echo "resolved: version=${VERSION} tag=${TAG} channel=${CHANNEL} dist-tag=${DIST_TAG} prerelease=${PRERELEASE}"
cat "$OUTPUT_FILE"
