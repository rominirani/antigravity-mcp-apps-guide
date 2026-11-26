#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -x "${PLUGIN_ROOT_DIR}/.venv/bin/python" ]]; then
  exec "${PLUGIN_ROOT_DIR}/.venv/bin/python" "${PLUGIN_ROOT_DIR}/server.py"
fi

if command -v uv >/dev/null 2>&1; then
  exec uv run --quiet --with "mcp>=2.0.0" python3 "${PLUGIN_ROOT_DIR}/server.py"
fi

exec python3 "${PLUGIN_ROOT_DIR}/server.py"
