/**
 * dsh-git-guard — deny agent-initiated git commit / push operations.
 *
 * Registers one monotonic `ctx.tools.guard()` denial in the profile's global
 * tool scope. Every model tool call that can run a shell command is inspected
 * before dispatch (`bash`, `pwsh`, `terminal_send`, `run_code`), and the call
 * is rejected with an actionable reason when the command text starts a blocked
 * git or forge write operation.
 *
 * A guard is the durable place for this: the file sandbox only constrains file
 * effects, not process or network effects, and no shipped config surface
 * carries a git command denylist.
 */

/** Cordis plugin name. */
const name = "dsh-git-guard";

/** The tool registry this row guards. */
const inject = ["tools"];

/** Prompt section name; registered only when a prompt registry is present. */
const SECTION_NAME = "tool:dsh-git-guard";

/** Default git subcommands blocked for agents. */
const DEFAULT_GIT_DENY = [
	"am",
	"cherry-pick",
	"commit",
	"commit-tree",
	"fast-import",
	"filter-branch",
	"gc",
	"merge",
	"notes",
	"pack-refs",
	"prune",
	"push",
	"rebase",
	"receive-pack",
	"replace",
	"reset",
	"revert",
	"send-pack",
	"tag",
	"update-ref",
	"update-server-info",
];

/** Default `gh` / `glab` / `hub` verb pairs that publish or merge work. */
const DEFAULT_FORGE_DENY = [
	"gh pr create",
	"gh pr merge",
	"gh pr close",
	"gh pr reopen",
	"gh pr edit",
	"gh pr ready",
	"gh release create",
	"gh release edit",
	"gh release delete",
	"gh release upload",
	"gh repo create",
	"gh repo delete",
	"gh repo fork",
	"gh repo rename",
	"gh repo edit",
	"gh workflow run",
	"glab mr create",
	"glab mr merge",
	"glab mr close",
	"glab mr reopen",
	"glab mr update",
	"glab release create",
	"hub push",
	"hub pull-request",
	"hub create",
	"hub fork",
];

/** Shell-capable tools and the argument fields that carry their command text. */
const COMMAND_FIELDS = {
	bash: ["command"],
	pwsh: ["command"],
	terminal_send: ["text"],
	terminal_write: ["text"],
	run_code: ["code", "source", "script", "js", "javascript"],
};

/** Tools whose whole argument object is scanned when no command field matched. */
const SCAN_WHOLE_ARGS = new Set(["run_code"]);

/**
 * Shell word separators. Brackets, braces, and commas also split, so a list-form
 * invocation such as `subprocess.run(['git', 'push'])` exposes both words.
 */
const SEPARATORS = /[\s;&|()<>,{}\[\]`\n\r\t]+/;

/** Command boundaries used to find the command word of each segment. */
const COMMAND_SEPARATORS = /(?:&&|\|\||[;|&\n])/;

/** Leading `NAME=value` environment assignments. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Shell keywords that may precede the command word of a segment. */
const LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "time"]);

/** Commands that only prefix another command. */
const WRAPPERS = new Set(["env", "sudo", "command", "builtin", "exec", "nohup", "xargs", "nice", "stdbuf"]);

/** Shells whose `-c` argument is another shell command line. */
const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell"]);

/** Interpreters whose inline-code flag carries program text rather than shell. */
const CODE_INTERPRETERS = new Set(["node", "nodejs", "python", "python3", "deno", "bun", "ruby", "perl", "php"]);

/** Git global options that consume the following token as their value. */
const GIT_OPTS_WITH_VALUE = new Set([
	"-c",
	"-C",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--config-env",
	"--super-prefix",
]);

/** `gh api` flags that turn the request into a mutation. */
const GH_API_MUTATION_FLAGS = new Set(["-f", "--field", "-F", "--raw-field", "--input"]);

/** HTTP verbs that mutate through `gh api`. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Strip shell quoting so `g"i"t` and `'git'` both read as `git`. */
function unquote(token) {
	return token.replace(/["']/g, "");
}

/** Split shell text into quote-stripped words. */
function tokenize(text) {
	return text
		.split(SEPARATORS)
		.map(unquote)
		.filter((token) => token.length > 0);
}

/**
 * Classify one word as a git invocation.
 *
 * @param word - quote-stripped shell word.
 * @returns `"plain"` for `git` / `/usr/bin/git` / `git.exe`, `"embedded"` when
 *   git ends a larger word such as `execSync(git`, otherwise undefined.
 */
function gitWordKind(word) {
	if (/^(?:.*[\/\\])?git(?:\.exe)?$/i.test(word)) return "plain";
	if (/(?:^|[^\w.\/-])(?:.*[\/\\])?git(?:\.exe)?$/i.test(word)) return "embedded";
	return undefined;
}

/** Return the git subcommand following `index`, or undefined. */
function gitSubcommandAfter(tokens, index) {
	let cursor = index + 1;
	while (cursor < tokens.length) {
		const token = tokens[cursor];
		if (token.startsWith("-")) {
			cursor += GIT_OPTS_WITH_VALUE.has(token) ? 2 : 1;
			continue;
		}
		return { subcommand: token.toLowerCase(), rest: tokens.slice(cursor + 1) };
	}
	return undefined;
}

/** `git tag` stays available for pure listings. */
function isTagListing(rest) {
	if (rest.length === 0) return true;
	return rest.some((token) => token === "-l" || token === "--list");
}

/** Whether a `gh api` invocation mutates server state. */
function isGhApiMutation(rest) {
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "-X" || token === "--method") {
			if (MUTATING_METHODS.has((rest[index + 1] ?? "").toUpperCase())) return true;
			continue;
		}
		if (token.startsWith("-X") && MUTATING_METHODS.has(token.slice(2).toUpperCase())) return true;
		if (token.startsWith("--method=") && MUTATING_METHODS.has(token.slice(9).toUpperCase())) return true;
		if (GH_API_MUTATION_FLAGS.has(token)) return true;
	}
	return false;
}

/** Collect the first two non-option words after `index`. */
function verbPair(tokens, index) {
	const parts = [];
	let cursor = index + 1;
	while (cursor < tokens.length && parts.length < 2) {
		const token = tokens[cursor];
		if (!token.startsWith("-")) parts.push(token.toLowerCase());
		cursor += 1;
	}
	return { parts, rest: tokens.slice(cursor) };
}

/** Whether the word is the git command word, returning the operation label. */
function gitOperationAt(tokens, index, options) {
	const kind = gitWordKind(tokens[index]);
	if (kind === "embedded") {
		const subcommand = (tokens[index + 1] ?? "").toLowerCase().replace(/[^a-z-].*$/, "");
		return options.gitDeny.has(subcommand) ? `git ${subcommand}` : undefined;
	}
	if (kind !== "plain") return undefined;
	const found = gitSubcommandAfter(tokens, index);
	if (found === undefined) return undefined;
	if (found.subcommand === "tag") return isTagListing(found.rest) ? undefined : "git tag";
	return options.gitDeny.has(found.subcommand) ? `git ${found.subcommand}` : undefined;
}

/** Whether the word is a forge command whose verb pair is blocked. */
function forgeOperationAt(tokens, index, options) {
	const head = tokens[index].toLowerCase();
	const verbs = options.forgeDenyHead.get(head);
	if (verbs === undefined) return undefined;
	if (head === "gh" && (tokens[index + 1] ?? "").toLowerCase() === "api") {
		return isGhApiMutation(tokens.slice(index + 2)) ? "gh api 写请求" : undefined;
	}
	const pair = verbPair(tokens, index);
	if (pair.parts.length === 0) return undefined;
	if (verbs.has(pair.parts.join(" "))) return `${head} ${pair.parts.join(" ")}`;
	if (verbs.has(pair.parts[0])) return `${head} ${pair.parts[0]}`;
	return undefined;
}

/** Whether the word names a `git-<subcommand>` helper. */
function dashedOperationAt(tokens, index, options) {
	const dashed = /^git-([a-z][a-z-]*)$/i.exec(tokens[index]);
	if (dashed === null) return undefined;
	const subcommand = dashed[1].toLowerCase();
	return options.gitDeny.has(subcommand) ? `git ${subcommand}` : undefined;
}

/**
 * Scan the remaining tokens as one command line, allowing wrappers and
 * assignments before the command word.
 */
function scanCommandTokens(tokens, options) {
	let index = 0;
	while (index < tokens.length) {
		const word = tokens[index].toLowerCase();

		if (ASSIGNMENT.test(tokens[index]) || LEADING_KEYWORDS.has(word)) {
			index += 1;
			continue;
		}

		if (WRAPPERS.has(word)) {
			index += 1;
			while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
			continue;
		}

		if (SHELL_WRAPPERS.has(word) || CODE_INTERPRETERS.has(word)) {
			const isShell = SHELL_WRAPPERS.has(word);
			let cursor = index + 1;
			let payload = false;
			while (cursor < tokens.length && tokens[cursor].startsWith("-")) {
				const option = tokens[cursor];
				if (isShell && /^-[a-z]*c[a-z]*$/i.test(option)) payload = true;
				if (!isShell && /^(?:-e|--eval|-p|--print|-c)$/i.test(option)) payload = true;
				cursor += 1;
			}
			if (!payload) return undefined;
			const rest = tokens.slice(cursor);
			// A shell payload is another command line; interpreter payload is code.
			return isShell ? scanCommandTokens(rest, options) ?? scanAnywhere(rest, options) : scanAnywhere(rest, options);
		}

		return (
			gitOperationAt(tokens, index, options) ??
			dashedOperationAt(tokens, index, options) ??
			forgeOperationAt(tokens, index, options)
		);
	}
	return undefined;
}

/** Loose scan: any token may be the git/forge invocation (embedded code). */
function scanAnywhere(tokens, options) {
	for (let index = 0; index < tokens.length; index += 1) {
		const operation =
			gitOperationAt(tokens, index, options) ??
			dashedOperationAt(tokens, index, options) ??
			forgeOperationAt(tokens, index, options);
		if (operation !== undefined) return operation;
	}
	return undefined;
}

/** Whether `word` is an interpreter/shell name carrying inline code or commands. */
function isPayloadRunner(word) {
	const lower = word.toLowerCase();
	return SHELL_WRAPPERS.has(lower) || CODE_INTERPRETERS.has(lower);
}

/** Flags that make an interpreter treat the next token as program text. */
const PAYLOAD_FLAGS = /^(?:-[a-z]*c[a-z]*|-e|--eval|-p|--print)$/i;

/**
 * Whether the text embeds an interpreter payload (`python -c ...`,
 * `node -e ...`, `bash -c ...`). Such text can hide a git call inside a string
 * that shell tokenization would otherwise treat as an ordinary argument, so it
 * warrants a loose whole-text scan.
 */
function hasPayloadRunner(tokens) {
	for (let index = 0; index < tokens.length; index += 1) {
		if (!isPayloadRunner(tokens[index])) continue;
		let cursor = index + 1;
		while (cursor < tokens.length && tokens[cursor].startsWith("-")) {
			if (PAYLOAD_FLAGS.test(tokens[cursor])) return true;
			cursor += 1;
		}
	}
	return false;
}

/**
 * Detect one blocked operation in shell text.
 *
 * @param text - raw command text from a tool argument.
 * @param options - normalized plugin settings.
 * @returns the operation label, or undefined when the text is allowed.
 */
function detectBlockedOperation(text, options) {
	for (const segment of text.split(COMMAND_SEPARATORS)) {
		const tokens = tokenize(segment);
		if (tokens.length === 0) continue;
		const operation = scanCommandTokens(tokens, options);
		if (operation !== undefined) return operation;
	}
	const tokens = tokenize(text);
	if (options.loose === true || hasPayloadRunner(tokens)) {
		// Inline program text: shell word boundaries are unreliable, so accept any
		// token that reads as a git/forge invocation. `echo 'git push'` stays
		// allowed because it has no payload runner and is not flagged loose.
		return scanAnywhere(tokens, options);
	}
	return undefined;
}

/** Normalize the row config into typed settings. */
function normalizeConfig(config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const gitCommands = Array.isArray(raw.gitCommands) && raw.gitCommands.length > 0 ? raw.gitCommands : DEFAULT_GIT_DENY;
	const forgeCommands = Array.isArray(raw.forgeCommands) ? raw.forgeCommands : DEFAULT_FORGE_DENY;
	const forgeDenyHead = new Map();
	for (const entry of forgeCommands) {
		if (typeof entry !== "string") continue;
		const [head, ...tail] = entry.trim().toLowerCase().split(/\s+/);
		if (head === undefined || head.length === 0 || tail.length === 0) continue;
		if (!forgeDenyHead.has(head)) forgeDenyHead.set(head, new Set());
		forgeDenyHead.get(head).add(tail.join(" "));
	}
	return {
		enabled: raw.enabled !== false,
		gitDeny: new Set(gitCommands.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry.length > 0)),
		forgeDenyHead,
		message: typeof raw.message === "string" && raw.message.trim().length > 0 ? raw.message : undefined,
		promptNotice: raw.promptNotice !== false,
		loose: raw.loose === true,
	};
}

/** Build the denial reason shown to the model. */
function denialReason(settings, operation) {
	if (settings.message !== undefined) return settings.message.replaceAll("{operation}", operation);
	return (
		`dsh-git-guard 已阻止此调用：检测到 \`${operation}\`。` +
		"本 profile 禁止 agent 自行执行 git 提交、推送等写操作。" +
		"请把改动留在工作区（status/diff/log/show 等只读命令仍可用），由用户本人确认后执行 commit/push。" +
		"如需放开，请修改 dsh-git-guard 插件配置。"
	);
}

/** Extract the command texts a given tool call would execute. */
function commandTexts(exec) {
	const fields = COMMAND_FIELDS[exec.name];
	const args = exec.arguments;
	if (args === null || typeof args !== "object") return [];
	if (fields === undefined) return [];
	const texts = [];
	for (const field of fields) {
		const value = args[field];
		if (typeof value === "string" && value.length > 0) texts.push(value);
	}
	if (texts.length === 0 && SCAN_WHOLE_ARGS.has(exec.name)) {
		try {
			texts.push(JSON.stringify(args));
		} catch {
			return [];
		}
	}
	return texts;
}

/** Tools whose argument text is program code rather than a shell command line. */
const CODE_TOOLS = new Set(["run_code"]);

/** Decide whether one tool call must be denied. */
function inspect(exec, settings) {
	const effective = CODE_TOOLS.has(exec.name) ? { ...settings, loose: true } : settings;
	for (const text of commandTexts(exec)) {
		const operation = detectBlockedOperation(text, effective);
		if (operation !== undefined) return denialReason(settings, operation);
	}
	return undefined;
}

/**
 * Register the guard for every shell-capable tool.
 *
 * @param ctx - the profile context that owns the tool registry.
 * @param config - optional row config: `enabled`, `gitCommands`,
 *   `forgeCommands`, `message`, `promptNotice`.
 */
function apply(ctx, config) {
	const settings = normalizeConfig(config);
	if (!settings.enabled) return;

	const systemPrompt = ctx.get("systemPrompt");
	if (settings.promptNotice && systemPrompt !== undefined) {
		ctx.effect(() => systemPrompt.section({
			name: SECTION_NAME,
			order: systemPrompt.getSectionOrder("TOOL_BASH"),
			text:
				"This profile blocks agent-initiated git writes (commit, push, tag, merge, rebase, reset, and similar) " +
				"through the dsh-git-guard tool policy. Keep changes in the working tree and let the user commit or push. " +
				"Read-only commands such as status, diff, log, show, and fetch remain available.",
		}), "dsh-git-guard.section()");
	}

	ctx.tools.guard((exec) => inspect(exec, settings));
}

export {
	DEFAULT_FORGE_DENY,
	DEFAULT_GIT_DENY,
	apply,
	detectBlockedOperation,
	inject,
	inspect,
	name,
	normalizeConfig,
	tokenize,
};
