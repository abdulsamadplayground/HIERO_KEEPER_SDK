#!/usr/bin/env bash
# ============================================================================
#  @hiero/keeper — SDK Verification Demo
# ============================================================================
#
#  This script runs every verification step needed to confirm the SDK is
#  fully functional: dependency install, linting, type checking, unit tests,
#  property-based tests, integration tests, coverage report, and a build.
#
#  After each test suite, HashScan links are printed so you can cross-reference
#  the entity types (accounts, topics, transactions, schedules, contracts)
#  that the SDK operates on against the live Hedera testnet explorer.
#
#  Usage:
#    chmod +x demo.sh
#    ./demo.sh
#
# ============================================================================

set -euo pipefail

# --- Colors ----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

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

# ============================================================================
#  STEP 1 — Environment Check
# ============================================================================
header "Environment Check"

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

# ============================================================================
#  STEP 2 — Install Dependencies
# ============================================================================
header "Install Dependencies"

run_check "npm install (clean install)" npm ci --ignore-scripts

# ============================================================================
#  STEP 3 — Linting
# ============================================================================
header "ESLint — Code Quality"

run_check "eslint src/ (typescript-eslint strict)" npm run lint

echo ""
echo "  Validates:"
echo "    • No unused variables or imports"
echo "    • No non-null assertions"
echo "    • No explicit 'any' types"
echo "    • Consistent code style across all modules"

# ============================================================================
#  STEP 4 — Type Checking
# ============================================================================
header "TypeScript — Static Type Checking"

run_check "tsc --noEmit (strict mode)" npm run typecheck

echo ""
echo "  Validates:"
echo "    • All type definitions in src/types.ts are consistent"
echo "    • All module interfaces match their implementations"
echo "    • No implicit any, strict null checks enabled"

# ============================================================================
#  STEP 5 — Unit Tests (per module)
# ============================================================================
header "Unit Tests — All SDK Modules"

echo ""
echo "  Running 114 tests across 10 test files..."
echo "  Includes unit tests + property-based tests (fast-check) + integration"
echo ""

run_check "RetryPolicy — exponential backoff, jitter, transient error handling" \
  npx vitest --run src/retry-policy.test.ts

hashscan_links \
  "https://hashscan.io/testnet  (Testnet Explorer Home)" \
  "Retry policy handles BUSY and PLATFORM_TRANSACTION_NOT_CREATED status codes" \
  "These are transient Hedera consensus node errors visible in failed tx receipts"

run_check "MirrorNodeClient — REST API, pagination, HTTP error mapping" \
  npx vitest --run src/mirror-node-client.test.ts

hashscan_links \
  "https://hashscan.io/testnet/topic/0.0.100  (Verify topic messages endpoint)" \
  "https://hashscan.io/testnet/transaction/0.0.2@1234567890.000000000  (Verify tx lookup)" \
  "https://hashscan.io/testnet/account/0.0.12345  (Verify account balance endpoint)"

run_check "HcsSubscriber — polling, base64 decoding, checkpoint persistence" \
  npx vitest --run src/hcs-subscriber.test.ts

hashscan_links \
  "https://hashscan.io/testnet/topic/0.0.YOUR_TOPIC_ID  (View HCS topic messages)" \
  "Messages are base64-encoded on the mirror node; SDK decodes them automatically" \
  "Checkpoint tracks consensus_timestamp + sequence_number for resume-safe polling"

run_check "ScheduledTxHelper — schedule create, sign, info query, error mapping" \
  npx vitest --run src/scheduled-tx-helper.test.ts

hashscan_links \
  "https://hashscan.io/testnet/schedule/0.0.SCHEDULE_ID  (View scheduled transaction)" \
  "Schedule IDs returned by ScheduleCreateTransaction are visible on HashScan" \
  "Multi-sig workflows: each ScheduleSignTransaction appends to the same schedule"

run_check "TransactionTracker — consensus polling, timeout, not-found handling" \
  npx vitest --run src/transaction-tracker.test.ts

hashscan_links \
  "https://hashscan.io/testnet/transaction/TRANSACTION_ID  (Verify consensus status)" \
  "waitForConsensus polls until mirror node returns the tx record (SUCCESS/FAILURE)" \
  "trackTransaction does a single lookup — throws NotFoundError on 404"

run_check "KeeperClient — constructor validation, network config, retry wiring" \
  npx vitest --run src/keeper-client.test.ts

hashscan_links \
  "https://hashscan.io/testnet  (Testnet — used when network='testnet')" \
  "https://hashscan.io/mainnet  (Mainnet — used when network='mainnet')" \
  "https://hashscan.io/testnet  (Previewnet — used when network='previewnet')" \
  "KeeperClient auto-resolves mirror node URLs per network"

run_check "AutomationHelper — job creation, validation, serialization" \
  npx vitest --run src/automation-helper.test.ts

hashscan_links \
  "https://hashscan.io/testnet/contract/0.0.CONTRACT_ID  (View target contract)" \
  "https://hashscan.io/testnet/schedule/0.0.SCHEDULE_ID  (View scheduled contract call)" \
  "Jobs wrap ContractExecuteTransaction inside ScheduleCreateTransaction"

run_check "JobIndexer — pagination, sorting, filtering" \
  npx vitest --run src/job-indexer.test.ts

echo ""
echo "  JobIndexer is an in-memory index — no on-chain verification needed."
echo "  Validates pagination math, descending sort, and AND-filter logic."

run_check "EventDecoder — ABI-based contract event log decoding" \
  npx vitest --run src/event-decoder.test.ts

hashscan_links \
  "https://hashscan.io/testnet/contract/0.0.CONTRACT_ID  (View contract events)" \
  "Event logs from ContractCallResult are decoded using ethers.Interface" \
  "Supports Transfer, Approval, and custom events with indexed + non-indexed params"

run_check "Integration — round-trip: schedule → query status → wait for consensus" \
  npx vitest --run src/integration.test.ts

hashscan_links \
  "https://hashscan.io/testnet/schedule/0.0.77777  (Mocked schedule ID in test)" \
  "https://hashscan.io/testnet/transaction/0.0.1234-1700000000-000  (Mocked tx ID)" \
  "Full flow: ScheduleCreate → ScheduleInfoQuery → Mirror Node poll → TransactionDetail"

# ============================================================================
#  STEP 6 — Full Test Suite (single run, all at once)
# ============================================================================
header "Full Test Suite — All 114 Tests"

run_check "vitest --run (complete suite)" npm test

# ============================================================================
#  STEP 7 — Test Coverage Report
# ============================================================================
header "Test Coverage Report"

run_check "vitest --coverage (v8 provider)" npm run test:coverage

echo ""
echo "  Coverage report generated in ./coverage/"
echo "  Open coverage/index.html in a browser for the full interactive report."

# ============================================================================
#  STEP 8 — Production Build
# ============================================================================
header "Production Build — CJS + ESM + Type Declarations"

run_check "tsup (dual format build)" npm run build

echo ""
echo "  Build output in ./dist/:"
echo "    • dist/index.js     — ESM module"
echo "    • dist/index.cjs    — CommonJS module"
echo "    • dist/index.d.ts   — TypeScript declarations (ESM)"
echo "    • dist/index.d.cts  — TypeScript declarations (CJS)"

# ============================================================================
#  STEP 9 — Package Verification
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
#  STEP 10 — HashScan Quick-Reference for Live Verification
# ============================================================================
header "HashScan Quick-Reference — Verify On-Chain After Real Deployment"

echo ""
echo -e "  ${BOLD}After running the SDK against a real Hedera testnet account,${NC}"
echo -e "  ${BOLD}use these HashScan URLs to verify on-chain state:${NC}"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────────┐"
echo "  │  Entity Type       │  HashScan URL                                 │"
echo "  ├─────────────────────────────────────────────────────────────────────┤"
echo "  │  Account           │  https://hashscan.io/testnet/account/{id}     │"
echo "  │  Transaction       │  https://hashscan.io/testnet/transaction/{id} │"
echo "  │  Scheduled Tx      │  https://hashscan.io/testnet/schedule/{id}    │"
echo "  │  HCS Topic         │  https://hashscan.io/testnet/topic/{id}       │"
echo "  │  Smart Contract    │  https://hashscan.io/testnet/contract/{id}    │"
echo "  │  Token             │  https://hashscan.io/testnet/token/{id}       │"
echo "  └─────────────────────────────────────────────────────────────────────┘"
echo ""
echo "  Replace {id} with the actual entity ID (e.g. 0.0.12345)."
echo "  For mainnet, replace 'testnet' with 'mainnet' in the URL."
echo ""
echo "  Example verification flow after running examples/multi-sig-scheduling.ts:"
echo "    1. Copy the Schedule ID from console output"
echo "    2. Open https://hashscan.io/testnet/schedule/0.0.{SCHEDULE_ID}"
echo "    3. Verify signatories, expiration time, and execution status"
echo "    4. Click the executed transaction link to see transfers"
echo ""
echo "  Example verification flow after running examples/hcs-event-listener.ts:"
echo "    1. Open https://hashscan.io/testnet/topic/0.0.{TOPIC_ID}"
echo "    2. View the Messages tab to see all submitted messages"
echo "    3. Compare sequence numbers with your checkpoint file"

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
