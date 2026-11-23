#!/usr/bin/env bash
# Create (or replace) the Release for TAG, then — nightly channel only — prune
# old nightly Releases down to the newest $NIGHTLY_KEEP (default 3).
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

: "${CNB_TOKEN:?CNB_TOKEN is required}"
: "${CNB_REPO_SLUG:?CNB_REPO_SLUG is required}"
: "${CNB_COMMIT:?CNB_COMMIT is required}"
: "${TAG:?TAG is required}"
: "${VERSION:?VERSION is required}"
: "${CHANNEL:?CHANNEL is required}"
: "${PRERELEASE:?PRERELEASE is required}"

API="https://api.cnb.cool"
NIGHTLY_KEEP="${NIGHTLY_KEEP:-3}"
DRY_RUN="${DRY_RUN:-0}"

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $method $API$path ${body:+--data '$body'}"
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
  DESCRIPTION="Nightly build of ${CNB_COMMIT_SHORT:-${CNB_COMMIT:0:8}} (UTC $(date -u +%Y-%m-%d)). Not for production use."
else
  DESCRIPTION="${PKG_NAME} ${VERSION} (${CHANNEL})."
fi
MAKE_LATEST="false"
[ "$PRERELEASE" = "false" ] && MAKE_LATEST="true"

BODY="$(printf '{"tag_name":"%s","name":"%s","body":"%s","prerelease":%s,"make_latest":%s,"target_commitish":"%s"}' \
  "$TAG" "$TITLE" "$DESCRIPTION" "$PRERELEASE" "$MAKE_LATEST" "$CNB_COMMIT")"

echo "==> create release ${TAG} (prerelease=${PRERELEASE}, latest=${MAKE_LATEST})"
existing="$(api GET "/${CNB_REPO_SLUG}/-/releases/tags/${TAG}" 2>/dev/null || true)"
existing_id="$(printf '%s' "$existing" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j&&j.id!==undefined)console.log(j.id)}catch{}})' 2>/dev/null || true)"
if [ -n "$existing_id" ]; then
  echo "==> release for ${TAG} exists (id ${existing_id}), replacing"
  api DELETE "/${CNB_REPO_SLUG}/-/releases/${existing_id}" >/dev/null
fi
api POST "/${CNB_REPO_SLUG}/-/releases" "$BODY" >/dev/null

if [ "$CHANNEL" = "nightly" ]; then
  echo "==> pruning nightly releases, keeping ${NIGHTLY_KEEP}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] node scripts/prune-nightly.mjs"
  else
    node scripts/prune-nightly.mjs
  fi
fi
echo "==> release ${TAG} ready"
