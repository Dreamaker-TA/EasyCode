#!/usr/bin/env sh
# EasyCode 容器入口。
# 每次启动幂等地 migrate + seed，然后起 uvicorn。命令对齐 Makefile 的 migrate/seed
# （migrate=alembic upgrade head；seed=upsert + 高级素材注入，均幂等），顺序对齐 scripts/bootstrap.sh 的 make ingest。
set -e

cd /app/backend

# Settings saved from the in-app settings page live on the data volume. Source
# them after Compose-provided defaults so a container restart keeps the user's
# chosen endpoint/model/key.
if [ -n "${EASYCODE_SETTINGS_PATH:-}" ] && [ -f "$EASYCODE_SETTINGS_PATH" ]; then
  echo "[entrypoint] loading persisted settings from $EASYCODE_SETTINGS_PATH ..."
  set -a
  . "$EASYCODE_SETTINGS_PATH"
  set +a
fi

# venv 已在镜像 PATH 上（见 Dockerfile），运行时不经 uv，零联网、零 re-sync。
echo "[entrypoint] alembic upgrade head ..."
alembic upgrade head

echo "[entrypoint] ingesting problem bank ..."
python /app/scripts/ingest_problems.py

echo "[entrypoint] seeding problems from problems.json ..."
python -m app.scripts.seed_from_json

echo "[entrypoint] seeding grading rubrics ..."
python -m app.scripts.seed_rubrics

echo "[entrypoint] starting uvicorn on 0.0.0.0:8000 ..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
