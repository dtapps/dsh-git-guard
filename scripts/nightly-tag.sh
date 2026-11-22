#!/usr/bin/env bash
# Create and push the nightly git tag at the built commit. tag_push events
# already carry their tag; nightly (crontab / web_trigger) does not, and the
# Release needs the tag to bind to, so we create it here.
set -euo pipefail

: "${TAG:?TAG is required}"
: "${CNB_COMMIT:?CNB_COMMIT is required}"
DRY_RUN="${DRY_RUN:-0}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
	echo "==> tag ${TAG} already exists, moving to ${CNB_COMMIT}"
	[ "$DRY_RUN" = "1" ] || git tag -f "$TAG" "$CNB_COMMIT"
else
	echo "==> creating tag ${TAG} -> ${CNB_COMMIT}"
	[ "$DRY_RUN" = "1" ] || git tag "$TAG" "$CNB_COMMIT"
fi

if [ "$DRY_RUN" = "1" ]; then
	echo "[dry-run] git push origin refs/tags/${TAG}"
else
	git push origin "refs/tags/${TAG}"
	echo "==> pushed tag ${TAG}"
fi
