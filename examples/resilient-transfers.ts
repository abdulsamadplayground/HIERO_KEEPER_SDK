/**
 * @hiero/keeper — Resilient Transfers with safeExecute
 *
 * Problem: Hedera returns transient errors like BUSY and
 * PLATFORM_TRANSACTION_NOT_CREATED during high network load. Without
 * retry logic, your transfers fail intermittently and you need to build
 * your own exponential backoff with jitter.
 *
 * Solution: The Keeper SDK's safeExecute() wraps any async operation
 * with the configured retry policy (exponential backoff + full jitter)
 * and returns a typed Result<T> — either { ok: true, value } on success
 * or { ok: false, error } after all retries are exhausted.
 *
 * Usage:
 *   npx ts-node examples/resilient-transfers.ts
 */

import {
  TransferTransaction,
  AccountId,
  Hbar,
} from "@hashgraph/sdk";
import { KeeperClient } from "@hiero/keeper";

async function main() {
  // --- Step 1: Initialize with custom retry options ---
  // You can tune the retry behavior per your use case. The defaults
  // (5 attempts, 500ms base delay) work well for most scenarios.
  const keeper = new KeeperClient({
    network: "testnet",
    operatorId: "YOUR_OPERATOR_ID",
    operatorKey: "YOUR_OPERATOR_KEY",
    retryOptions: {
      maxAttempts: 5,       // retry up to 5 times
      baseDelayMs: 500,     // 500ms base delay, doubles each attempt
      transientCodes: [     // these error codes trigger a retry
        "BUSY",
        "PLATFORM_TRANSACTION_NOT_CREATED",
      ],
    },
  });

  // --- Step 2: Build a transfer transaction ---
  const transfer = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString("0.0.SENDER"), new Hbar(-5))
    .addHbarTransfer(AccountId.fromString("0.0.RECEIVER"), new Hbar(5));

  // --- Step 3: Execute with automatic retry ---
  // safeExecute wraps the async operation. If the network returns BUSY,
  // the SDK retries with exponential backoff + jitter. If a non-transient
  // error occurs (e.g. INSUFFICIENT_PAYER_BALANCE), it fails immediately.
  console.log("Submitting transfer with retry protection...");

  const result = await keeper.safeExecute(async () => {
    const response = await transfer.execute(keeper.hederaClient);
    const receipt = await response.getReceipt(keeper.hederaClient);
    return receipt;
  });

  // --- Step 4: Handle the Result<T> type ---
  // The result is a discriminated union — check `ok` to determine
  // whether the operation succeeded or failed after all retries.
  if (result.ok) {
    console.log("Transfer succeeded!");
    console.log(`  Status: ${result.value.status}`);
  } else {
    // All retry attempts exhausted, or a non-transient error occurred.
    console.error("Transfer failed after retries:", result.error.message);
  }

  // --- Bonus: Multiple transfers with shared retry policy ---
  // You can wrap any async function — not just transfers. The retry
  // policy is shared across all safeExecute calls on the same client.
  const recipients = ["0.0.1001", "0.0.1002", "0.0.1003"];

  console.log("\nSending batch transfers...");
  for (const recipient of recipients) {
    const tx = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString("0.0.SENDER"), new Hbar(-1))
      .addHbarTransfer(AccountId.fromString(recipient), new Hbar(1));

    const batchResult = await keeper.safeExecute(async () => {
      const response = await tx.execute(keeper.hederaClient);
      return response.getReceipt(keeper.hederaClient);
    });

    if (batchResult.ok) {
      console.log(`  ✓ Sent 1 HBAR to ${recipient}`);
    } else {
      console.log(`  ✗ Failed to send to ${recipient}: ${batchResult.error.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
