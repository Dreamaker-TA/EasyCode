from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


repo_root = Path(SPECPATH).resolve().parent
hidden_imports = collect_submodules("app") + collect_submodules("uvicorn")

a = Analysis(
    [str(repo_root / "desktop" / "backend_entry.py")],
    pathex=[str(repo_root / "backend"), str(repo_root)],
    binaries=[],
    datas=[
        (str(repo_root / "backend" / "alembic"), "backend/alembic"),
        (str(repo_root / "backend" / "alembic.ini"), "backend"),
        (str(repo_root / "backend" / "app" / "services" / "prompts"), "app/services/prompts"),
        (str(repo_root / "frontend" / "dist"), "frontend/dist"),
        (str(repo_root / "examples"), "examples"),
        (str(repo_root / "desktop" / "build" / "problems.json"), "desktop/seed"),
    ],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="easycode-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="easycode-backend",
)
