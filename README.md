# dsh-git-guard

阻止 agent 自行执行 `git commit`、`git push` 等写操作，装到 profile 后对整个 Harness 生效。

## 机制

插件在自己的 `apply()` 里注册一条 `ctx.tools.guard()` 拒绝规则。guard 位于工具执行管线
（`dsh-tools` 的 `ToolExecutionPipeline`）的审批之后、分发之前，是所有工具调用都必须经过的
唯一收口，因此：

- 覆盖当前 profile 下的**所有 agent 与子 agent**（从顶层插件注册，落在 `guards.global`）；
- 覆盖所有能执行 shell 的工具：`bash`、`pwsh`、`terminal_send`、`terminal_write`、`run_code`；
- 被拒绝的调用以 `Error: <理由>` 返回（`isError: true`），模型能看到原因并自行改道；
- 不依赖文件沙箱（沙箱只约束文件写入，管不到 `git push` 这类网络/进程副作用），
  也不依赖审批策略（`policy: never` 只作用于提权）。

## 拦截范围

默认拒绝的 git 子命令：`commit`、`push`、`tag`（非列举）、`merge`、`rebase`、`reset`、
`revert`、`cherry-pick`、`am`、`notes`、`replace`、`gc`、`prune`、`pack-refs`、
`update-ref`、`update-server-info`、`fast-import`、`filter-branch`、`commit-tree`、
`receive-pack`、`send-pack`。

同时覆盖绕过写法：`git -c k=v commit`、`git -C dir push`、`git --git-dir=... push`、
`sh -c 'git push'`、`bash -lc "git commit"`、`env FOO=1 git push`、`sudo git commit`、
`xargs git push`、`git-send-pack`、`echo hi; git commit`、`g"i"t commit`、
`node -e "...execSync('git commit')"`、`python -c "...subprocess.run(['git','push'])"`、
以及终端会话里的 `terminal_send` 文本。

只读命令照常放行：`status`、`diff`、`log`、`show`、`branch`、`fetch`、`rev-parse`、
`remote -v`、`config --get`、`tag`/`tag -l`（列举）、`stash list`、`help`。

另外拦截 `gh` / `glab` / `hub` 的发布类动词（`gh pr create`、`gh pr merge`、
`gh release create`、`gh repo create`、`gh workflow run`、`gh api` 的写请求、
`glab mr create/merge`、`hub push` 等），因为它们是 git 推送的另一条通道。

## 配置

`cordis.patch.yml` 中该行的 `config`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | `false` 时不注册任何 guard（整体关闭） |
| `gitCommands` | string[] | 覆盖默认拒绝的 git 子命令列表 |
| `forgeCommands` | string[] | 覆盖默认拒绝的 forge 动词对，如 `gh pr create` |
| `message` | string | 自定义拒绝文案，`{operation}` 会替换为检测到的操作 |
| `promptNotice` | boolean | 是否往系统提示里插入一条说明（默认 `true`） |
| `loose` | boolean | 强制对整段文本做宽松扫描（默认仅对 `run_code` 启用） |

## 自检

```bash
node test.mjs   # 44 条应拦截 / 26 条应放行
```

## 已知边界

这是**策略层**拦截，不是内核级隔离。刻意构造的混淆（base64 解码后执行、动态拼接命令名、
自行编译的二进制）无法被文本匹配识别。要防到那个程度，需要在 OS 层限制 agent 进程的
凭据（例如让它拿不到 git 远程凭证），而不是靠工具策略。
