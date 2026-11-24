# dsh-git-guard

阻止 agent 自行执行 `git commit`、`git push` 等写操作，装到 profile 后对整个 Harness 生效。

[![发布](https://img.shields.io/github/actions/workflow/status/dtapps/dsh-git-guard/publish.yml?branch=main&label=%E5%8F%91%E5%B8%83)](https://github.com/dtapps/dsh-git-guard/actions/workflows/publish.yml) [![版本](https://img.shields.io/github/v/release/dtapps/dsh-git-guard?label=%E7%89%88%E6%9C%AC)](https://github.com/dtapps/dsh-git-guard/releases) [![GitHub 访问](https://visitor-badge.laobi.icu/badge?page_id=github/dtapps/dsh-git-guard)](https://github.com/dtapps/dsh-git-guard) [![星标](https://img.shields.io/github/stars/dtapps/dsh-git-guard?label=%E6%98%9F%E6%A0%87)](https://github.com/dtapps/dsh-git-guard/stargazers) [![分叉](https://img.shields.io/github/forks/dtapps/dsh-git-guard?label=%E5%88%86%E5%8F%89)](https://github.com/dtapps/dsh-git-guard/forks) [![许可证](https://img.shields.io/github/license/dtapps/dsh-git-guard?label=%E8%AE%B8%E5%8F%AF%E8%AF%81)](https://github.com/dtapps/dsh-git-guard/blob/main/LICENSE) [![语言](https://img.shields.io/github/languages/top/dtapps/dsh-git-guard?label=%E8%AF%AD%E8%A8%80)](https://github.com/dtapps/dsh-git-guard) [![仓库大小](https://img.shields.io/github/repo-size/dtapps/dsh-git-guard?label=%E4%BB%93%E5%BA%93%E5%A4%A7%E5%B0%8F)](https://github.com/dtapps/dsh-git-guard)

代码仓库：https://github.com/dtapps/dsh-git-guard ；npm 包发布在 GitHub Packages `https://npm.pkg.github.com`（包名 `@dtapps/dsh-git-guard`，需要 token 才能拉取）。

同名包也发布在 npm 公共源（`@dtapp/dsh-git-guard`，无需 token），安装方式见 [README.npm.md](README.npm.md)；本页安装步骤针对 GitHub Packages。

## 安装到 DeepSeekHarness

### 前置一：准备 GitHub token

拉取 GitHub Packages 的 npm 包需要 token：

- classic PAT：勾选 `read:packages`
- fine-grained token：给 `dtapps/dsh-git-guard` 的 `Packages: Read` 权限

不要把 token 提交进仓库。

### 前置二：配置 profile 的 `.npmrc`

文件位置：`$DSH_HOME/profiles/你的profile名/.npmrc`，`DSH_HOME` 默认取 `~/.dsh`。写入两行，把 `ghp_你的Token` 换成你的 token：

```ini
@dtapps:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=ghp_你的Token
```

只有写进 profile `.npmrc` 的 `@dtapps:registry` 和 `_authToken` 会让 pnpm 在更新与 lockfile 供应链校验时也回源到 GitHub Packages。若 `~/.npmrc` 或 profile `.npmrc` 里已有指向别处的 `@dtapps:registry`，先改掉。

### 安装：把插件装进 profile

token 与 `.npmrc` 配好后，在终端执行（`--profile` 后面换成你的 profile 名，如 `web`、`desktop`）：

```bash
dsh plugin --profile 你的profile名 add @dtapps/dsh-git-guard
```

这条命令把参数原样转发给该 profile 目录里的 pnpm，等价于在 `$DSH_HOME/profiles/你的profile名` 下执行 `pnpm add @dtapps/dsh-git-guard`，依赖和 lockfile 都记在 profile 里。装完重启该 profile（`dsh 你的profile名`），guard 即对整个 Harness 生效。

卸载：

```bash
dsh plugin --profile 你的profile名 remove @dtapps/dsh-git-guard
```

也可以不敲命令：按下一节添加索引源后，在 `插件 → 发现` 里搜索 `@dtapps/dsh-git-guard` 点击安装。

### 插件市场索引源（可在发现页搜索）

仓库自带一份 DSH **format 1** 索引 `market/index.github.json`，通过 GitHub raw 地址直接对外提供：

```text
https://raw.githubusercontent.com/dtapps/dsh-git-guard/main/market/index.github.json
```

在 DSH 中打开 `插件 → 发现 → 索引源`，添加上面的地址（索引源属于 profile，每个 profile 需单独添加一次）。之后即可在发现页搜索 `@dtapps/dsh-git-guard`，点击安装时索引里的 `source.registry` 会指向 GitHub Packages。索引里的版本发布时间取自 GitHub Packages，安装时仍需按上面的 `.npmrc` 配置 token。

仓库里的 `market/index.json` 指向 CNB 制品库，是默认 README 使用的索引，不要拿它来装 GitHub 版。

### 辅助脚本：配置/撤销 scope 映射

不想手写 profile 的 `.npmrc` 可运行 `scripts/setup-github-registry.sh`（POSIX sh，无需 Node）。它只改 `$DSH_HOME/profiles/你的profile名/.npmrc` 中的 `@dtapps:registry` 和 `_authToken` 两行，幂等，带 `--undo` 可撤销；不挂 `postinstall`、不碰 npm 全局配置。

脚本会自动检测 profile：`~/.dsh/profiles` 下只有一个目录时直接用它；有多个时列出列表让你选（输入序号或名称，通过 `curl | sh` 执行也一样），也可以用 `--profile` 指定。CI 等无终端环境请设 `DSH_NON_INTERACTIVE=1`。

本地已克隆仓库时（token 需 `read:packages` 权限）：

```bash
# 配置
GITHUB_TOKEN=你的token ./scripts/setup-github-registry.sh

# 撤销
GITHUB_TOKEN=你的token ./scripts/setup-github-registry.sh --undo
```

手上没有仓库时，用 curl 拉取同一脚本执行，token 直接传给 `sh`：

```bash
curl -fsSL https://raw.githubusercontent.com/dtapps/dsh-git-guard/main/scripts/setup-github-registry.sh | GITHUB_TOKEN=你的token sh -s --            # 配置
curl -fsSL https://raw.githubusercontent.com/dtapps/dsh-git-guard/main/scripts/setup-github-registry.sh | GITHUB_TOKEN=你的token sh -s -- --undo     # 撤销
```

`DSH_HOME` 默认取 `~/.dsh`；脚本零依赖，仅在被显式调用时执行。输出语言按 `LC_ALL` → `LC_MESSAGES` → `LANG` 自动选择中文或英文，也可用 `DSH_LANG=zh` / `DSH_LANG=en` 显式覆盖。

## 机制

插件在自己的 `apply()` 里注册一条 `ctx.tools.guard()` 拒绝规则。guard 位于工具执行管线（`dsh-tools` 的 `ToolExecutionPipeline`）的审批之后、分发之前，是所有工具调用都必须经过的唯一收口，因此：

- 覆盖当前 profile 下的**所有 agent 与子 agent**（从顶层插件注册，落在 `guards.global`）；
- 覆盖所有能执行 shell 的工具：`bash`、`pwsh`、`terminal_send`、`terminal_write`、`run_code`；
- 被拒绝的调用以 `Error: <理由>` 返回（`isError: true`），模型能看到原因并自行改道；
- 不依赖文件沙箱（沙箱只约束文件写入，管不到 `git push` 这类网络/进程副作用），也不依赖审批策略（`policy: never` 只作用于提权）。

## 拦截范围

默认拒绝的 git 子命令：`commit`、`push`、`tag`（非列举）、`merge`、`rebase`、`reset`、`revert`、`cherry-pick`、`am`、`notes`、`replace`、`gc`、`prune`、`pack-refs`、`update-ref`、`update-server-info`、`fast-import`、`filter-branch`、`commit-tree`、`receive-pack`、`send-pack`。

同时覆盖绕过写法：`git -c k=v commit`、`git -C dir push`、`git --git-dir=... push`、`sh -c 'git push'`、`bash -lc "git commit"`、`env FOO=1 git push`、`sudo git commit`、`xargs git push`、`git-send-pack`、`echo hi; git commit`、`g"i"t commit`、`node -e "...execSync('git commit')"`、`python -c "...subprocess.run(['git','push'])"`，以及终端会话里的 `terminal_send` 文本。

只读命令照常放行：`status`、`diff`、`log`、`show`、`branch`、`fetch`、`rev-parse`、`remote -v`、`config --get`、`tag`/`tag -l`（列举）、`stash list`、`help`。

另外拦截 `gh` / `glab` / `hub` 的发布类动词（`gh pr create`、`gh pr merge`、`gh release create`、`gh repo create`、`gh workflow run`、`gh api` 的写请求、`glab mr create/merge`、`hub push` 等），因为它们是 git 推送的另一条通道。

## 配置

`cordis.patch.yml` 中该行的 `config`：

| 字段            | 类型     | 说明                                                 |
|-----------------|----------|------------------------------------------------------|
| `enabled`       | boolean  | `false` 时不注册任何 guard（整体关闭）               |
| `gitCommands`   | string[] | 覆盖默认拒绝的 git 子命令列表                        |
| `forgeCommands` | string[] | 覆盖默认拒绝的 forge 动词对，如 `gh pr create`       |
| `message`       | string   | 自定义拒绝文案，`{operation}` 会替换为检测到的操作   |
| `promptNotice`  | boolean  | 是否往系统提示里插入一条说明（默认 `true`）          |
| `loose`         | boolean  | 强制对整段文本做宽松扫描（默认仅对 `run_code` 启用） |

## 自检

```bash
node test.mjs   # 44 条应拦截 / 26 条应放行
```

## 已知边界

这是**策略层**拦截，不是内核级隔离。刻意构造的混淆（base64 解码后执行、动态拼接命令名、自行编译的二进制）无法被文本匹配识别。要防到那个程度，需要在 OS 层限制 agent 进程的凭据（例如让它拿不到 git 远程凭证），而不是靠工具策略。

## 许可证

见 [LICENSE](LICENSE) 文件。

## Star 走势

[![Star 走势](https://api.star-history.com/chart?repos=dtapps/dsh-git-guard&type=date&legend=top-left)](https://www.star-history.com/?repos=dtapps%2Fdsh-git-guard&type=date&legend=top-left)

## 下载量统计图

[![下载量统计图](https://release-monitor.com/chart/dtapps/dsh-git-guard.svg?stable=5)](https://release-monitor.com/#/dtapps/dsh-git-guard)
