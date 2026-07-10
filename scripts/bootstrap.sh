#!/usr/bin/env bash
# EasyCode 一键初始化脚本。
# 在仓库根目录执行：./scripts/bootstrap.sh
# 幂等：可重复执行；已就绪的步骤会跳过或快速通过。

set -euo pipefail

# --- 终端样式 ---
if [ -t 1 ]; then
  BOLD="\033[1m"; DIM="\033[2m"; RED="\033[31m"; YELLOW="\033[33m"; GREEN="\033[32m"; CYAN="\033[36m"; RESET="\033[0m"
else
  BOLD=""; DIM=""; RED=""; YELLOW=""; GREEN=""; CYAN=""; RESET=""
fi

say()  { echo -e "${CYAN}▸${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
die()  { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

# --- 必须在仓库根 ---
if [ ! -f "Makefile" ] || [ ! -f ".env.example" ]; then
  die "请在仓库根目录执行：./scripts/bootstrap.sh"
fi

# --- 版本检查 ---
say "检查依赖版本"

command -v uv     >/dev/null || die "缺少 uv。安装：curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v node   >/dev/null || die "缺少 node ≥ 20。建议用 nvm 或 fnm 装。"
command -v pnpm   >/dev/null || die "缺少 pnpm ≥ 9。安装：npm i -g pnpm 或 corepack enable"
command -v make   >/dev/null || die "缺少 make"

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "${NODE_MAJOR}" -lt 20 ]; then
  die "node 版本 ${NODE_MAJOR} 太低，需要 ≥ 20"
fi

PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [ "${PNPM_MAJOR}" -lt 9 ]; then
  warn "pnpm 版本 ${PNPM_MAJOR} 低于建议 9，可能仍可用，继续"
fi

ok "uv $(uv --version 2>/dev/null | head -1)"
ok "node $(node --version)"
ok "pnpm $(pnpm --version)"

# --- .env ---
say "检查 .env"
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn "已创建 .env（从 .env.example 拷贝）"
  echo -e "  ${DIM}LLM 配置是可选项；先完成本地安装，之后可编辑 .env 或在设置页填写。${RESET}"
fi

# 提示 placeholder 未替换
if grep -Eq "^LLM_API_KEY=(|sk-xxx|sk-xxxxxxxx|sk-your-real-key-here)$" .env 2>/dev/null; then
  warn ".env 里的 LLM_API_KEY 尚未配置"
  echo -e "  ${DIM}LLM 评测会进入可重试失败状态，不会写入不可信评级。${RESET}"
  echo -e "  ${DIM}继续 bootstrap，但要 E2E 真路径请稍后编辑 .env。${RESET}"
fi
ok ".env 就绪"

# --- 装依赖 ---
say "安装前后端依赖（make install）"
make install
ok "依赖安装完成"

# --- 准备 DB ---
say "题库摄取 + 迁移 + seed（make ingest）"
make ingest
ok "数据库就绪"

echo
echo -e "${BOLD}${GREEN}全部就绪。${RESET}"
echo
echo -e "  启动：${BOLD}make dev${RESET}"
echo -e "  浏览器：${BOLD}http://localhost:5173${RESET}"
echo
