#!/usr/bin/env bash
set -euo pipefail

# One-command Release Publisher:
# Usage: ./scripts/release.sh 2.1.0 "可选更新说明"
# Automatically updates metadata.json, commits, tags vX.Y.Z, and pushes to GitHub,
# triggering GitHub Actions (.github/workflows/release.yml) to build and publish the Release zip!

if [ $# -lt 1 ]; then
  echo "用法: ./scripts/release.sh <版本号, 如 2.1.0> [提交说明]"
  exit 1
fi

RAW_VER="$1"
CLEAN_VER="${RAW_VER#v}"
TAG="v${CLEAN_VER}"
MSG="${2:-release: publish ${TAG}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 - "$CLEAN_VER" << 'PY'
import json, sys
ver = sys.argv[1]
with open("metadata.json", "r", encoding="utf-8") as f:
    meta = json.load(f)
meta["version-name"] = ver
meta["version"] = int(meta.get("version", 2)) + 1
with open("metadata.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"Updated metadata.json -> version-name={ver}, version={meta['version']}")
PY

glib-compile-schemas --strict "$ROOT_DIR/schemas"

git add metadata.json schemas/gschemas.compiled
if ! git diff --cached --quiet; then
  git commit -m "$MSG"
fi

git tag -a "$TAG" -m "Release $TAG"
git push origin main
git push origin "$TAG"

echo ""
echo "✅ 已推送 $TAG 到 GitHub！GitHub Actions 正在自动打包并发布 Release："
echo "👉 https://github.com/zhiyang66/topbar-pets/releases"
