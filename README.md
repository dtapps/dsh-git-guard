# dsh-git-guard

阻止 agent 自行执行 `git commit`、`git push` 等写操作，装到 profile 后对整个 Harness 生效。

[![定时构建](https://cnb.cool/dtapp/dsh-git-guard/-/badge/git/latest/ci/status/crontab)](https://cnb.cool/dtapp/dsh-git-guard/-/pipeline) [![流水线配置](https://cnb.cool/dtapp/dsh-git-guard/-/badge/git/latest/ci/pipeline-as-code)](https://cnb.cool/dtapp/dsh-git-guard/-/blob/main/.cnb.yml) [![漏洞扫描](https://cnb.cool/dtapp/dsh-git-guard/-/badge/security/vulnerability/full/latest)](https://cnb.cool/dtapp/dsh-git-guard/-/security) [![NPM 拉取次数](https://commit.cool/badge/package/npm/pulls/dtapp/dsh)](https://npm.cnb.cool/dtapp/dsh/-/packages/) [![CNB 访问](https://commit.cool/badge/visit/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 星标](https://cnb.cool/dtapp/dsh-git-guard/-/badge/star)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 分叉](https://cnb.cool/dtapp/dsh-git-guard/-/badge/fork)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 仓库年龄](https://commit.cool/badge/age/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 主要语言](https://commit.cool/badge/language/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 许可证](https://commit.cool/badge/license/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB 存储用量](https://commit.cool/badge/usage/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB Git 存储](https://commit.cool/badge/usage/git/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) [![CNB LFS 存储](https://commit.cool/badge/usage/lfs/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard) 

## 安装到 DeepSeekHarness

代码仓库：https://cnb.cool/dtapp/dsh-git-guard ；npm 包发布在 CNB 制品库
`https://npm.cnb.cool/dtapp/dsh/-/packages/`（包名 `@dtapp/dsh-git-guard`，公开可读，
无需登录或 token）。

### 方式一：插件市场索引源（可在发现页搜索）

仓库自带一份 DSH **format 1** 索引 `market/index.json`，通过 CNB raw 地址直接对外提供：

```text
https://cnb.cool/dtapp/dsh-git-guard/-/git/raw/main/market/index.json
```

在 DSH 中打开 `插件 → 发现 → 索引源`，添加上面的地址（索引源属于 profile，每个 profile 需单独添加一次）。
之后即可在发现页搜索 `@dtapp/dsh-git-guard`，点击安装时索引里的 `source.registry` 会自动指向 CNB 制品库。
索引地址必须直接返回 2xx、不能重定向，加载限时 15 秒；CNB raw 地址已验证满足。

索引随发版自动更新：发布流水线的最后一步会在本仓库维护一条固定 Issue
`[NPC] 更新插件市场索引源`，在评论里 `@dtapp/dsh-git-guard(索引更新员)` 派活，由该角色运行 `node market/build-index.mjs`
并以 PR 形式提交 `market/index.json`（不直接改 `main`）。该步骤失败只告警，不影响发布结果。
NPC 配置见 `.cnb/settings.yml`，派活脚本见 `.cnb/scripts/request-index-update.sh`。

PR 提交后全自动闭环，无需人工介入：

1. `pull_request` 流水线（`ifModify: market/index.json`）启动「索引审查员」NPC，校验索引结构、
   自检结果与 registry 一致性，通过后调用 CNB API 提交 approve 评审；不通过则提交 REQUEST_CHANGES。
2. `pull_request.mergeable` 流水线在评审通过、无冲突后自动 squash 合并并删除源分支。

**一次性设置**：仓库 `设置 → 分支保护` 把 `main` 设为保护分支并勾选「需要评审人批准」——
`pull_request.mergeable` 只在保护分支 + 评审通过时触发，不设置则自动合并不会发生。
另外，派活评论的 `@dtapp/dsh-git-guard(索引更新员)` 需在页面评论框勾选一次「替我上班」以启用工作模式（CLI 无法模拟该开关）。两个角色的 prompt 都定义在 `.cnb/settings.yml` 的 `roles` 里。

手动更新也可以直接运行 `node market/build-index.mjs`，脚本从 registry 读取真实发布时间并重写索引；
也可指定其它源，例如 `node market/build-index.mjs --registry=https://registry.npmjs.org/`。

### 方式二：命令行安装

`dsh plugin` 会把后续参数原样转发给 profile 目录里的 pnpm，因此一条命令即可安装：

```bash
dsh plugin --profile <profile> add @dtapp/dsh-git-guard \
  --registry=https://npm.cnb.cool/dtapp/dsh/-/packages/
```

`<profile>` 填要保护的 profile 名（如 `web`、`desktop`；首次使用会自动初始化）。从源码 checkout
运行 DSH 时，把 `dsh` 换成 `pnpm dsh`。

若不想每次带 `--registry`，可在 `$DSH_HOME/profiles/<profile>/.npmrc` 中固定 scope 映射：

```ini
@dtapp:registry=https://npm.cnb.cool/dtapp/dsh/-/packages/
```

之后直接 `dsh plugin --profile <profile> add @dtapp/dsh-git-guard`。

**提示「未找到相关插件 / 404」时**：

- 这个包没有发布到 npmjs、npmmirror 或 cordis 官方插件市场，因此默认插件市场里搜不到；
  需先按方式一添加自建索引源，或按方式二用命令行安装。
- 命令行安装必须带 `--registry`（或配好 scope 映射）。只写包名会从默认源拉取并报
  `ERR_PNPM_FETCH_404`。
- 若 `~/.npmrc` 或 profile 的 `.npmrc` 里已有指向别处的 `@dtapp:registry`，命令行的 `--registry`
  不会覆盖 scope 级配置，需要先删掉/改对那一行。可用 `npm config get @dtapp:registry` 检查。

安装后验证（应看到 `# == @dtapp/dsh-git-guard` 和 `- id: dsh-git-guard`）：

```bash
dsh --profile <profile> --dump-config
```

重新启动该 profile，guard 即对整个 Harness 生效。卸载用：

```bash
dsh plugin --profile <profile> remove @dtapp/dsh-git-guard
```

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

## 发布（CNB 云原生构建）

`.cnb.yml` 把包发布到 CNB npm 制品库，并创建对应 Release。制品库地址固定为实际创建的
`https://npm.cnb.cool/dtapp/dsh/-/packages/`——npm 制品库名 `dsh` 独立于 git 仓库名 `dsh-git-guard`
（代码仓库叫 `dsh-git-guard`，制品库是通用的 `dsh`，以后其他插件包也发到这里），不能用
`$CNB_REPO_SLUG` 推导；包名读 `package.json`。发布令牌用云原生构建内置 `$CNB_TOKEN`；
用户名 / 邮箱用内置 `$CNB_TOKEN_USER_NAME` / `$CNB_COMMITTER_EMAIL`。

**入参**：`version`（版本号或 `nightly`）与 `commit`（要发布的提交）。

| version 输入 | 渠道 | npm dist-tag | Release |
| --- | --- | --- | --- |
| `1.2.3` | 正式版 | `latest` | 不勾选 prerelease，标记为 latest |
| `1.2.3-rc.1` | rc | `rc` | prerelease |
| `1.2.3-beta.1` | beta | `beta` | prerelease |
| `1.2.3-alpha.1` | alpha | `alpha` | prerelease |
| `1.2.3-nightly.20260101` | nightly | `nightly` | prerelease |
| `nightly` | nightly | `nightly` | 展开成 `<最近正式版 + 1 补丁>-nightly.<UTC 日期>` |

`nightly` 不是版本号本身：手动执行填 `nightly`、定时任务固定用 `nightly`，都会自动展开。
例如最近正式版是 `v0.2.7`，当天 UTC 日期 2026-11-14，则展开为 `0.2.8-nightly.20261114`，
每天一个 tag；Release 只保留最近 3 个 nightly，更早的自动删除。

**只有两种触发方式，共用同一条流水线**（`.cnb.yml` 里 stages 只写一次，两个触发引用同一份
`&stages` 锚点）：

- **定时**（`crontab`）：每天 UTC 00:00（平台时区 Asia/Shanghai 的 08:00）自动跑，固定
  `VERSION=nightly`。
- **手动**（`web_trigger_nightly`）：在分支详情页点「发布 npm」按钮，表单填两个入参
  `version`（必填，semver 或 `nightly`，默认 `nightly`）与 `commit`（选填，留空用分支 HEAD）。
  按钮定义在 `.cnb/web_trigger.yml`。

两种方式的步骤完全一致：切换到指定提交（定时/留空则用 HEAD）→ 解析版本 →
自检 → 创建 nightly 标签 → 发布到制品库 → 创建 Release。本项目零依赖（`test.mjs`
是纯 Node），无需装依赖，直接用 `node:26` 镜像自带的 node/npm。发布用
`tencentcom/npm` 插件，token 取内置的 `$CNB_TOKEN`，无需自管 `.npmrc`。

**脚本职责**：

| 脚本 | 职责 |
| --- | --- |
| `scripts/resolve-version.sh` | 解析 `version`，判定渠道，nightly 自动展开 |
| `scripts/nightly-tag.sh` | 创建并推送 nightly tag |
| `scripts/create-release.sh` | 创建/替换 Release；nightly 渠道额外裁剪到最近 3 个 |
| `scripts/prune-nightly.mjs` | 调 CNB OpenAPI 删除多余的 nightly Release |
| `market/build-index.mjs` | 重建 `market/index.json`（自建索引源），由 NPC 调用或手动运行 |
| `.cnb/scripts/request-index-update.sh` | 发布后维护固定 Issue 并 `@dtapp/dsh-git-guard(索引更新员)` 派活更新索引 |

发布完成后，流水线最后一步会自动在固定 Issue 里 `@dtapp/dsh-git-guard(索引更新员)`，让它运行 `node market/build-index.mjs`
并以 PR 提交索引更新，发现页才能看到新版本。`market/build-index.mjs` 零依赖，只读 registry 和仓库内文件，
自身不会执行任何 git 操作。

本地验证版本解析逻辑（不真正发布）：

```bash
VERSION=nightly bash scripts/resolve-version.sh
```

## 已知边界

这是**策略层**拦截，不是内核级隔离。刻意构造的混淆（base64 解码后执行、动态拼接命令名、
自行编译的二进制）无法被文本匹配识别。要防到那个程度，需要在 OS 层限制 agent 进程的
凭据（例如让它拿不到 git 远程凭证），而不是靠工具策略。

## 许可证

见 [LICENSE](LICENSE) 文件。

## Star 走势

<details>
<summary><b>点击展开查看图表</b></summary>

[![CNB Star 走势](https://commit.cool/stars/dtapp/dsh-git-guard)](https://cnb.cool/dtapp/dsh-git-guard)

</details>
