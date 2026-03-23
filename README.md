# @hiero/keeper

TypeScript automation toolkit for Hiero/Hedera networks — scheduled transactions, mirror node queries, HCS subscriptions, and more.

## Installation

```bash
npm install @hiero/keeper
```

## Quickstart

```typescript
import { KeeperClient } from "@hiero/keeper";

const client = new KeeperClient({
  network: "testnet",
  operatorId: "0.0.12345",
  operatorKey: "302e020100300506032b657004220420...",
});

// Schedule a transaction to execute after 60 seconds
const scheduleId = await client.scheduleTransaction(tx, 60);

// Wait for consensus on a transaction
const result = await client.waitForConsensus(transactionId);

// Subscribe to HCS topic messages with checkpointing
const subscription = client.subscribeTopic("0.0.99999", (message) => {
  console.log("New message:", message);
});

// Query mirror node for topic messages
const messages = await client.getTopicMessages("0.0.99999", { limit: 10 });

// Decode smart contract event logs
const decoded = client.decodeEventLog(contractLog, abi);

// Retry-wrapped execution for transient errors
const safeResult = await client.safeExecute(() => someHederaCall());
```

## API Overview

### KeeperClient

The main entry point. Initialize with your network and operator credentials.

| Method | Description |
|---|---|
| `scheduleTransaction(tx, delaySeconds)` | Schedule a transaction for delayed execution |
| `getScheduleStatus(scheduleId)` | Query the status of a scheduled transaction |
| `appendSignature(scheduleId, key)` | Add a signature to a pending scheduled transaction |
| `getTopicMessages(topicId, params?)` | Fetch paginated HCS topic messages from mirror node |
| `getTransaction(transactionId)` | Fetch transaction details from mirror node |
| `getAccountBalance(accountId)` | Fetch account balance and token associations |
| `subscribeTopic(topicId, callback, options?)` | Subscribe to HCS topic with polling and checkpointing |
| `waitForConsensus(transactionId, timeoutMs?)` | Poll until transaction reaches terminal status |
| `trackTransaction(transactionId)` | Get structured transaction result |
| `createJob(params)` | Create an automation job targeting a smart contract |
| `executeJob(scheduleId)` | Trigger execution of a scheduled job |
| `getJobs(params?)` | Fetch paginated and filtered job history |
| `decodeEventLog(log, abi)` | Decode a contract event log using an ABI definition |
| `safeExecute(fn)` | Wrap any async call with retry logic for transient errors |

## Examples

See the [`examples/`](./examples) directory for runnable scripts demonstrating real-world use cases:

- **[Multi-sig scheduling](./examples/multi-sig-scheduling.ts)** — Schedule a transaction, append signatures from multiple parties, and track execution.
- **[HCS event listener](./examples/hcs-event-listener.ts)** — Subscribe to a topic with checkpoint-based restart safety.
- **[Contract automation](./examples/contract-automation.ts)** — Create automation jobs, index them, and decode contract events.
- **[Resilient transfers](./examples/resilient-transfers.ts)** — Use `safeExecute` for retry-wrapped token transfers.

## Requirements

- Node.js >= 18
- A Hedera/Hiero network account with operator credentials

## License

[Apache-2.0](./LICENSE)
