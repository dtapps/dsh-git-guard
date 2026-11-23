/**
 * Self-check for scripts/setup-registry.mjs's .npmrc rewriting. Run with:
 *   node test-setup-registry.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./scripts/setup-registry.mjs", import.meta.url);
const REGISTRY = "https://npm.cnb.cool/dtapp/dsh/-/packages/";
const KEY = "@dtapp:registry";

const home = await mkdtemp(join(tmpdir(), "dsh-registry-test-"));
const profileDir = join(home, "profiles", "web");
const npmrc = join(profileDir, ".npmrc");
const env = { ...process.env, DSH_HOME: home };

import { spawnSync } from "node:child_process";

function run(args) {
	return spawnSync(process.execPath, [script.pathname, ...args], { env, encoding: "utf8" });
}

// Creates the file and only touches the @dtapp line.
let r = run(["--profile", "web"]);
assert.equal(r.status, 0, r.stderr || r.stdout);
assert.match(await readFile(npmrc, "utf8"), new RegExp(`^${KEY.replace("@", "\\@")}=${REGISTRY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));

// Idempotent: second run leaves the file byte-identical.
const before = await readFile(npmrc, "utf8");
r = run(["--profile", "web"]);
assert.equal(r.status, 0, r.stderr || r.stdout);
assert.equal(await readFile(npmrc, "utf8"), before);

// Keeps unrelated lines, replaces a stale scope value.
await writeFile(npmrc, `registry=https://registry.npmmirror.com/\n${KEY}=https://wrong.example/\n`, "utf8");
r = run(["--profile", "web"]);
assert.equal(r.status, 0, r.stderr || r.stdout);
const set = await readFile(npmrc, "utf8");
assert.match(set, /registry=https:\/\/registry\.npmmirror\.com\//);
assert.match(set, new RegExp(`^${KEY.replace("@", "\\@")}=${REGISTRY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
assert.doesNotMatch(set, /wrong\.example/);

// Undo removes only the scope line.
r = run(["--profile", "web", "--undo"]);
assert.equal(r.status, 0, r.stderr || r.stdout);
assert.equal(await readFile(npmrc, "utf8"), "registry=https://registry.npmmirror.com/\n");

// Rejects path-traversing profile names.
r = run(["--profile", "../escape"]);
assert.notEqual(r.status, 0);
assert.match(r.stderr, /invalid --profile/);

console.log("ok — setup-registry: create, idempotent, scope-only, undo, validation");
