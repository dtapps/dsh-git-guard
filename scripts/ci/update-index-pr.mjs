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
 *   - POST /{repo}/-/pulls/{number}/reviews 自动 APPROVE
 *   - 把 PR 编号写入 .index-pr-number，由后续 cnb CLI 阶段合并
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

const platform = arg("platform");
if (platform !== "cnb" && platform !== "github") {
	fail("--platform must be cnb or github");
}

const version = process.env.VERSION;
if (!version) fail("VERSION is required");

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
if (!skipBuild) {
	if (platform === "cnb") {
		run(process.execPath, ["market/build-index.mjs"]);
	} else {
		if (!process.env.PUBLISH_NAME) fail("PUBLISH_NAME is required");
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

if (platform === "cnb") {
	const api = (process.env.CNB_API_ENDPOINT ?? "https://api.cnb.cool").replace(/\/+$/, "");
	const repo = process.env.CNB_REPO_SLUG;
	const token = process.env.CNB_TOKEN;
	if (!repo || !token) fail("CNB_REPO_SLUG and CNB_TOKEN are required");

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
	if (!created.ok) fail(`create PR failed: HTTP ${created.status} ${await created.text()}`);
	const pull = await created.json();
	const number = pull.number ?? pull.iid ?? pull.id;
	if (number === undefined) fail(`create PR response missing number: ${JSON.stringify(pull)}`);

	const reviewed = await fetch(`${api}/${repo}/-/pulls/${number}/reviews`, {
		method: "POST",
		headers,
		body: JSON.stringify({ event: "APPROVE", body: "索引结构、自检与 registry 一致性校验通过，自动批准。" }),
	});
	if (!reviewed.ok) fail(`approve PR failed: HTTP ${reviewed.status} ${await reviewed.text()}`);
	await writeFile(".index-pr-number", `${number}\n`, "utf8");
	console.log(`update-index-pr: 已创建并批准 CNB PR #${number}`);
} else {
	const ghToken = process.env.GITHUB_TOKEN;
	const approveToken = process.env.PR_APPROVE_TOKEN;
	if (!ghToken) fail("GITHUB_TOKEN is required");
	if (!approveToken) fail("PR_APPROVE_TOKEN is required");

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
	if (!number) fail(`cannot parse PR number from: ${output}`);

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
