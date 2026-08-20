#!/usr/bin/env bash
# 把「AI 怎么用工作台」的协议装进你的 AI 编码工具。
# 用法：
#   bash integrations/install.sh                  # 自动探测装哪个
#   bash integrations/install.sh claude-code      # 装 Claude Code skill（软链接，随仓库自动更新）
#   bash integrations/install.sh codex-global     # 装进 ~/.codex/AGENTS.md（对所有项目生效）
#   bash integrations/install.sh codex [项目目录]  # 往某个项目的 AGENTS.md 追加协议
#   bash integrations/install.sh workbuddy [项目目录]
#   bash integrations/install.sh hooks            # 装 git 钩子：本仓提交后自动刷新注入式副本
set -euo pipefail

WB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTOCOL="$WB/integrations/workbench-protocol.md"
TARGET="${1:-auto}"
PROJECT_DIR="${2:-$(pwd)}"

info() { printf '  %s\n' "$1"; }
ok()   { printf '✓ %s\n' "$1"; }

# 软链接优先：链接过去后仓库更新即生效，不存在"副本变旧"的问题。
# 文件系统不支持软链接（少数 Windows/网络盘）时退回复制。
link_or_copy() {
  local src="$1" dst="$2"
  rm -f "$dst"
  if ln -s "$src" "$dst" 2>/dev/null; then echo link; else cp "$src" "$dst"; echo copy; fi
}

install_claude_code() {
  local dir="$HOME/.claude/skills/workbench"
  mkdir -p "$dir"
  local mode; mode="$(link_or_copy "$WB/integrations/claude-code/SKILL.md" "$dir/SKILL.md")"
  link_or_copy "$PROTOCOL" "$dir/workbench-protocol.md" >/dev/null
  printf '%s\n' "$WB" > "$dir/workbench-path.txt"
  ok "Claude Code skill 已装到 ${dir}（${mode}）"
  if [ "$mode" = link ]; then
    info "软链接指向仓库文件：以后 git pull / 本地改动即时生效，无需重装。"
  else
    info "本文件系统不支持软链接，装的是副本——仓库更新后需重跑本脚本。"
  fi
}

# 往目标 AGENTS.md 追加协议段落（幂等：已存在则替换）
# 第三参数给绝对路径即写那个文件（用于 ~/.codex/AGENTS.md 全局安装）
install_agents_md() {
  local label="$1" agent_env="$2"
  local target="${3:-$PROJECT_DIR/AGENTS.md}"
  local marker_start="<!-- vibe-workbench:start -->"
  local marker_end="<!-- vibe-workbench:end -->"
  local tmp; tmp="$(mktemp)"

  # 已有同名段落 → 先剥掉，实现覆盖安装
  if [ -f "$target" ] && grep -qF "$marker_start" "$target"; then
    awk -v s="$marker_start" -v e="$marker_end" '
      index($0,s){skip=1} !skip{print} index($0,e){skip=0}
    ' "$target" > "$tmp"
  elif [ -f "$target" ]; then
    cat "$target" > "$tmp"
    printf '\n' >> "$tmp"
  fi

  {
    printf '%s\n' "$marker_start"
    # 把协议里的 $WB 占位换成真实路径，并注明 agent
    sed -e "s|\`\$WB\`|\`$WB\`|g" -e "s|\$WB|$WB|g" \
        -e "s|WORKBENCH_AGENT=codex|WORKBENCH_AGENT=$agent_env|g" \
        "$WB/integrations/codex/AGENTS.md"
    printf '%s\n' "$marker_end"
  } >> "$tmp"

  mkdir -p "$(dirname "$target")"
  mv "$tmp" "$target"
  ok "$label 协议已写入 $target"
  if [ "$target" = "$HOME/.codex/AGENTS.md" ]; then
    info "全局生效：所有项目的 Codex 会话都会读到；本仓协议更新后重跑一次（或装 hooks 自动刷新）。"
  else
    info "该项目下新开会话即可生效；重复执行本脚本会覆盖同一段落，不会重复追加。"
  fi
}

# AGENTS.md 是"注入式副本"（一个文件里混多来源，无法软链接），
# 所以给本仓装个 post-commit 钩子：协议一变就自动刷新全局副本。
install_hooks() {
  local hook="$WB/.git/hooks/post-commit"
  mkdir -p "$(dirname "$hook")"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# vibe-workbench: 协议变更后自动刷新注入式副本（由 integrations/install.sh hooks 安装）
if git diff-tree --no-commit-id --name-only -r HEAD | grep -q '^integrations/codex/AGENTS.md$'; then
  [ -d "\$HOME/.codex" ] && bash "$WB/integrations/install.sh" codex-global >/dev/null 2>&1 \\
    && echo "  ↳ 已同步刷新 ~/.codex/AGENTS.md 里的工作台协议"
fi
EOF
  chmod +x "$hook"
  ok "git 钩子已装：$hook"
  info "以后本仓一提交，若协议有变就自动刷新 ~/.codex/AGENTS.md。"
}

detect_and_install() {
  local found=0
  if [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1; then
    install_claude_code; found=1
  fi
  # Codex 优先装全局（一次覆盖所有项目），没有 ~/.codex 才退回当前项目
  if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; then
    if [ -d "$HOME/.codex" ]; then
      install_agents_md "Codex（全局）" "codex" "$HOME/.codex/AGENTS.md"
    else
      install_agents_md "Codex" "codex"
    fi
    found=1
  fi
  if [ -d "$HOME/.workbuddy" ] || command -v codebuddy >/dev/null 2>&1; then
    install_agents_md "WorkBuddy" "workbuddy"; found=1
  fi
  if [ "$found" -eq 0 ]; then
    echo "没探测到 Claude Code / Codex / WorkBuddy。"
    echo "请显式指定：bash integrations/install.sh [claude-code|codex-global|codex|workbuddy] [项目目录]"
    exit 1
  fi
}

case "$TARGET" in
  auto)         detect_and_install ;;
  claude-code)  install_claude_code ;;
  codex-global) install_agents_md "Codex（全局）" "codex" "$HOME/.codex/AGENTS.md" ;;
  codex)        install_agents_md "Codex" "codex" ;;
  workbuddy)    install_agents_md "WorkBuddy" "workbuddy" ;;
  hooks)        install_hooks ;;
  *) echo "未知目标：${TARGET}（可选 claude-code / codex-global / codex / workbuddy / hooks）"; exit 1 ;;
esac

echo
echo "工作台路径：$WB"
echo "下一步：node \"$WB/bin/workbench.mjs\" up --port 8099"
