#!/usr/bin/env bash
# ============================================================
# E2E TEST — VinPoker Staking Edge Functions (Phase 2)
#
# Cách dùng:
#   export PROJECT_REF="tprwipyoqtfdclnamwjt"
#   export ANON_KEY="<SUPABASE_ANON_KEY>"      # dùng cho header apikey
#   export DEAL_ID="<deal id từ seed-test-deal.sql>"
#   export BACKER_TOKEN="<JWT của tài khoản backer>"
#   export ADMIN1_TOKEN="<JWT super_admin #1 — requester>"
#   export ADMIN2_TOKEN="<JWT super_admin #2 — co-signer, KHÁC #1>"
#
#   bash test-staking.sh
#
# Cách lấy JWT: đăng nhập vào app, mở DevTools → Application → Local Storage
#   → key 'sb-<ref>-auth-token' → copy field "access_token".
#
# Lưu ý: Test happy-path dùng admin override (vì player/backer chưa có UI để confirm).
# ============================================================
set -u
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; CYN='\033[0;36m'; NC='\033[0m'

: "${PROJECT_REF:?PROJECT_REF required}"
: "${ANON_KEY:?ANON_KEY required}"
: "${DEAL_ID:?DEAL_ID required}"
: "${BACKER_TOKEN:?BACKER_TOKEN required}"
: "${ADMIN1_TOKEN:?ADMIN1_TOKEN required}"
: "${ADMIN2_TOKEN:?ADMIN2_TOKEN required}"

BASE="https://${PROJECT_REF}.supabase.co/functions/v1"
PASS=0; FAIL=0

# call <name> <fn-path> <token> <body-json> <expect-status>
call() {
  local name="$1" path="$2" token="$3" body="$4" expect="$5"
  local resp http
  resp=$(curl -sS -o /tmp/staking_resp.json -w "%{http_code}" \
    -X POST "${BASE}/${path}" \
    -H "Authorization: Bearer ${token}" \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "${body}")
  http="$resp"
  if [[ "$http" == "$expect" ]]; then
    echo -e "${GRN}✔${NC} ${name}  [HTTP ${http}]"
    PASS=$((PASS+1))
  else
    echo -e "${RED}✘${NC} ${name}  [HTTP ${http} ≠ expected ${expect}]"
    FAIL=$((FAIL+1))
  fi
  echo -e "${CYN}  → $(cat /tmp/staking_resp.json)${NC}"
  echo
}

echo -e "${YEL}=== HAPPY PATH ===${NC}"

call "1. commit-deal (backer)" \
  "staking-commit-deal" "$BACKER_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\"}" "200"

call "2. confirm-funded (admin1)" \
  "staking-confirm-funded" "$ADMIN1_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\",\"bank_tx_id\":\"MB_TEST_$(date +%s)\",\"amount_vnd\":2400000,\"note\":\"E2E test\"}" "200"

call "3. enter-result (admin1)" \
  "staking-enter-result" "$ADMIN1_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\",\"result_prize_vnd\":30000000}" "200"

call "4. admin-override (admin1) — bypass two-party confirm for E2E" \
  "staking-admin-override" "$ADMIN1_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\",\"reason\":\"E2E test bypass — no UI yet for player/backer confirm\"}" "200"

call "5. request-release (admin1)" \
  "staking-request-release" "$ADMIN1_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\",\"note\":\"E2E\"}" "200"
RR_ID=$(jq -r .release_request_id /tmp/staking_resp.json)
echo -e "${YEL}release_request_id = ${RR_ID}${NC}\n"

echo -e "${YEL}=== EDGE CASES (PHẢI FAIL) ===${NC}"

call "A. cosign by SAME admin (must be 403)" \
  "staking-cosign-release" "$ADMIN1_TOKEN" \
  "{\"release_request_id\":\"${RR_ID}\"}" "403"

call "B. confirm-funded with WRONG amount on a fresh deal would fail" \
  "staking-confirm-funded" "$ADMIN1_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\",\"bank_tx_id\":\"X\",\"amount_vnd\":2399999}" "400"

call "C. commit-deal already taken (must be 400/409)" \
  "staking-commit-deal" "$BACKER_TOKEN" \
  "{\"deal_id\":\"${DEAL_ID}\"}" "400"

echo -e "${YEL}=== CONTINUE HAPPY PATH ===${NC}"

call "6. cosign-release (admin2 — DIFFERENT admin)" \
  "staking-cosign-release" "$ADMIN2_TOKEN" \
  "{\"release_request_id\":\"${RR_ID}\"}" "200"

call "7. execute-release (admin1)" \
  "staking-execute-release" "$ADMIN1_TOKEN" \
  "{\"release_request_id\":\"${RR_ID}\",\"player_bank_tx_id\":\"PAY_PLAYER_$(date +%s)\",\"backer_bank_tx_id\":\"PAY_BACKER_$(date +%s)\",\"note\":\"E2E payout\"}" "200"

echo -e "${YEL}=== IDEMPOTENCY ===${NC}"

call "D. execute-release LẦN 2 (must be 409)" \
  "staking-execute-release" "$ADMIN1_TOKEN" \
  "{\"release_request_id\":\"${RR_ID}\",\"player_bank_tx_id\":\"DUP\",\"backer_bank_tx_id\":\"DUP\"}" "409"

echo -e "${YEL}=================================="
echo -e "PASS: ${PASS}   FAIL: ${FAIL}"
echo -e "==================================${NC}"
[[ "$FAIL" == "0" ]]
