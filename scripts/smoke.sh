#!/usr/bin/env bash
set -euo pipefail

RED="\033[0;31m"
GREEN="\033[0;32m"
NC="\033[0m"

PASS=0
FAIL=0
HOST="127.0.0.1"
CLI="packages/cli/dist/cli.mjs"

log_pass() {
  echo -e "  ${GREEN}✔ PASS${NC} $1"
  ((PASS++)) || true
}

log_fail() {
  echo -e "  ${RED}✘ FAIL${NC} $1"
  ((FAIL++)) || true
}

check() {
  if [ "$1" -eq 0 ]; then
    log_pass "$2"
  else
    log_fail "$2 (exit: $1)"
  fi
}

assert_json() {
  local body="$1" key="$2" expected="$3" label="$4"
  local actual
  actual=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)$key)" 2>/dev/null || echo "")
  if [ "$actual" = "$expected" ]; then
    log_pass "$label"
  else
    log_fail "$label (expected '$expected' got '$actual')"
  fi
}

find_free_port() {
  python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()"
}

echo ""
echo "=== deepseek-lane Smoke Tests ==="
echo ""

if [ ! -f "$CLI" ]; then
  echo "ERROR: Build artifact not found at $CLI. Run 'vp run build' first."
  exit 1
fi

# Find a free port
PORT=$(find_free_port)
echo "Using port: $PORT"

# Kill anything on the port (defensive)
lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 0.5

# Kill any previous deepseek-lane processes
pgrep -f "deepseek-lane.*start" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 0.5

echo ""
echo "--- Starting proxy ---"
node "$CLI" start --no-interactive --port="$PORT" --host="$HOST" --no-ngrok --verbose=false &
PROXY_PID=$!

# Wait for server to be ready
DEADLINE=$(( $(date +%s) + 10 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -sf "http://${HOST}:${PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo ""
echo "--- Health Checks ---"

# 1. /healthz
echo "GET /healthz"
BODY=$(curl -s "http://${HOST}:${PORT}/healthz")
status=$?
if [ $status -eq 0 ]; then
  assert_json "$BODY" "['ok']" "True" "healthz returns ok:true"
else
  log_fail "healthz unreachable (curl exit: $status)"
fi

# 2. /v1/healthz
echo "GET /v1/healthz"
BODY=$(curl -s "http://${HOST}:${PORT}/v1/healthz")
status=$?
if [ $status -eq 0 ]; then
  assert_json "$BODY" "['ok']" "True" "v1/healthz returns ok:true"
else
  log_fail "v1/healthz unreachable (curl exit: $status)"
fi

# 3. /v1/models
echo "GET /v1/models"
BODY=$(curl -s "http://${HOST}:${PORT}/v1/models")
status=$?
if [ $status -eq 0 ]; then
  MODEL_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null || echo "0")
  if [ "$MODEL_COUNT" -ge 1 ]; then
    log_pass "v1/models returns model list ($MODEL_COUNT models)"
  else
    log_fail "v1/models returns empty list"
  fi

  HAS_PRO=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
ids = [m['id'] for m in data]
print('yes' if 'deepseek-v4-pro' in ids else 'no')
" 2>/dev/null)
  if [ "$HAS_PRO" = "yes" ]; then
    log_pass "v1/models includes deepseek-v4-pro"
  else
    log_fail "v1/models missing deepseek-v4-pro"
  fi

  HAS_FLASH=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
ids = [m['id'] for m in data]
print('yes' if 'deepseek-v4-flash' in ids else 'no')
" 2>/dev/null)
  if [ "$HAS_FLASH" = "yes" ]; then
    log_pass "v1/models includes deepseek-v4-flash"
  else
    log_fail "v1/models missing deepseek-v4-flash"
  fi
else
  log_fail "v1/models unreachable (curl exit: $status)"
fi

# 4. CORS headers present
echo "GET /v1/models (CORS check)"
CORS_HEADERS=$(curl -s -I -o /dev/null -w "%header{access-control-allow-origin}" "http://${HOST}:${PORT}/v1/models" 2>/dev/null || echo "")
if [ "$CORS_HEADERS" = "*" ]; then
  log_pass "CORS header access-control-allow-origin: *"
else
  log_fail "CORS header (got '$CORS_HEADERS')"
fi

# 5. Auth rejection
echo "POST /v1/chat/completions (no auth)"
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' \
  "http://${HOST}:${PORT}/v1/chat/completions")
if [ "$AUTH_STATUS" = "401" ]; then
  log_pass "rejects unauthenticated request (401)"
else
  log_fail "auth check (got $AUTH_STATUS, expected 401)"
fi

echo ""
echo "--- Cleanup ---"
kill $PROXY_PID 2>/dev/null || true
wait $PROXY_PID 2>/dev/null || true
sleep 0.5

# Kill any remaining processes on port
lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
