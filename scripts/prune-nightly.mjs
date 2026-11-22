#!/usr/bin/env node
/**
 * Delete every nightly Release except the newest NIGHTLY_KEEP (default 3).
 *
 * A nightly Release is one whose tag matches v<semver>-nightly.<date> and is
 * flagged as a prerelease. Uses the CNB OpenAPI:
 *   GET    /{repo}/-/releases          list (paginated)
 *   DELETE /{repo}/-/releases/{id}     delete one
 */
const API = process.env.CNB_API_BASE ?? "https://api.cnb.cool";
const KEEP = Number(process.env.NIGHTLY_KEEP ?? 3);
const REPO = process.env.CNB_REPO_SLUG;
const TOKEN = process.env.CNB_TOKEN;

if (!REPO || !TOKEN) {
	console.error("prune-nightly: CNB_REPO_SLUG and CNB_TOKEN are required");
	process.exit(1);
}

const NIGHTLY_TAG = /^v\d+\.\d+\.\d+-nightly\.\d{8}$/;

async function api(path, options = {}) {
	const res = await fetch(`${API}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: "application/json",
			...(options.headers ?? {}),
		},
	});
	if (!res.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
	const text = await res.text();
	return text ? JSON.parse(text) : null;
}

/** List every release across all pages. */
async function listReleases() {
	const all = [];
	for (let page = 1; page < 100; page += 1) {
		const batch = await api(`/${REPO}/-/releases?page=${page}&page_size=100`);
		const items = Array.isArray(batch) ? batch : (batch?.releases ?? batch?.data ?? []);
		if (items.length === 0) break;
		all.push(...items);
		if (items.length < 100) break;
	}
	return all;
}

const releases = await listReleases();
const nightlies = releases
	.filter((r) => NIGHTLY_TAG.test(r.tag_name ?? "") && (r.prerelease ?? true))
	.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

console.log(`nightly releases: ${nightlies.length} (keeping ${KEEP})`);
const stale = nightlies.slice(KEEP);
for (const release of stale) {
	console.log(`  delete ${release.tag_name} (id ${release.id}, ${release.created_at})`);
	await api(`/${REPO}/-/releases/${release.id}`, { method: "DELETE" });
}
if (stale.length === 0) console.log("  nothing to prune");
