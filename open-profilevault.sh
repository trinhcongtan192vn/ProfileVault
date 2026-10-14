#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if command -v powershell.exe >/dev/null 2>&1; then
  script_path="$repo_dir/tools/launch-local.ps1"
  if command -v cygpath >/dev/null 2>&1; then
    script_path="$(cygpath -w "$script_path")"
  fi
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$script_path"
else
  printf '%s\n' 'ProfileVault local launcher requires Windows. Double-click Open-ProfileVault.cmd on Windows.' >&2
  exit 1
fi
