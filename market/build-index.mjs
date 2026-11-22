#!/usr/bin/env node
/**
 * Regenerate market/index.json as a DSH plugin-market format 1 index.
 * Reads package.json, locale/*.json and icon.svg, then queries the npm
 * registry for real version publish timestamps. No dependencies.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = "https://npm.cnb.cool/dtapp/dsh/-/packages/";

function registryFromArgs(argv) {
	const explicit = argv.find((arg) => arg.startsWith("--registry="));
	if (explicit !== undefined) return explicit.slice("--registry=".length);
	return process.env.DSH_PLUGIN_REGISTRY ?? DEFAULT_REGISTRY;
}

async function readJson(relative) {
	return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

const registry = registryFromArgs(process.argv.slice(2));
const normalizedRegistry = `${registry.replace(/\/+$/, "")}/`;
const pkg = await readJson("package.json");
const localeZh = await readJson("locale/zh.json");
const localeEn = await readJson("locale/en.json");
const iconBytes = await readFile(path.join(root, "icon.svg"));

const encodedName = pkg.name.replace(/\//g, "%2F");
const response = await fetch(`${normalizedRegistry}${encodedName}`, {
	headers: { accept: "application/json" },
});
if (!response.ok) {
	throw new Error(`Cannot read ${pkg.name} from ${normalizedRegistry}: HTTP ${response.status}`);
}
const packument = await response.json();

const versions = Object.keys(packument.versions ?? {})
	.map((version) => ({
		version,
		publishTimestamp: Math.floor(Date.parse(packument.time?.[version] ?? "") / 1000),
	}))
	.filter((entry) => Number.isFinite(entry.publishTimestamp) && entry.publishTimestamp > 0)
	.sort((a, b) => b.publishTimestamp - a.publishTimestamp);

if (versions.length === 0) {
	throw new Error(`No version with a publish timestamp found for ${pkg.name} at ${normalizedRegistry}`);
}

const index = {
	format: 1,
	title: { en: "dtapp plugins", zh: "dtapp 插件" },
	description: {
		en: "Plugins published by dtapp to the CNB npm registry.",
		zh: "dtapp 发布在 CNB 制品库的插件。",
	},
	metadata: {
		categories: {
			tools: { title: { en: "Tools & Integrations", zh: "工具与集成" } },
		},
		labels: {},
		sortKeys: {},
	},
	plugins: [
		{
			name: pkg.name,
			title: { en: localeEn.meta.title, zh: localeZh.meta.title },
			description: { en: localeEn.meta.description, zh: localeZh.meta.description },
			icon: `data:image/svg+xml;base64,${iconBytes.toString("base64")}`,
			repository: { url: pkg.repository?.url ?? "https://cnb.cool/dtapp/dsh-git-guard" },
			metadata: {
				category: "tools",
				keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
				labels: [],
				sortKeys: {},
			},
			versions: versions.map((entry) => ({
				...entry,
				source: { type: "npm", registry: normalizedRegistry },
				engines: {},
			})),
		},
	],
};

const outPath = path.join(root, "market", "index.json");
await writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote market/index.json: ${versions.length} version(s) from ${normalizedRegistry}`);
