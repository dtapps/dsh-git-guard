#!/usr/bin/env node
/**
 * Deterministic gate for index-update PRs. Exits non-zero when market/index.json
 * is structurally invalid, so an untrusted PR can never reach auto-merge.
 * Zero dependencies; called by the pull_request stage before NPC approval.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const REGISTRY = "https://npm.cnb.cool/dtapp/dsh/-/packages/";
const PKG = "@dtapp/dsh-git-guard";
const root = process.cwd();
const file = path.join(root, "market", "index.json");
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };

let index;
try {
	index = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
	console.error(`verify-index: cannot parse market/index.json: ${error.message}`);
	process.exit(1);
}

check(index.format === 1, `format must be 1, got ${JSON.stringify(index.format)}`);
check(Array.isArray(index.plugins) && index.plugins.length === 1,
	`plugins must contain exactly one entry, got ${index.plugins?.length}`);

const plugin = index.plugins?.[0];
if (plugin !== undefined) {
	check(plugin.name === PKG, `plugin name must be ${PKG}, got ${JSON.stringify(plugin.name)}`);
	check(typeof plugin.icon === "string" && plugin.icon.startsWith("data:image/svg+xml;base64,"),
		"icon must be an inline data:image/svg+xml;base64 URI");
	check(Array.isArray(plugin.versions) && plugin.versions.length > 0,
		"versions must be a non-empty array");

	for (const entry of plugin.versions ?? []) {
		check(typeof entry.version === "string" && /^\d+\.\d+\.\d+/.test(entry.version),
			`invalid version: ${JSON.stringify(entry.version)}`);
		check(Number.isInteger(entry.publishTimestamp) && entry.publishTimestamp > 0,
			`${entry.version}: publishTimestamp must be a positive integer`);
		check(entry.source?.type === "npm", `${entry.version}: source.type must be npm`);
		check(entry.source?.registry === REGISTRY,
			`${entry.version}: source.registry must be ${REGISTRY}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) console.error(`verify-index: ${error}`);
	console.error(`verify-index: FAILED with ${errors.length} error(s)`);
	process.exit(1);
}

const versions = (plugin.versions ?? []).map((entry) => entry.version).join(", ");
console.log(`verify-index: OK (${plugin.name}, versions: ${versions})`);
