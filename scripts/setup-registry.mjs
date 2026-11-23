/**
 * Idempotently set (or undo) the @dtapp scope registry in one DSH profile's
 * .npmrc. Explicit, user-invoked, and limited to a single scope line.
 *
 * Usage:
 *   node scripts/setup-registry.mjs --profile <name>
 *   node scripts/setup-registry.mjs --profile <name> --undo
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REGISTRY = "https://npm.cnb.cool/dtapp/dsh/-/packages/";
const SCOPE_KEY = "@dtapp:registry";

function parseArgs(argv) {
	let profile;
	let undo = false;
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--profile") profile = argv[++i];
		else if (argv[i] === "--undo") undo = true;
		else throw new Error(`unknown argument: ${argv[i]}`);
	}
	if (!profile || /[\/\\]/.test(profile) || profile === "." || profile === "..") {
		throw new Error("missing or invalid --profile (expected a single directory name)");
	}
	return { profile, undo };
}

function rewrite(npmrc, undo) {
	const kept = [];
	let found = false;
	for (const line of npmrc.split(/\r?\n/)) {
		if (line.trimStart().startsWith(`${SCOPE_KEY}=`)) {
			found = true;
			if (!undo) kept.push(`${SCOPE_KEY}=${REGISTRY}`);
			continue;
		}
		kept.push(line);
	}
	if (!found && !undo) kept.push(`${SCOPE_KEY}=${REGISTRY}`);
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "") + "\n";
}

const { profile, undo } = parseArgs(process.argv.slice(2));
const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const dir = resolve(dshHome, "profiles", profile);
const file = join(dir, ".npmrc");

if (existsSync(file)) {
	const current = await readFile(file, "utf8");
	const next = rewrite(current, undo);
	if (next === current) {
		console.log(`${file} unchanged`);
	} else {
		await writeFile(file, next, "utf8");
		console.log(`${undo ? "removed" : "set"} ${SCOPE_KEY} in ${file}`);
	}
} else if (undo) {
	console.log(`${file} does not exist; nothing to undo`);
} else {
	await mkdir(dir, { recursive: true });
	await writeFile(file, `${SCOPE_KEY}=${REGISTRY}\n`, "utf8");
	console.log(`created ${file} with ${SCOPE_KEY}`);
}
