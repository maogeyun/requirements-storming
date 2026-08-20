#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=8888
URL="http://localhost:${PORT}/index.html?v=pacman-4"

cd "$ROOT"

echo ""
echo "需求风暴 · 本地预览（Pac-Man 主题）"
echo "  首页：     ${URL}"
echo "  规则手册： http://localhost:${PORT}/%E9%9C%80%E6%B1%82%E9%A3%8E%E6%9A%B4%E8%A7%84%E5%88%99.html?v=pacman-4"
echo "  卡牌管理： http://localhost:${PORT}/requirement-storm-dashboard.html?v=pacman-4"
echo ""
echo "在 Cursor 内置浏览器打开上述链接，并按 Cmd+Shift+R 硬刷新。"
echo "按 Ctrl+C 停止服务。"
echo ""

exec python3 -m http.server "$PORT"
