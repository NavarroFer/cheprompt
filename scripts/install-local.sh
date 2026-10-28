#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extensions_root="${HOME}/.vscode/extensions"
extension_id="$(node -p "const p=require('./package.json'); p.publisher + '.' + p.name + '-' + p.version")"
extension_link="${extensions_root}/${extension_id}"

cd "${project_root}"
npm run compile
mkdir -p "${extensions_root}"

if [[ -L "${extension_link}" ]]; then
  current_target="$(readlink "${extension_link}")"
  if [[ "${current_target}" == "${project_root}" ]]; then
    echo "ChePrompt ya está instalado localmente."
    echo "Recargá VS Code con: Developer: Reload Window"
    exit 0
  fi

  echo "Ya existe otro enlace en ${extension_link}."
  echo "No se modificó nada."
  exit 1
fi

if [[ -e "${extension_link}" ]]; then
  echo "Ya existe una carpeta en ${extension_link}."
  echo "No se modificó nada."
  exit 1
fi

ln -s "${project_root}" "${extension_link}"
echo "ChePrompt quedó instalado localmente en ${extension_link}."
echo "Recargá VS Code con: Developer: Reload Window"
