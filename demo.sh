#!/usr/bin/env bash
# ============================================================================
#  @hiero/keeper — SDK Verification Demo
# ============================================================================
#
#  Runs every verification step needed to confirm the SDK is fully functional:
#  linting, type checking, unit tests, property-based tests, integration tests,
#  coverage report, and a production build.
#
#  Prerequisites: run `npm install` before executing this script.
#
#  Usage:
#    chmod +x demo.sh
#    ./demo.sh
#
# ============================================================================

set -uo pipefail

# --- Load .env if present --------------------------------------------------
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

# --- Colors ----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Resolve local binaries ------------------------------------------------
# Use the project-local node_modules/.bin so we never rely on global installs.
VITEST="./node_modules/.bin/vitest"
TSC="./node_modules/.bin/tsc"
TSUP="./node_modules/.bin/tsup"
ESLINT="./node_modules/.bin/eslint"

# --- Helpers ---------------------------------------------------------------
step=0
pass_count=0
fail_count=0

header() {
  step=$((step + 1))
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  Step ${step}: $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

run_check() {
  local label="$1"
  shift
  echo -e "\n${YELLOW}▸ ${label}${NC}"
  if "$@"; then
    echo -e "${GREEN}  ✔ ${label} passed${NC}"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}  ✘ ${label} FAILED${NC}"
    fail_count=$((fail_count + 1))
  fi
}

hashscan_links() {
  echo -e "\n${CYAN}  ── HashScan Verification Links (Hedera Testnet) ──${NC}"
  for link in "$@"; do
    echo -e "  ${BOLD}→${NC} ${link}"
  done
}

# Interactive prompt: Enter = continue, Space = skip, returns 0 for continue, 1 for skip
prompt_continue() {
  local label="$1"
  echo ""
  echo -e "  ${BOLD}${label}${NC}"
  echo -en "  ${CYAN}▶ Press [Enter] to continue or [Space] to skip: ${NC}"
  while true; do
    IFS= read -rsn1 key
    if [ "$key" = "" ]; then
      echo ""
      return 0  # Enter pressed
    elif [ "$key" = " " ]; then
      echo ""
      echo -e "  ${YELLOW}⏭  Skipped${NC}"
      return 1  # Space pressed
    fi
  done
}

# ============================================================================
#  STEP 1 — Environment & Dependency Check
# ============================================================================
header "Environment & Dependency Check"

echo -e "  Node.js : $(node --version)"
echo -e "  npm     : $(npm --version)"
echo -e "  OS      : $(uname -s 2>/dev/null || echo "Windows")"
echo -e "  Date    : $(date)"

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}  ✘ Node.js >= 18 is required. Found v${NODE_MAJOR}.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✔ Node.js version meets minimum requirement (>=18)${NC}"

if [ ! -d "node_modules" ]; then
  echo -e "${RED}  ✘ node_modules not found. Run 'npm install' first.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✔ node_modules present${NC}"


# ============================================================================
#  STEP 2 — Linting
# ============================================================================
header "ESLint — Code Quality"

run_check "eslint src/ (typescript-eslint strict)" "$ESLINT" src

echo ""
echo "  Validates:"
echo "    • No unused variables or imports"
echo "    • No non-null assertions"
echo "    • No explicit 'any' types"
echo "    • Consistent code style across all modules"

# ============================================================================
#  STEP 3 — Type Checking
# ============================================================================
header "TypeScript — Static Type Checking"

run_check "tsc --noEmit (strict mode)" "$TSC" --noEmit

echo ""
echo "  Validates:"
echo "    • All type definitions in src/types.ts are consistent"
echo "    • All module interfaces match their implementations"
echo "    • No implicit any, strict null checks enabled"

# ============================================================================
#  STEP 4 — Unit Tests (per module)
# ============================================================================
header "Unit Tests — All SDK Modules"

echo ""
echo "  Running 114 tests across 10 test files..."
echo "  Includes unit tests + property-based tests (fast-check) + integration"
echo ""

run_check "RetryPolicy — exponential backoff, jitter, transient error handling" \
  "$VITEST" --run src/retry-policy.test.ts

hashscan_links \
  "https://hashscan.io/testnet  (Testnet Explorer Home)" \
  "Retry policy handles BUSY and PLATFORM_TRANSACTION_NOT_CREATED status codes" \
  "These are transient Hedera consensus node errors visible in failed tx receipts"

run_check "MirrorNodeClient — REST API, pagination, HTTP error mapping" \
  "$VITEST" --run src/mirror-node-client.test.ts

hashscan_links \
  "https://hashscan.io/testnet/account/${HEDERA_OPERATOR_ID}  (Verify account balance endpoint)"

run_check "HcsSubscriber — polling, base64 decoding, checkpoint persistence" \
  "$VITEST" --run src/hcs-subscriber.test.ts

hashscan_links \
  "https://hashscan.io/testnet/topic/${HEDERA_TOPIC_ID}  (View HCS topic messages)" \
  "Checkpoint tracks consensus_timestamp + sequence_number for resume-safe polling"

run_check "ScheduledTxHelper — schedule create, sign, info query, error mapping" \
  "$VITEST" --run src/scheduled-tx-helper.test.ts

hashscan_links \
  "Schedule IDs returned by ScheduleCreateTransaction are visible on HashScan" \
  "Multi-sig workflows: each ScheduleSignTransaction appends to the same schedule"

run_check "TransactionTracker — consensus polling, timeout, not-found handling" \
  "$VITEST" --run src/transaction-tracker.test.ts

hashscan_links \
  "waitForConsensus polls until mirror node returns the tx record (SUCCESS/FAILURE)" \
  "trackTransaction does a single lookup — throws NotFoundError on 404"

run_check "KeeperClient — constructor validation, network config, retry wiring" \
  "$VITEST" --run src/keeper-client.test.ts

hashscan_links \
  "https://hashscan.io/testnet  (Testnet — used when network='testnet')" \
  "https://hashscan.io/mainnet  (Mainnet — used when network='mainnet')" \
  "https://hashscan.io/testnet  (Previewnet — used when network='previewnet')" \
  "KeeperClient auto-resolves mirror node URLs per network"

run_check "AutomationHelper — job creation, validation, serialization" \
  "$VITEST" --run src/automation-helper.test.ts

hashscan_links \
  "https://hashscan.io/testnet/account/${HEDERA_OPERATOR_ID}  (View operator account)" \
  "Jobs wrap ContractExecuteTransaction inside ScheduleCreateTransaction"

run_check "JobIndexer — pagination, sorting, filtering" \
  "$VITEST" --run src/job-indexer.test.ts

echo ""
echo "  JobIndexer is an in-memory index — no on-chain verification needed."
echo "  Validates pagination math, descending sort, and AND-filter logic."

run_check "EventDecoder — ABI-based contract event log decoding" \
  "$VITEST" --run src/event-decoder.test.ts

hashscan_links \
  "Event logs from ContractCallResult are decoded using ethers.Interface" \
  "Supports Transfer, Approval, and custom events with indexed + non-indexed params"

run_check "Integration — round-trip: schedule → query status → wait for consensus" \
  "$VITEST" --run src/integration.test.ts

hashscan_links \
  "Full flow: ScheduleCreate → ScheduleInfoQuery → Mirror Node poll → TransactionDetail"


# ============================================================================
#  STEP 5 — Test Coverage Report
# ============================================================================
header "Test Coverage Report"

run_check "vitest --coverage (v8 provider)" "$VITEST" --run --coverage

echo ""
echo "  Coverage report generated in ./coverage/"
echo "  Open coverage/index.html in a browser for the full interactive report."

# ============================================================================
#  STEP 6 — Production Build
# ============================================================================
header "Production Build — CJS + ESM + Type Declarations"

run_check "tsup (dual format build)" "$TSUP"

echo ""
echo "  Build output in ./dist/:"
echo "    • dist/index.js     — ESM module"
echo "    • dist/index.cjs    — CommonJS module"
echo "    • dist/index.d.ts   — TypeScript declarations (ESM)"
echo "    • dist/index.d.cts  — TypeScript declarations (CJS)"

# ============================================================================
#  STEP 7 — Package Verification
# ============================================================================
header "Package Verification"

echo ""
echo "  Checking package.json exports and metadata..."

node -e "
  const pkg = require('./package.json');
  const checks = [
    ['name',        pkg.name === '@hiero/keeper'],
    ['license',     pkg.license === 'Apache-2.0'],
    ['main (CJS)',  pkg.main === './dist/index.cjs'],
    ['module (ESM)',pkg.module === './dist/index.js'],
    ['types',       pkg.types === './dist/index.d.ts'],
    ['engines',     pkg.engines?.node === '>=18'],
    ['exports.import',  !!pkg.exports?.['.']?.import?.default],
    ['exports.require', !!pkg.exports?.['.']?.require?.default],
  ];
  let allOk = true;
  checks.forEach(([label, ok]) => {
    console.log('  ' + (ok ? '✔' : '✘') + ' ' + label);
    if (!ok) allOk = false;
  });
  if (!allOk) process.exit(1);
"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}  ✔ Package metadata verified${NC}"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}  ✘ Package metadata check FAILED${NC}"
  fail_count=$((fail_count + 1))
fi

# ============================================================================
#  STEP 8 — Live Testnet Verification (optional, requires .env credentials)
# ============================================================================
header "Live Testnet Verification"

if [ -z "${HEDERA_OPERATOR_ID:-}" ] || [ -z "${HEDERA_OPERATOR_KEY:-}" ]; then
  echo -e "  ${YELLOW}⚠  No HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in .env — skipping live tests.${NC}"
else
  echo -e "  Operator  : ${HEDERA_OPERATOR_ID}"
  echo -e "  Network   : ${HEDERA_NETWORK:-testnet}"
  echo -e "  Topic     : ${HEDERA_TOPIC_ID:-not set}"
  echo ""

  # Verify topic on mirror node
  if [ -n "${HEDERA_TOPIC_ID:-}" ]; then
    if prompt_continue "Verify topic ${HEDERA_TOPIC_ID} on Mirror Node?"; then
      MIRROR_URL="${HEDERA_MIRROR_NODE_URL:-https://testnet.mirrornode.hedera.com}"
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${MIRROR_URL}/api/v1/topics/${HEDERA_TOPIC_ID}")
      if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}  ✔ Mirror Node confirmed topic ${HEDERA_TOPIC_ID} (HTTP ${HTTP_CODE})${NC}"
        echo -e "  ${BOLD}→${NC} https://hashscan.io/${HEDERA_NETWORK:-testnet}/topic/${HEDERA_TOPIC_ID}"
        pass_count=$((pass_count + 1))
      else
        echo -e "${RED}  ✘ Mirror Node returned HTTP ${HTTP_CODE} for topic ${HEDERA_TOPIC_ID}${NC}"
        fail_count=$((fail_count + 1))
      fi
    fi

    # Submit a message to the topic so HashScan shows message data
    if prompt_continue "Submit a test message to topic ${HEDERA_TOPIC_ID}?"; then
      MSG_RESULT=$(node --input-type=module -e "
        import { TopicMessageSubmitTransaction, Client, PrivateKey } from '@hashgraph/sdk';
        const client = Client.forTestnet();
        client.setOperator(process.env.HEDERA_OPERATOR_ID, PrivateKey.fromStringDer(process.env.HEDERA_OPERATOR_KEY));
        try {
          const tx = await new TopicMessageSubmitTransaction()
            .setTopicId(process.env.HEDERA_TOPIC_ID)
            .setMessage('@hiero/keeper demo — ' + new Date().toISOString())
            .execute(client);
          const receipt = await tx.getReceipt(client);
          process.stdout.write('KEEPER_JSON:' + JSON.stringify({ ok: true, status: receipt.status.toString(), seq: receipt.topicSequenceNumber?.toString() }) + '\n');
        } catch (e) {
          process.stdout.write('KEEPER_JSON:' + JSON.stringify({ ok: false, error: e.message }) + '\n');
        }
        client.close();
      " 2>&1 | grep '^KEEPER_JSON:' | sed 's/^KEEPER_JSON://')

      MSG_OK=$(echo "$MSG_RESULT" | node -e "const d=require('fs').readFileSync(0,'utf8').trim();try{console.log(JSON.parse(d).ok)}catch{console.log('false')}" 2>/dev/null)
      MSG_SEQ=$(echo "$MSG_RESULT" | node -e "const d=require('fs').readFileSync(0,'utf8').trim();try{const j=JSON.parse(d);console.log(j.seq||j.error||'unknown')}catch{console.log('parse error')}" 2>/dev/null)

      if [ "$MSG_OK" = "true" ]; then
        echo -e "${GREEN}  ✔ Message submitted to topic ${HEDERA_TOPIC_ID} (sequence #${MSG_SEQ})${NC}"
        echo -e "  ${BOLD}→${NC} https://hashscan.io/${HEDERA_NETWORK:-testnet}/topic/${HEDERA_TOPIC_ID}  (check Messages tab)"
        pass_count=$((pass_count + 1))
      else
        echo -e "${RED}  ✘ Failed to submit message: ${MSG_SEQ}${NC}"
        fail_count=$((fail_count + 1))
      fi
    fi
  else
    echo -e "  ${YELLOW}⚠  No HEDERA_TOPIC_ID in .env — skipping topic verification.${NC}"
  fi

  echo ""
  if prompt_continue "Verify account ${HEDERA_OPERATOR_ID} balance on Mirror Node?"; then
    MIRROR_URL="${HEDERA_MIRROR_NODE_URL:-https://testnet.mirrornode.hedera.com}"
    BALANCE_RESULT=$(curl -s "${MIRROR_URL}/api/v1/balances?account.id=${HEDERA_OPERATOR_ID}" 2>/dev/null)
    BALANCE=$(echo "$BALANCE_RESULT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);const b=j.balances?.[0]?.balance;console.log(b!==undefined?(b/1e8).toFixed(4)+' ℏ':'not found')}catch{console.log('parse error')}" 2>/dev/null)
    if [ "$BALANCE" != "not found" ] && [ "$BALANCE" != "parse error" ]; then
      echo -e "${GREEN}  ✔ Account ${HEDERA_OPERATOR_ID} balance: ${BALANCE}${NC}"
      echo -e "  ${BOLD}→${NC} https://hashscan.io/${HEDERA_NETWORK:-testnet}/account/${HEDERA_OPERATOR_ID}"
      pass_count=$((pass_count + 1))
    else
      echo -e "${RED}  ✘ Could not fetch balance for ${HEDERA_OPERATOR_ID}${NC}"
      fail_count=$((fail_count + 1))
    fi
  fi
fi

# ============================================================================
#  STEP 9 — HashScan Quick-Reference for Live Verification
# ============================================================================
header "HashScan Quick-Reference — Verify On-Chain After Real Deployment"

echo ""
echo -e "  ${BOLD}After running the SDK against a real Hedera testnet account,${NC}"
echo -e "  ${BOLD}use these HashScan URLs to verify on-chain state:${NC}"
echo ""
echo "  ┌──────────────────────────────────────────────────────────────────────────────┐"
echo "  │  Entity Type       │  HashScan URL                                              │"
echo "  ├──────────────────────────────────────────────────────────────────────────────────┤"
echo "  │  Account           │  https://hashscan.io/testnet/account/${HEDERA_OPERATOR_ID}     │"
echo "  │  HCS Topic         │  https://hashscan.io/testnet/topic/${HEDERA_TOPIC_ID}       │"
echo "  └──────────────────────────────────────────────────────────────────────────────────┘"
echo ""
echo "  Click the links above to verify on-chain state on HashScan."

# ============================================================================
#  SUMMARY
# ============================================================================
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  DEMO COMPLETE${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Checks passed : ${GREEN}${pass_count}${NC}"
echo -e "  Checks failed : ${RED}${fail_count}${NC}"
echo ""

if [ "$fail_count" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}All verification steps passed. The SDK is fully functional.${NC}"
  echo ""
  echo "  Next steps:"
  echo "    • Set real operator credentials and run the example scripts"
  echo "    • Verify transactions on HashScan: https://hashscan.io/testnet"
  echo "    • Publish to npm: npm publish --access public"
  exit 0
else
  echo -e "  ${RED}${BOLD}Some checks failed. Review the output above for details.${NC}"
  exit 1
fi
