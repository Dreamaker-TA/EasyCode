# EasyCode desktop release

The desktop app packages the existing React frontend and FastAPI backend into a
single local application. End users do not need Docker, Python, Node.js, or a
network connection for code execution. AI review still requires the model
service configured in EasyCode Settings.

## Local build

Install the normal frontend dependencies plus the desktop build dependencies:

```bash
cd frontend && pnpm install --frozen-lockfile && VITE_API_BASE=/api pnpm build
cd ../backend && uv sync --frozen --group desktop
cd .. && uv run --project backend --group desktop python scripts/build_desktop_backend.py
cd desktop && pnpm install --frozen-lockfile
```

Build on the target operating system:

```bash
# macOS
pnpm dist:mac

# Windows (PowerShell)
pnpm dist:win
```

Outputs are written to `desktop/release/`. PyInstaller and Electron must build
on the target operating system; the GitHub release workflow runs the same steps
on native macOS and Windows runners.

## Publishing

1. Update `VERSION`, `desktop/package.json`, `frontend/package.json`,
   `backend/pyproject.toml`, and `backend/app/version.py` together.
2. Run `make release-check` and `make desktop-check`.
3. Push a tag matching the version, for example `v0.1.0`.

The tag triggers `.github/workflows/release.yml`, which builds macOS packages
for Apple Silicon and Intel, a Windows x64 installer and ZIP, generates SHA-256
checksums, and creates the GitHub Release.

## Signing status

The initial workflow produces unsigned packages. macOS Gatekeeper and Windows
SmartScreen may therefore show a warning. Before calling a release stable, add
Apple Developer ID signing/notarization and a Windows code-signing certificate
to the release workflow secrets.
