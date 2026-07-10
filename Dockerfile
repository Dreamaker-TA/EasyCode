# syntax=docker/dockerfile:1
# EasyCode 一键启动镜像。
# 多阶段：node 构建前端 → python 后端同容器服务静态文件 + /api（单端口 8000）。
# 镜像内 /app = 仓库根，保持原嵌套使 settings.PROJECT_ROOT 解析为 /app。

# ============ stage 1: 前端构建 ============
FROM node:20-slim AS frontend
WORKDIR /build
# 使用与本地和 CI 一致的 pnpm 主版本。
RUN npm install -g pnpm@10.34.4

# 先装依赖（利用层缓存：lockfile 不变则跳过重装）
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷源码构建。构建期烘焙前端环境变量（Vite 在 build 时 inline import.meta.env）：
#   VITE_API_BASE=/api → 浏览器对页面同源调 /api（单容器，无需 CORS）。
# 执行器开关不在构建期烘焙，前端运行时读取 /api/meta。
COPY frontend/ ./
ENV VITE_API_BASE=/api
RUN pnpm build
# → /build/dist（含 index.html、assets/、自托管 pyodide/*.wasm|*.mjs）

# ============ stage 2: 后端 + 静态服务 ============
FROM python:3.12-slim AS backend

# uv 官方镜像拷二进制（最快的安装方式）
COPY --from=ghcr.io/astral-sh/uv:0.7.10 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    DB_PATH=/data/easycode.db

WORKDIR /app/backend

# 先只装依赖（不装本项目，源码改动不会击穿依赖层缓存）
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# 拷后端源码 + 脚本 + 最小样例题库，保持 /app=仓库根 的目录嵌套
COPY backend/ /app/backend/
COPY scripts/ /app/scripts/
COPY examples/ /app/examples/

# 安装本项目（app 包）；依赖已缓存，这步只装项目本身
RUN uv sync --frozen --no-dev

# 把 venv 放上 PATH：运行时直接用 venv 内的 python/alembic/uvicorn，不经 uv，
# 避免 `uv run` 在容器启动时尝试联网 re-sync（会拖慢启动、离线时直接失败）。
ENV PATH="/app/backend/.venv/bin:$PATH"

# entrypoint 可执行（不依赖宿主文件 mode）
RUN chmod +x /app/backend/docker-entrypoint.sh

# 拷前端构建产物（StaticFiles 从 PROJECT_ROOT/frontend/dist 服务）
COPY --from=frontend /build/dist /app/frontend/dist

EXPOSE 8000
ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
