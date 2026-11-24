# dsh-git-guard

阻止 agent 自行执行 `git commit`、`git push` 等写操作，装到 profile 后对整个 Harness 生效。

[![漏洞扫描](https://cnb.cool/dtapp/dsh-git-guard/-/badge/security/vulnerability/full/latest)](https://cnb.cool/dtapp/dsh-git-guard/-/security) [![最新版本](https://cnb.cool/dtapp/dsh-git-guard/-/badge/release)](https://cnb.cool/dtapp/dsh-git-guard/-/releases) [![NPM 拉取次数](https://commit.cool/badge/package/npm/pulls/dtapp/dsh)](https://npm.cnb.cool/dtapp/dsh/-/packages/) [![CNB 访问](https://commit.cool/badge/visit/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 星标](https://cnb.cool/dtapp/dsh-git-guard/-/badge/star)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 分叉](https://cnb.cool/dtapp/dsh-git-guard/-/badge/fork)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 仓库年龄](https://commit.cool/badge/age/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 主要语言](https://commit.cool/badge/language/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 许可证](https://commit.cool/badge/license/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 存储用量](https://commit.cool/badge/usage/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB Git 存储](https://commit.cool/badge/usage/git/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB LFS 存储](https://commit.cool/badge/usage/lfs/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard)

代码仓库：https://cnb.cool/dtapp/dsh-git-guard ；npm 包发布在 CNB 制品库 `https://npm.cnb.cool/dtapp/dsh/-/packages/`（包名 `@dtapp/dsh-git-guard`，公开可读，无需登录或 token）。

## 安装到 DeepSeekHarness

### 前置：一次配置 scope 源（重要）

本页的包与索引都在 CNB 制品库。profile 的 pnpm 默认源若不是 CNB（例如 npmmirror 等镜像），安装与依赖校验会去那里找这个包，找不到或版本滞后就会报 `ERR_PNPM_FETCH_404` / `Lockfile failed supply-chain policy check`。这是 pnpm 校验 lockfile 时按包名回源取证，不是网络故障，也不是需要登录。

最稳的做法是在 profile 的 `.npmrc` 里给 `@dtapp` scope 指定 CNB 地址（只影响本 scope，不动其他依赖）：

```ini
@dtapp:registry=https://npm.cnb.cool/dtapp/dsh/-/packages/
```

文件位置：`$DSH_HOME/profiles/你的profile名/.npmrc`（如 `web`、`desktop`）。不想手写可运行仓库里的辅助脚本，见「辅助脚本」一节。scope 映射对发现页点击安装和 lockfile 供应链校验都生效。手动加过索引源的 profile 也建议补上这一行。

注意：`.npmrc` 里的 `registry=` 是全局默认源；只有 `@dtapp:registry=` 会让 pnpm 在校验/更新时也把 `@dtapp` 包指向 CNB。若 `~/.npmrc` 或 profile `.npmrc` 里已有指向别处的 `@dtapp:registry`，先改正或删掉那一行（`npm config get @dtapp:registry` 可检查）。

### 安装：把插件装进 profile

配好上面的 scope 后，在终端执行（`--profile` 后面换成你的 profile 名，如 `web`、`desktop`）：

```bash
dsh plugin --profile 你的profile名 add @dtapp/dsh-git-guard
```

这条命令把参数原样转发给该 profile 目录里的 pnpm，等价于在 `$DSH_HOME/profiles/你的profile名` 下执行 `pnpm add @dtapp/dsh-git-guard`，依赖和 lockfile 都记在 profile 里。装完重启该 profile（`dsh 你的profile名`），guard 即对整个 Harness 生效。

卸载：

```bash
dsh plugin --profile 你的profile名 remove @dtapp/dsh-git-guard
```

也可以不敲命令：按下一节添加索引源后，在 `插件 → 发现` 里搜索 `@dtapp/dsh-git-guard` 点击安装。

### 插件市场索引源（可在发现页搜索）

仓库自带一份 DSH **format 1** 索引 `market/index.json`，通过 CNB raw 地址直接对外提供：

```text
https://cnb.cool/dtapp/dsh-git-guard/-/git/raw/main/market/index.json
```

在 DSH 中打开 `插件 → 发现 → 索引源`，添加上面的地址（索引源属于 profile，每个 profile 需单独添加一次）。之后即可在发现页搜索 `@dtapp/dsh-git-guard`，点击安装时索引里的 `source.registry` 会指向 CNB 制品库。索引地址必须直接返回 2xx、不能重定向，加载限时 15 秒；CNB raw 地址已验证满足。安装后重新启动该 profile，guard 即对整个 Harness 生效。

### 辅助脚本：配置/撤销 scope 映射

不想手写 profile 的 `.npmrc` 可直接运行 `scripts/setup-registry.sh`（POSIX sh，无需 Node）。它只改 `$DSH_HOME/profiles/你的profile名/.npmrc`，幂等、只动 `@dtapp` 一行，带 `--undo` 可撤销；不挂 `postinstall`、不碰 npm 全局配置。

脚本会自动检测 profile：`~/.dsh/profiles` 下只有一个目录时直接用它，不需要你填名字；有多个时会在终端列出列表让你选（输入序号或名称，通过 `curl | sh` 执行也一样），也可以用 `--profile` 指定。CI 等无终端环境设 `DSH_NON_INTERACTIVE=1` 后，多个 profile 会直接报错退出。

本地已克隆仓库时：

```bash
# 配置
./scripts/setup-registry.sh

# 撤销
./scripts/setup-registry.sh --undo
```

手上没有仓库时，用 curl 拉取同一脚本执行（raw 地址与插件市场索引源同源）：

```bash
curl -fsSL https://cnb.cool/dtapp/dsh-git-guard/-/git/raw/main/scripts/setup-registry.sh | sh -s --            # 配置
curl -fsSL https://cnb.cool/dtapp/dsh-git-guard/-/git/raw/main/scripts/setup-registry.sh | sh -s -- --undo     # 撤销
```

`curl ... | sh` 会直接执行远端脚本，介意的话可先下载查看，或把 `main` 换成固定 tag/commit 避免内容漂移。

`DSH_HOME` 默认取 `~/.dsh`；脚本零依赖，仅在被显式调用时执行。输出语言按 `LC_ALL` → `LC_MESSAGES` → `LANG` 自动选择中文或英文，也可用 `DSH_LANG=zh` / `DSH_LANG=en` 显式覆盖。

## 机制

插件在自己的 `apply()` 里注册一条 `ctx.tools.guard()` 拒绝规则。guard 位于工具执行管线 （`dsh-tools` 的 `ToolExecutionPipeline`）的审批之后、分发之前，是所有工具调用都必须经过的 唯一收口，因此：

- 覆盖当前 profile 下的**所有 agent 与子 agent**（从顶层插件注册，落在 `guards.global`）；
- 覆盖所有能执行 shell 的工具：`bash`、`pwsh`、`terminal_send`、`terminal_write`、`run_code`；
- 被拒绝的调用以 `Error: <理由>` 返回（`isError: true`），模型能看到原因并自行改道；
- 不依赖文件沙箱（沙箱只约束文件写入，管不到 `git push` 这类网络/进程副作用）， 也不依赖审批策略（`policy: never` 只作用于提权）。

## 拦截范围

默认拒绝的 git 子命令：`commit`、`push`、`tag`（非列举）、`merge`、`rebase`、`reset`、 `revert`、`cherry-pick`、`am`、`notes`、`replace`、`gc`、`prune`、`pack-refs`、 `update-ref`、`update-server-info`、`fast-import`、`filter-branch`、`commit-tree`、 `receive-pack`、`send-pack`。

同时覆盖绕过写法：`git -c k=v commit`、`git -C dir push`、`git --git-dir=... push`、 `sh -c 'git push'`、`bash -lc "git commit"`、`env FOO=1 git push`、`sudo git commit`、 `xargs git push`、`git-send-pack`、`echo hi; git commit`、`g"i"t commit`、 `node -e "...execSync('git commit')"`、`python -c "...subprocess.run(['git','push'])"`、 以及终端会话里的 `terminal_send` 文本。

只读命令照常放行：`status`、`diff`、`log`、`show`、`branch`、`fetch`、`rev-parse`、 `remote -v`、`config --get`、`tag`/`tag -l`（列举）、`stash list`、`help`。

另外拦截 `gh` / `glab` / `hub` 的发布类动词（`gh pr create`、`gh pr merge`、 `gh release create`、`gh repo create`、`gh workflow run`、`gh api` 的写请求、 `glab mr create/merge`、`hub push` 等），因为它们是 git 推送的另一条通道。

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

这是**策略层**拦截，不是内核级隔离。刻意构造的混淆（base64 解码后执行、动态拼接命令名、 自行编译的二进制）无法被文本匹配识别。要防到那个程度，需要在 OS 层限制 agent 进程的 凭据（例如让它拿不到 git 远程凭证），而不是靠工具策略。

## 许可证

见 [LICENSE](LICENSE) 文件。

## Star 走势

[![CNB Star 走势](https://commit.cool/stars/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard)
