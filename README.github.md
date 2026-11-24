# dsh-git-guard（GitHub Packages 版）

这份文档只讲**从 GitHub Packages 安装**。默认的 [README.md](README.md) 走 CNB 制品库，适合大多数 DSH 用户；GitHub Packages 需要 token，且包名不同。

## 与 CNB 版的区别

| 项目       | CNB 制品库（默认）                           | GitHub Packages（本文档）                  |
|------------|----------------------------------------------|--------------------------------------------|
| 包名       | `@dtapp/dsh-git-guard`                       | `@dtapps/dsh-git-guard`                    |
| registry   | `https://npm.cnb.cool/dtapp/dsh/-/packages/` | `https://npm.pkg.github.com`               |
| 鉴权       | 公开可读，无需 token                         | **需要 token，公开包也要鉴权**             |
| 发现页搜索 | 有索引源，可搜索                             | 暂无索引源，发现页搜不到，只能用命令行安装 |

两个包内容一样，插件 id 都是 `dsh-git-guard`，拦截行为完全一致。

## 前置一：准备 GitHub token

令牌需要能读 Packages：

- classic PAT：勾选 `read:packages`
- fine-grained token：给 `dtapps/dsh-git-guard` 的 `Packages: Read` 权限

不要把 token 提交进仓库。

## 前置二：配置 profile 的 `.npmrc`

文件位置：`$DSH_HOME/profiles/你的profile名/.npmrc`，`DSH_HOME` 默认取 `~/.dsh`。

写入这两行，把 `ghp_你的Token` 换成你的 token：

```ini
@dtapps:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=ghp_你的Token
```

如果有多个 profile，每个要安装的 profile 都要配一次。

## 安装

```bash
PROFILE=web  # 改成你自己的 profile 名

dsh plugin --profile "$PROFILE" add @dtapps/dsh-git-guard \
  --registry=https://npm.pkg.github.com
```

从源码 checkout 运行 DSH 时，把 `dsh` 换成 `pnpm dsh`。

## 验证与卸载

```bash
dsh --profile "$PROFILE" --dump-config
dsh plugin --profile "$PROFILE" remove @dtapps/dsh-git-guard
```

验证时应该看到 `# == @dtapps/dsh-git-guard` 和 `- id: dsh-git-guard`。

## 注意事项

- **不要用** `scripts/setup-registry.sh`：那个脚本写的是 `@dtapp:registry=...`，指向 CNB 制品库，和 GitHub Packages 的 `@dtapps` 无关。
- DSH 发现页目前只有 CNB 索引源，GitHub Packages 没有索引，所以不能在发现页搜索；请用上面的命令行安装。
- token 过期后重新生成并更新 `.npmrc` 里的 `_authToken` 一行即可，插件本身不用重装。
- 如果你不需要 GitHub Packages，直接按 [README.md](README.md) 用 CNB 制品库即可，那个源公开可读、配置更简单。
