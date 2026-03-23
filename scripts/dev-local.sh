#!/usr/bin/env bash

set -e
cd "$(dirname "$0")/.."

cleanup_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "cleaning port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    local rest
    rest="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$rest" ]; then
      kill -9 $rest 2>/dev/null || true
    fi
  fi
}

cleanup_port 3000
cleanup_port 3001

docker compose up -d
pnpm -C apps/api dev &
pnpm -C apps/web dev &
wait
