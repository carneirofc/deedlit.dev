# Toolchain & Environment (Windows / PowerShell)

Version-managed toolchains that are **not** on the bare PATH. Don't go hunting for these every session.

## Node — managed by **fnm**
- `fnm.exe`: `%LOCALAPPDATA%\Microsoft\WinGet\Links\fnm.exe` (already on PATH).
- `FNM_DIR`: `%APPDATA%\fnm`; installed versions live under `…\fnm\node-versions\`.
- Default/active version: **v24.13.1** (`node` resolves into an fnm multishell, not a fixed path).
- Activate in a PowerShell session (the Bash/PowerShell tool does NOT auto-load fnm):
  ```powershell
  fnm env --use-on-cd | Out-String | Invoke-Expression
  ```
  After that, `node`, `npm`, `npx` work. `--use-on-cd` makes fnm honor a repo's `.node-version`/`.nvmrc` on entry. Use `npm` for workspace scripts (see the root [`AGENTS.md`](../../AGENTS.md) Command Reference).

## Python — managed by **uv**, per-package venvs
- `uv.exe`: `%USERPROFILE%\.local\bin\uv.exe` (on PATH).
- ⚠️ Bare `python` on PATH is the **Windows Store stub** (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`) — do not use it.
- `deedlit.vision/` has its own venv: `deedlit.vision\.venv` (**Python 3.14.5**).
  - Activate: `deedlit.vision\.venv\Scripts\Activate.ps1`
  - Or run without activating: `uv run --project deedlit.vision <cmd>` (or `cd deedlit.vision; uv run <cmd>`).
- To get a python without a venv: `uv run python …` or `uv python find`.
