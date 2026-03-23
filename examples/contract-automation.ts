/**
 * @hiero/keeper — Contract Automation Example
 *
 * Problem: Scheduling smart contract calls on Hedera requires composing
 * a ContractExecuteTransaction inside a ScheduleCreateTransaction,
 * managing Schedule IDs, and manually decoding event logs from the
 * Mirror Node. There's no high-level "create a job" abstraction.
 *
 * Solution: The Keeper SDK provides:
 *   - createJob()       — schedule a contract call with one method
 *   - getJobs()         — paginated, filterable job index
 *   - decodeEventLog()  — ABI-based event decoding
 *
 * Usage:
 *   npx ts-node examples/contract-automation.ts
 */

import { KeeperClient } from "@hiero/keeper";
import type { AbiItem, ContractLog } from "@hiero/keeper";

async function main() {
  // --- Step 1: Initialize the Keeper client ---
  const keeper = new KeeperClient({
    network: "testnet",
    operatorId: "YOUR_OPERATOR_ID",
    operatorKey: "YOUR_OPERATOR_KEY",
  });

  // --- Step 2: Create an automation job ---
  // This schedules a contract call to execute after 300 seconds (5 min).
  // The SDK validates the contract ID format and calldata hex encoding
  // before submitting anything to the network.
  console.log("Creating automation job...");
  const job = await keeper.createJob({
    targetContractId: "0.0.98765",       // your deployed contract
    calldata: "0xa9059cbb",              // e.g. ERC-20 transfer selector
    executeAfterSeconds: 300,            // execute in 5 minutes
    rewardHbar: 1,                       // 1 HBAR reward for the executor
  });

  console.log("Job created:");
  console.log(`  Schedule ID : ${job.scheduleId}`);
  console.log(`  Contract    : ${job.targetContractId}`);
  console.log(`  Calldata    : ${job.calldata}`);
  console.log(`  Scheduled At: ${job.scheduledAt}`);
  console.log(`  Status      : ${job.status}`); // "PENDING"

  // --- Step 3: List jobs with pagination ---
  // Fetch the first page of jobs, filtered by status and contract.
  // Results are sorted by scheduledAt descending (newest first).
  console.log("\nFetching jobs (page 1, limit 10)...");
  const page = await keeper.getJobs({
    limit: 10,
    page: 1,
    status: "PENDING",
    targetContractId: "0.0.98765",
  });

  console.log(`Total jobs: ${page.totalCount}`);
  console.log(`Page ${page.page} of ${page.totalPages}`);
  for (const j of page.data) {
    console.log(`  [${j.status}] ${j.scheduleId} → ${j.targetContractId}`);
  }

  // --- Step 4: Decode a contract event log ---
  // After a contract executes, the Mirror Node returns event logs.
  // The SDK decodes them against your ABI so you get structured data
  // instead of raw hex topics and data.
  const transferAbi: AbiItem[] = [
    {
      type: "event",
      name: "Transfer",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    },
  ];

  // Example log from the Mirror Node (topics are keccak256 hashes)
  const exampleLog: ContractLog = {
    address: "0x00000000000000000000000000000000000181cd",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer(address,address,uint256)
      "0x0000000000000000000000000000000000000000000000000000000000001234", // from
      "0x0000000000000000000000000000000000000000000000000000000000005678", // to
    ],
    data: "0x0000000000000000000000000000000000000000000000000000000000000064", // value = 100
  };

  console.log("\nDecoding event log...");
  const decoded = keeper.decodeEventLog(exampleLog, transferAbi);

  console.log(`Event: ${decoded.eventName}`);
  console.log(`Signature: ${decoded.signature}`);
  console.log("Args:");
  for (const [key, value] of Object.entries(decoded.args)) {
    console.log(`  ${key}: ${value}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
