# 环境变量优先级高于 .env：include 的赋值会覆盖环境值，先暂存一份
ifeq ($(origin GIT_REMOTE),environment)
    GIT_REMOTE_ENV := $(GIT_REMOTE)
endif

# 加载 .env 文件（如果存在）
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

ifneq ($(GIT_REMOTE_ENV),)
    GIT_REMOTE := $(GIT_REMOTE_ENV)
endif

# 同步/推送目标远程，逗号分隔：GIT_REMOTE=origin,github,gitlab
# 可通过 .env / 环境变量 / 命令行覆盖，未配置时默认 origin。
GIT_REMOTE ?= origin
export GIT_REMOTE

#####################
## 格式化 相关
#####################

# 格式化 YAML 文件
.PHONY: format-yaml
format-yaml:
	@bash scripts/format.sh yaml

# 格式化 JSON 文件
.PHONY: format-json
format-json:
	@bash scripts/format.sh json

# 格式化 SQL 文件
.PHONY: format-sql
format-sql:
	@bash scripts/format.sh sql

# 格式化 Markdown 文件
.PHONY: format-markdown
format-markdown:
	@bash scripts/format.sh markdown

# 格式化 Dockerfile 文件
.PHONY: format-docker
format-docker:
	@bash scripts/format.sh docker

# 格式化 Shell 脚本
.PHONY: format-shell
format-shell:
	@bash scripts/format.sh shell

# 格式化/修复项目
.PHONY: format
format: format-yaml format-json format-sql format-markdown format-docker format-shell

#####################
## 更新 / 拉取 / 推送 相关
#####################

# 按 GIT_REMOTE 顺序先全部拉取合并，再统一推送（保留本地未提交改动）
# 合并策略：能快进则快进；某远程与本地已分叉时自动改用 merge --no-ff 生成合并提交
# （分叉场景典型来源：某个远程上被 squash-merge 过 PR，历史与本地不同源）
# 脏工作区：统一用 merge --autostash，合并前自动 stash、合并后还原，
#           避免 "local changes would be overwritten by merge" 直接把整个流程中止
.PHONY: sync
sync:
	@branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	if [ "$$branch" = "HEAD" ]; then echo "✗ 当前处于 detached HEAD，请先切回分支"; exit 1; fi; \
	remotes="$$(printf '%s' "$$GIT_REMOTE" | tr -d ' \r' | tr ',' ' ')"; \
	if [ -z "$$remotes" ]; then echo "✗ GIT_REMOTE 为空"; exit 1; fi; \
	if [ -n "$$(git status --porcelain)" ]; then \
		echo "ℹ 检测到未提交改动，合并前会自动 stash、合并后还原（暂存状态会变成未暂存）："; \
		git status --porcelain | sed 's/^/    /'; \
	fi; \
	for r in $$remotes; do \
		echo "→ [$$r] fetch"; \
		git fetch "$$r" || exit 1; \
		if ! git rev-parse --verify -q "refs/remotes/$$r/$$branch" >/dev/null; then \
			echo "  $$r 上没有 $$branch 分支，跳过合并"; continue; \
		fi; \
		if git merge-base --is-ancestor "$$r/$$branch" HEAD; then \
			echo "  $$r/$$branch 可快进/已包含，执行 merge --ff-only"; \
			git merge --ff-only --autostash "$$r/$$branch" || exit 1; \
		else \
			echo "  ⚠ $$r/$$branch 与本地分叉，改用 merge --no-ff"; \
			git merge --no-ff --no-edit --autostash "$$r/$$branch" || { \
				echo "✗ 合并失败（多为真实内容冲突）"; \
				if git rev-parse -q --verify MERGE_HEAD >/dev/null; then \
					git merge --abort; echo "  已回滚本次合并，本地改动已从 autostash 还原"; \
				else \
					echo "  合并没有真正开始（未产生 MERGE_HEAD），无需回滚"; \
				fi; \
				exit 1; \
			}; \
		fi; \
	done; \
	for r in $$remotes; do \
		echo "→ [$$r] push"; \
		git push "$$r" HEAD || exit 1; \
	done; \
	echo "同步完成！"

# 推送到所有远程仓库
.PHONY: push
push:
	@IFS=,; for r in $$GIT_REMOTE; do git push "$$r" HEAD || exit 1; done
	@echo "推送完成！"

# 强制推送到所有远程仓库（忽略冲突）
.PHONY: push-force
push-force:
	@IFS=,; for r in $$GIT_REMOTE; do git push --force "$$r" HEAD || exit 1; done
	@echo "强制推送完成！"
