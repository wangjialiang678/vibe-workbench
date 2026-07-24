#!/usr/bin/env bash
# 把「AI 怎么用工作台」的协议装进你的 AI 编码工具。
# 用法：
#   bash integrations/install.sh                 # 自动探测装哪个
#   bash integrations/install.sh claude-code     # 只装 Claude Code skill
#   bash integrations/install.sh codex [项目目录] # 往项目 AGENTS.md 追加协议
#   bash integrations/install.sh workbuddy [项目目录]
set -euo pipefail

WB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTOCOL="$WB/integrations/workbench-protocol.md"
TARGET="${1:-auto}"
PROJECT_DIR="${2:-$(pwd)}"

info() { printf '  %s\n' "$1"; }
ok()   { printf '✓ %s\n' "$1"; }

install_claude_code() {
  local dir="$HOME/.claude/skills/workbench"
  mkdir -p "$dir"
  cp "$WB/integrations/claude-code/SKILL.md" "$dir/SKILL.md"
  cp "$PROTOCOL" "$dir/workbench-protocol.md"
  printf '%s\n' "$WB" > "$dir/workbench-path.txt"
  ok "Claude Code skill 已装到 $dir"
  info "新开一个 Claude Code 会话，说「用工作台确认一下方案」即可触发。"
}

# 往目标项目的 AGENTS.md 追加协议段落（幂等：已存在则替换）
install_agents_md() {
  local label="$1" agent_env="$2"
  local target="$PROJECT_DIR/AGENTS.md"
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

  mv "$tmp" "$target"
  ok "$label 协议已写入 $target"
  info "该项目下新开会话即可生效；重复执行本脚本会覆盖同一段落，不会重复追加。"
}

detect_and_install() {
  local found=0
  if [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1; then
    install_claude_code; found=1
  fi
  if command -v codex >/dev/null 2>&1; then
    install_agents_md "Codex" "codex"; found=1
  fi
  if [ -d "$HOME/.workbuddy" ] || command -v codebuddy >/dev/null 2>&1; then
    install_agents_md "WorkBuddy" "workbuddy"; found=1
  fi
  if [ "$found" -eq 0 ]; then
    echo "没探测到 Claude Code / Codex / WorkBuddy。"
    echo "请显式指定：bash integrations/install.sh [claude-code|codex|workbuddy] [项目目录]"
    exit 1
  fi
}

case "$TARGET" in
  auto)        detect_and_install ;;
  claude-code) install_claude_code ;;
  codex)       install_agents_md "Codex" "codex" ;;
  workbuddy)   install_agents_md "WorkBuddy" "workbuddy" ;;
  *) echo "未知目标：$TARGET（可选 claude-code / codex / workbuddy）"; exit 1 ;;
esac

echo
echo "工作台路径：$WB"
echo "下一步：node \"$WB/bin/workbench.mjs\" up --port 8099"
