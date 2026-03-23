/**
 * @hiero/keeper — Multi-Sig Scheduled Transaction Example
 *
 * Problem: Coordinating multi-signature transactions on Hedera requires
 * manually creating ScheduleCreateTransaction, sharing the Schedule ID,
 * having each signer submit ScheduleSignTransaction, and polling for
 * execution — easily 50+ lines of boilerplate per workflow.
 *
 * Solution: The Keeper SDK wraps this into three calls:
 *   1. scheduleTransaction() — create and submit the scheduled tx
 *   2. appendSignature()     — add a co-signer's key
 *   3. waitForConsensus()    — block until the network executes it
 *
 * Usage:
 *   npx ts-node examples/multi-sig-scheduling.ts
 */

import {
  TransferTransaction,
  AccountId,
  Hbar,
  PrivateKey,
} from "@hashgraph/sdk";
import { KeeperClient } from "@hiero/keeper";

async function main() {
  // --- Step 1: Initialize the Keeper client ---
  // Provide your testnet operator credentials. In production, load these
  // from environment variables or a secrets manager.
  const keeper = new KeeperClient({
    network: "testnet",
    operatorId: "YOUR_OPERATOR_ID",   // e.g. "0.0.12345"
    operatorKey: "YOUR_OPERATOR_KEY", // DER-encoded Ed25519 private key
  });

  // --- Step 2: Build the transaction you want to schedule ---
  // This transfer sends 10 HBAR from a multi-sig treasury to a recipient.
  // The treasury requires two signatures before the network will execute it.
  const transfer = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString("0.0.TREASURY"), new Hbar(-10))
    .addHbarTransfer(AccountId.fromString("0.0.RECIPIENT"), new Hbar(10));

  // --- Step 3: Schedule the transaction with a 60-second delay ---
  // The SDK wraps ScheduleCreateTransaction, sets the expiration, submits
  // it, and returns the Schedule ID from the receipt.
  console.log("Scheduling transfer with 60-second delay...");
  const scheduleId = await keeper.scheduleTransaction(transfer, 60);
  console.log(`Schedule ID: ${scheduleId}`);

  // --- Step 4: Share the Schedule ID with the second signer ---
  // In a real app you'd send this ID over a messaging channel, store it
  // in a database, or pass it through an API. The second signer uses
  // appendSignature() to add their key to the pending schedule.
  console.log("Appending second signer's signature...");
  const secondSignerKey = PrivateKey.fromStringDer("SECOND_SIGNER_PRIVATE_KEY");
  await keeper.appendSignature(scheduleId, secondSignerKey);
  console.log("Second signature appended.");

  // --- Step 5: Wait for the network to execute the scheduled transaction ---
  // Once all required signatures are collected and the expiration time is
  // reached, the network executes the transaction automatically.
  // waitForConsensus polls the Mirror Node until a terminal status appears.
  console.log("Waiting for consensus...");
  const result = await keeper.waitForConsensus(
    scheduleId.toString(),
    120_000, // timeout after 2 minutes
  );

  console.log("Transaction executed!");
  console.log(`  Status : ${result.result}`);
  console.log(`  Timestamp: ${result.consensus_timestamp}`);
  console.log(`  Transfers:`);
  for (const t of result.transfers) {
    console.log(`    ${t.account} → ${t.amount} tinybar`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
