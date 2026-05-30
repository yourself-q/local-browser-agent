#!/bin/bash
# ─── Browser Agent — quick launcher ───────────────────────────────────────────
# Usage:
#   ./run.sh "タスクの内容"
#   ./run.sh "タスクの内容" --steps 30
#   ./run.sh "タスクの内容" --steps 50 --data file.txt image.png
#
# Examples:
#   ./run.sh "news.ycombinator.com のトップ5記事を教えて"
#   ./run.sh "今開いてるページのフォームに答えて提出して"
#   ./run.sh "フォームを埋めて" --steps 50 --data /Users/ryo/Downloads/data.txt

set -e
cd "$(dirname "$0")"

TASK="${1}"

if [ -z "$TASK" ]; then
  echo "使い方: ./run.sh \"タスクの内容\" [--steps N] [--data file1 file2 ...]"
  echo ""
  echo "例:"
  echo "  ./run.sh \"HackerNews のトップ5記事を教えて\""
  echo "  ./run.sh \"フォームを埋めて\" --steps 50 --data /Users/ryo/Downloads/data.txt"
  exit 1
fi

# 残りの引数はそのままCLIに転送 ($2以降すべて)
shift

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Browser Agent"
echo " タスク: $TASK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

LOG_LEVEL=debug \
node --import tsx/esm src/cli/index.ts run \
  --task "$TASK" \
  "$@"
