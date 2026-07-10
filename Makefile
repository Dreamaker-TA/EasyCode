FRONTEND_PORT ?= 5173
BACKEND_HOST ?= 127.0.0.1
BACKEND_PORT ?= 8000
VITE_API_BASE ?= http://$(BACKEND_HOST):$(BACKEND_PORT)/api

.PHONY: install dev backend frontend ingest migrate seed problem-generate problem-entry-check problem-entry clean ci runtime-check public-audit dependency-audit compose-check release-check bundle-check help docker-up docker-down docker-clean

help:
	@echo "Targets:"
	@echo "  install    安装前后端依赖（uv sync + pnpm install）"
	@echo "  dev        同时启动前后端"
	@echo "  backend    只启动后端 ($(BACKEND_HOST):$(BACKEND_PORT); 可用 BACKEND_PORT=8010)"
	@echo "  frontend   只启动前端 (127.0.0.1:$(FRONTEND_PORT); 可用 FRONTEND_PORT=5174)"
	@echo "  ingest     重灌题库：ingest 脚本 → migrate → seed"
	@echo "  migrate    运行 DB 迁移（alembic upgrade head）"
	@echo "  seed       从 problems.json 灌入题库，并注入 rubric"
	@echo "  problem-generate     交互式调用已配置 LLM，生成、校验并写入一道题（需 BANK_ROOT=/path/to/bank）"
	@echo "  problem-entry-check  从 SPEC 预检单题题库条目（需 BANK_ROOT=/path/to/bank SPEC=/path/to/spec.json）"
	@echo "  problem-entry        从 SPEC 写入 .md/.tests.json/.rubric.md（需 BANK_ROOT=/path/to/bank SPEC=/path/to/spec.json）"
	@echo "  clean      清理依赖、SQLite 文件与摄取产物"
	@echo "  ci         本地预演 CI：前端 typecheck+build+bundle budget，后端运行链路检查"
	@echo "  runtime-check  在一次性目录中验证题库摄取、迁移、写库和核心 API"
	@echo "  public-audit  扫描将被 Git 发布的文件、文档、示例题与高置信密钥"
	@echo "  dependency-audit 扫描前后端锁定依赖中的已知漏洞"
	@echo "  compose-check 校验 Docker Compose 配置（无需启动 daemon）"
	@echo "  release-check  开源前完整检查：public-audit + compose-check + ci + 再次审计"
	@echo "  bundle-check  检查前端 production bundle 预算（需先 build）"
	@echo "  docker-up    🐳 一键起（docker compose up --build；PROBLEM_BANK_HOST_PATH 可挂外部题库）"
	@echo "  docker-down  停容器（保留数据卷）"
	@echo "  docker-clean 停容器并删数据卷（清库）"

install:
	cd backend && uv sync --frozen
	cd frontend && pnpm install --frozen-lockfile

dev:
	$(MAKE) -j2 backend frontend

backend:
	cd backend && uv run uvicorn app.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)

frontend:
	cd frontend && VITE_API_BASE="$(VITE_API_BASE)" pnpm dev --host 127.0.0.1 --port $(FRONTEND_PORT)

ingest:
	cd backend && uv run python ../scripts/ingest_problems.py
	$(MAKE) migrate
	$(MAKE) seed

migrate:
	cd backend && uv run alembic upgrade head

seed:
	cd backend && uv run python -m app.scripts.seed_from_json
	cd backend && uv run python -m app.scripts.seed_rubrics

problem-generate:
	@test -n "$(BANK_ROOT)" || (echo "BANK_ROOT=/absolute/path/to/my-bank is required" >&2; exit 2)
	cd backend && uv run python ../scripts/generate_problem.py --bank-root "$(BANK_ROOT)" --write

problem-entry-check:
	@test -n "$(BANK_ROOT)" || (echo "BANK_ROOT=/absolute/path/to/my-bank is required" >&2; exit 2)
	@test -n "$(SPEC)" || (echo "SPEC=/absolute/path/to/problem.json is required" >&2; exit 2)
	cd backend && uv run python ../scripts/create_problem_entry.py --bank-root "$(BANK_ROOT)" --spec "$(SPEC)"

problem-entry:
	@test -n "$(BANK_ROOT)" || (echo "BANK_ROOT=/absolute/path/to/my-bank is required" >&2; exit 2)
	@test -n "$(SPEC)" || (echo "SPEC=/absolute/path/to/problem.json is required" >&2; exit 2)
	cd backend && uv run python ../scripts/create_problem_entry.py --bank-root "$(BANK_ROOT)" --spec "$(SPEC)" --write

clean:
	rm -rf .pnpm-store backend/.venv frontend/node_modules frontend/dist frontend/.vite
	rm -f backend/data/*.db backend/data/*.sqlite backend/data/*.sqlite3 backend/data/*.db-journal backend/data/*.db-shm backend/data/*.db-wal backend/data/problems.json frontend/*.tsbuildinfo
	find backend scripts -type d -name __pycache__ -prune -exec rm -rf {} +
	find backend scripts -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete

ci:
	cd frontend && pnpm typecheck && pnpm build
	node scripts/check_frontend_bundle.mjs
	$(MAKE) runtime-check

runtime-check:
	@tmp_dir="$$(mktemp -d)"; \
	trap 'find "$$tmp_dir" -depth -delete' EXIT; \
	export EASYCODE_PROBLEMS_JSON_PATH="$$tmp_dir/problems.json"; \
	export DB_PATH="$$tmp_dir/easycode.db"; \
	$(MAKE) ingest; \
	cd backend; \
	uv run python -c 'from pathlib import Path; files = [*Path("app").rglob("*.py"), *Path("alembic").rglob("*.py"), *Path("../scripts").glob("*.py")]; [compile(path.read_text(encoding="utf-8"), str(path), "exec") for path in files]; print(f"Backend source compile: {len(files)} files")'; \
	uv run python -c 'from fastapi.testclient import TestClient; from app.main import app; client = TestClient(app); client.__enter__(); health = client.get("/healthz"); problems = client.get("/api/problems"); body = problems.json(); assert health.status_code == 200 and health.json()["status"] == "ok"; assert problems.status_code == 200 and body["total"] == 1; problem_id = body["items"][0]["id"]; detail = client.get(f"/api/problems/{problem_id}"); assert detail.status_code == 200 and "reference_solution_md" not in detail.json(); cases = client.get(f"/api/problems/{problem_id}/tests"); case_body = cases.json(); assert cases.status_code == 200 and case_body["has_tests"] is True; assert len(case_body["cases"]) == 5; assert sum(item["stdin"] is not None for item in case_body["cases"]) == 2; assert sum(item["stdin"] is None for item in case_body["cases"]) == 3; client.__exit__(None, None, None); print("Runtime API check: health, example problem, secret redaction, and 5 cases passed")'

public-audit:
	python3 scripts/audit_public_tree.py

dependency-audit:
	cd frontend && pnpm audit --audit-level low
	cd backend && uvx pip-audit --path "$$(uv run python -c 'import site; print(site.getsitepackages()[0])')" --progress-spinner off

compose-check:
	docker compose config --quiet

release-check:
	$(MAKE) public-audit
	$(MAKE) dependency-audit
	$(MAKE) compose-check
	$(MAKE) ci
	$(MAKE) public-audit

bundle-check:
	node scripts/check_frontend_bundle.mjs

docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-clean:
	docker compose down -v
