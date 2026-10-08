#!/usr/bin/env bash
# 전체 빌드: 데이터 → 다이어그램 SVG → 앱 번들   (어디서 실행해도 됨)
# SKIP_DIAGRAMS=1 tools/build.sh   → 다이어그램(mermaid) 변경이 없을 때 렌더링 생략
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run -s data
if [ "${SKIP_DIAGRAMS:-0}" != "1" ]; then npm run -s diagrams; fi
npm run -s app
echo "완료 — 저장소 루트에서 'python3 -m http.server 8000' 후 http://localhost:8000 으로 확인"
