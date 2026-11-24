#!/usr/bin/env node
/**
 * 发布后重建插件市场索引，并在有变化时创建 PR、自动批准、合并。
 *
 * 用法：
 *   node scripts/ci/update-index-pr.mjs --platform=cnb
 *   node scripts/ci/update-index-pr.mjs --platform=github
 *
 * 分步执行（发布流水线在两步之间用 Golang 镜像跑 make format）：
 *   node scripts/ci/update-index-pr.mjs --platform=cnb --build-only
 *   node scripts/ci/update-index-pr.mjs --platform=cnb --skip-build
 *
 * CNB：
 *   - 重建 market/index.json（CNB 制品库）
 *   - push 临时分支
 *   - POST /{repo}/-/pulls 创建 PR
 *   - POST /{repo}/-/pulls/{number}/reviews 自动 approve
 *   - 合并由 publish.yml 的官方 git:auto-merge 在 pull_request.mergeable 时完成
 * GitHub：
 *   - 重建 market/index.github.json（GitHub Packages）
 *   - push 临时分支
 *   - gh pr create 创建 PR
 *   - 用 PR_APPROVE_TOKEN 执行 gh pr review --approve
 *   - 用 GITHUB_TOKEN 自动 squash merge
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

function arg(name) {
	const prefix = `--${name}=`;
	const found = process.argv.find((item) => item.startsWith(prefix));
	return found === undefined ? undefined : found.slice(prefix.length);
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: options.stdio ?? "inherit",
		env: options.env ?? process.env,
	});
}

function fail(message) {
	console.error(`update-index-pr: ${message}`);
	process.exit(1);
}

async function approveCnb(prTitle) {
	const api = (process.env.CNB_API_ENDPOINT ?? "https://api.cnb.cool").replace(/\/+$/, "");
	const repo = process.env.CNB_REPO_SLUG;
	const token = process.env.CNB_TOKEN;
	if (!repo || !token) fail("缺少 CNB_REPO_SLUG 和 CNB_TOKEN");

	const headers = {
		accept: "application/vnd.cnb.api+json",
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
	const listed = await fetch(`${api}/${repo}/-/pulls?per_page=100`, { headers });
	if (!listed.ok) fail(`查询 PR 列表失败：HTTP ${listed.status} ${await listed.text()}`);
	const data = await listed.json();
	const pulls = Array.isArray(data) ? data : (data.pulls ?? data.items ?? data.data ?? []);
	const matches = pulls.filter((pull) => pull?.title === prTitle);
	if (matches.length === 0) fail(`找不到标题为“${prTitle}”的 PR`);
	matches.sort((a, b) => (Number(b.number ?? b.iid ?? b.id) || 0) - (Number(a.number ?? a.iid ?? a.id) || 0));
	const number = matches[0].number ?? matches[0].iid ?? matches[0].id;
	if (number === undefined) fail(`PR 响应缺少编号：${JSON.stringify(matches[0])}`);

	const reviewed = await fetch(`${api}/${repo}/-/pulls/${number}/reviews`, {
		method: "POST",
		headers,
		body: JSON.stringify({ event: "approve", body: "索引结构、自检与 registry 一致性校验通过，自动批准。", work_mode: true }),
	});
	if (!reviewed.ok) fail(`批准 PR 失败：HTTP ${reviewed.status} ${await reviewed.text()}`);
	console.log(`update-index-pr: 已批准 CNB PR #${number}`);
}

const platform = arg("platform");
if (platform !== "cnb" && platform !== "github") {
	fail("--platform 必须是 cnb 或 github");
}

const version = process.env.VERSION;
if (!version) fail("缺少 VERSION");

const indexFile = platform === "cnb" ? "market/index.json" : "market/index.github.json";
const runId = process.env.GITHUB_RUN_ID ?? process.env.CNB_BUILD_ID ?? String(Date.now());
const branch = `chore/index-${version.replace(/[^0-9A-Za-z._-]+/g, "-")}-${runId}`;
const title = `chore: 更新插件市场索引源到 ${version}`;
const body = [
	`发布 ${version} 后自动重建插件市场索引。`,
	"",
	`- 索引文件：\`${indexFile}\``,
	`- 版本：\`${version}\``,
].join("\n");

const buildOnly = process.argv.includes("--build-only");
const skipBuild = process.argv.includes("--skip-build");
const prepareOnly = process.argv.includes("--prepare-only");
const approveOnly = process.argv.includes("--approve-only");

if (approveOnly) {
	if (platform !== "cnb") fail("--approve-only 仅支持 cnb");
	await approveCnb(title);
	process.exit(0);
}

if (!skipBuild) {
	if (platform === "cnb") {
		run(process.execPath, ["market/build-index.mjs"]);
	} else {
		if (!process.env.PUBLISH_NAME) fail("缺少 PUBLISH_NAME");
		run(process.execPath, [
			"market/build-index.mjs",
			"--registry=https://npm.pkg.github.com",
			`--name=${process.env.PUBLISH_NAME}`,
			`--repository=https://github.com/${process.env.GITHUB_REPOSITORY}`,
			`--out=${indexFile}`,
		]);
	}
	if (buildOnly) {
		console.log(`update-index-pr: 已重建 ${indexFile}`);
		process.exit(0);
	}
}

const changed = run("git", ["status", "--porcelain", "--", indexFile], { stdio: ["ignore", "pipe", "inherit"] }).trim();
if (!changed) {
	console.log(`update-index-pr: ${indexFile} 无变化，跳过 PR`);
	process.exit(0);
}

run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
run("git", ["checkout", "-b", branch]);
run("git", ["add", indexFile]);
run("git", ["commit", "-m", title]);
run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);

if (prepareOnly) {
	await writeFile(".index-pr-branch", `${branch}\n`, "utf8");
	console.log(`update-index-pr: 已推送索引分支 ${branch}`);
	process.exit(0);
}

if (platform === "cnb") {
	const api = (process.env.CNB_API_ENDPOINT ?? "https://api.cnb.cool").replace(/\/+$/, "");
	const repo = process.env.CNB_REPO_SLUG;
	const token = process.env.CNB_TOKEN;
	if (!repo || !token) fail("缺少 CNB_REPO_SLUG 和 CNB_TOKEN");

	const headers = {
		accept: "application/vnd.cnb.api+json",
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
	const created = await fetch(`${api}/${repo}/-/pulls`, {
		method: "POST",
		headers,
		body: JSON.stringify({ title, head: branch, base: "main", body }),
	});
	if (!created.ok) fail(`创建 PR 失败：HTTP ${created.status} ${await created.text()}`);
	const pull = await created.json();
	const number = pull.number ?? pull.iid ?? pull.id;
	if (number === undefined) fail(`创建 PR 响应缺少编号：${JSON.stringify(pull)}`);

	const reviewed = await fetch(`${api}/${repo}/-/pulls/${number}/reviews`, {
		method: "POST",
		headers,
		body: JSON.stringify({ event: "approve", body: "索引结构、自检与 registry 一致性校验通过，自动批准。", work_mode: true }),
	});
	if (!reviewed.ok) fail(`批准 PR 失败：HTTP ${reviewed.status} ${await reviewed.text()}`);
	console.log(`update-index-pr: 已创建并批准 CNB PR #${number}`);
} else {
	const ghToken = process.env.GITHUB_TOKEN;
	const approveToken = process.env.PR_APPROVE_TOKEN;
	if (!ghToken) fail("缺少 GITHUB_TOKEN");
	if (!approveToken) fail("缺少 PR_APPROVE_TOKEN");

	const output = run(
		"gh",
		["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", body],
		{ stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, GH_TOKEN: ghToken } },
	);
	const url = output
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.pop();
	const number = url?.split("/").pop();
	if (!number) fail(`无法从输出解析 PR 编号：${output}`);

	run("gh", ["pr", "review", number, "--approve", "--body", "索引与 registry 一致性校验通过，自动批准。"], {
		env: { ...process.env, GH_TOKEN: approveToken },
	});
	try {
		run("gh", ["pr", "merge", number, "--squash", "--auto", "--delete-branch"], {
			env: { ...process.env, GH_TOKEN: ghToken },
		});
	} catch {
		run("gh", ["pr", "merge", number, "--squash", "--delete-branch"], {
			env: { ...process.env, GH_TOKEN: ghToken },
		});
	}
	console.log(`update-index-pr: 已创建、批准并合并 GitHub PR #${number}`);
}
