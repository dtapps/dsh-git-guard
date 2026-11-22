/**
 * Self-check for dsh-git-guard detection. Run with:
 *   node test.mjs
 *
 * Kept out of `files` so the installed bundle carries only runtime assets.
 */
import assert from "node:assert/strict";
import { DEFAULT_FORGE_DENY, DEFAULT_GIT_DENY, detectBlockedOperation, inspect, normalizeConfig } from "./index.js";

const settings = normalizeConfig({ gitCommands: DEFAULT_GIT_DENY, forgeCommands: DEFAULT_FORGE_DENY });

const blocked = [
	"git commit -m 'x'",
	"git commit --amend --no-edit",
	"git -c user.name=x commit -m y",
	"git -C /repo commit -m y",
	"cd repo && git push origin main",
	"git push --force-with-lease",
	"git -c core.pager=cat push",
	"GIT_DIR=.git git commit -m z",
	"sh -c 'git commit -m \"wrapped\"'",
	"bash -lc \"git push\"",
	"git commit-tree $(git write-tree)",
	"git send-pack origin main",
	"git tag v1.0.0",
	"git reset --hard HEAD~1",
	"git rebase -i main",
	"git merge --no-ff feature",
	"git cherry-pick abc123",
	"git revert HEAD",
	"git update-ref refs/heads/main abc",
	"git-am patch.mbox",
	"g\"i\"t commit -m quoted",
	"echo hi; git commit -m a",
	"gh pr create --fill",
	"gh pr merge 42 --squash",
	"gh release create v1.0.0",
	"gh api repos/o/r/merges -X POST",
	"gh api -f name=x repos/o/r/issues",
	"glab mr create --fill",
	"hub push origin main",
	"node -e \"require('child_process').execSync('git commit -m x')\"",
	"python -c \"import subprocess; subprocess.run(['git','push'])\"",
	"env FOO=1 git push",
	"sudo git commit -m x",
	"xargs git push",
	"git --no-pager push",
	"git --git-dir=.git push",
	"cd /repo; git commit -am x",
	"git push --tags",
	"GIT_AUTHOR_NAME=x git commit -m y",
	"bash -c \"git push --tags\"",
	"git gc --prune=now",
	"git filter-branch --all",
	"git notes add -m note",
	"git replace abc def",
];

const allowed = [
	"git status",
	"git diff",
	"git diff --cached",
	"git log --oneline -5",
	"git show HEAD",
	"git branch -a",
	"git fetch origin",
	"git rev-parse --abbrev-ref HEAD",
	"git tag",
	"git tag -l 'v*'",
	"git tag --list",
	"git stash list",
	"git remote -v",
	"git config --get user.name",
	"gh pr list",
	"gh pr view 42",
	"gh api repos/o/r/pulls",
	"gh repo view",
	"ls -la",
	"npm test",
	"git help commit",
	"git log --grep=push",
	"gh run list",
	"glab mr list",
	"echo 'git push'",
	"grep -rn 'git commit' .",
];

for (const text of blocked) {
	assert.notEqual(detectBlockedOperation(text, settings), undefined, `expected blocked: ${text}`);
}
for (const text of allowed) {
	assert.equal(detectBlockedOperation(text, settings), undefined, `expected allowed: ${text}`);
}

// A custom message template replaces the default text.
const custom = normalizeConfig({ message: "blocked: {operation}" });
assert.equal(detectBlockedOperation("git commit -m x", custom), "git commit");

// `enabled: false` is handled by apply(), not the detector.
assert.equal(normalizeConfig({ enabled: false }).enabled, false);

// Tool-call level: only shell-capable tools are inspected, and only through
// the argument fields that carry command text.
assert.notEqual(inspect({ name: "bash", arguments: { command: "git push" } }, settings), undefined);
assert.equal(inspect({ name: "bash", arguments: { command: "git status" } }, settings), undefined);
assert.notEqual(inspect({ name: "pwsh", arguments: { command: "git commit -m x" } }, settings), undefined);
assert.notEqual(inspect({ name: "terminal_send", arguments: { sessionId: "s1", text: "git push\n" } }, settings), undefined);
assert.equal(inspect({ name: "terminal_send", arguments: { sessionId: "s1", text: "git status\n" } }, settings), undefined);
assert.notEqual(
	inspect({ name: "run_code", arguments: { code: "await tools.bash({ command: 'git push' })" } }, settings),
	undefined,
);
assert.equal(inspect({ name: "read", arguments: { file_path: "git push notes.md" } }, settings), undefined);
assert.equal(inspect({ name: "bash", arguments: { command: "   " } }, settings), undefined);

// The denial text names the detected operation and stays actionable.
const reason = inspect({ name: "bash", arguments: { command: "git commit -m x" } }, settings);
assert.match(reason, /git commit/);
assert.match(reason, /dsh-git-guard/);

console.log(`ok — ${blocked.length} blocked, ${allowed.length} allowed`);
