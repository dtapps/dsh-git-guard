#!/usr/bin/env node
/**
 * Regenerate a DSH plugin-market format 1 index.
 * Reads package.json, locale/*.json and icon.svg, then queries the npm
 * registry for real version publish timestamps. No dependencies.
 *
 * Usage:
 *   node market/build-index.mjs
 *   node market/build-index.mjs --registry=https://npm.pkg.github.com \
 *     --name=@dtapps/dsh-git-guard \
 *     --repository=https://github.com/dtapps/dsh-git-guard \
 *     --out=market/index.github.json
 *
 * Token for private/authenticated registries:
 *   GITHUB_TOKEN / NPM_TOKEN / NODE_AUTH_TOKEN
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = "https://npm.cnb.cool/dtapp/dsh/-/packages/";

function arg(argv, name) {
	const prefix = `--${name}=`;
	const found = argv.find((item) => item.startsWith(prefix));
	return found === undefined ? undefined : found.slice(prefix.length);
}

function registryFromArgs(argv) {
	return arg(argv, "registry") ?? process.env.DSH_PLUGIN_REGISTRY ?? DEFAULT_REGISTRY;
}

const argv = process.argv.slice(2);
const registry = registryFromArgs(argv);
const normalizedRegistry = `${registry.replace(/\/+$/, "")}/`;
const pkg = await readJson("package.json");
const localeZh = await readJson("locale/zh.json");
const localeEn = await readJson("locale/en.json");
const iconBytes = await readFile(path.join(root, "icon.svg"));

const packageName = arg(argv, "name") ?? pkg.name;
const repository = arg(argv, "repository") ?? pkg.repository?.url ?? "https://cnb.cool/dtapp/dsh-git-guard";
const outArg = arg(argv, "out") ?? "market/index.json";
const outPath = path.isAbsolute(outArg) ? outArg : path.join(root, outArg);
const token = process.env.GITHUB_TOKEN ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN ?? "";
const isGitHub = normalizedRegistry.includes("npm.pkg.github.com");

async function readJson(relative) {
	return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

const encodedName = packageName.replace(/\//g, "%2F");
const headers = { accept: "application/json" };
if (token) headers.authorization = `Bearer ${token}`;
const response = await fetch(`${normalizedRegistry}${encodedName}`, { headers });
if (!response.ok) {
	throw new Error(`Cannot read ${packageName} from ${normalizedRegistry}: HTTP ${response.status}`);
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
	throw new Error(`No version with a publish timestamp found for ${packageName} at ${normalizedRegistry}`);
}

const index = {
	format: 1,
	title: {
		en: isGitHub ? "dtapp plugins (GitHub Packages)" : "dtapp plugins",
		zh: isGitHub ? "dtapp 插件（GitHub Packages）" : "dtapp 插件",
	},
	description: {
		en: isGitHub ? "Plugins published by dtapp to GitHub Packages." : "Plugins published by dtapp to the CNB npm registry.",
		zh: isGitHub ? "dtapp 发布在 GitHub Packages 的插件。" : "dtapp 发布在 CNB 制品库的插件。",
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
			name: packageName,
			title: { en: localeEn.meta.title, zh: localeZh.meta.title },
			description: { en: localeEn.meta.description, zh: localeZh.meta.description },
			icon: `data:image/svg+xml;base64,${iconBytes.toString("base64")}`,
			repository: { url: repository },
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

await writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${path.relative(root, outPath)}: ${versions.length} version(s) from ${normalizedRegistry}`);
