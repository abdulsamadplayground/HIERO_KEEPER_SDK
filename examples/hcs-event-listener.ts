/**
 * @hiero/keeper — HCS Event Listener with Checkpointing
 *
 * Problem: The official Hedera SDK provides gRPC subscriptions for HCS
 * topics, but if your service restarts you lose your place and must
 * re-process every message from the beginning. Building a polling loop
 * with checkpoint persistence is tedious and error-prone.
 *
 * Solution: The Keeper SDK's subscribeTopic() handles:
 *   - Mirror Node polling at a configurable interval
 *   - Base64 decoding of message content
 *   - Automatic checkpoint tracking after each message
 *   - Resume-from-checkpoint on restart
 *   - Graceful shutdown via stop()
 *
 * Usage:
 *   npx ts-node examples/hcs-event-listener.ts
 */

import * as fs from "node:fs";
import { KeeperClient } from "@hiero/keeper";
import type { Checkpoint, TopicMessage } from "@hiero/keeper";

const CHECKPOINT_FILE = "./hcs-checkpoint.json";

/**
 * Load a previously saved checkpoint from disk.
 * Returns undefined if no checkpoint file exists (first run).
 */
function loadCheckpoint(): Checkpoint | undefined {
  try {
    const raw = fs.readFileSync(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return undefined; // first run — start from the beginning
  }
}

/**
 * Persist the checkpoint to disk so we can resume after a restart.
 */
function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function main() {
  // --- Step 1: Initialize the Keeper client ---
  const keeper = new KeeperClient({
    network: "testnet",
    operatorId: "YOUR_OPERATOR_ID",
    operatorKey: "YOUR_OPERATOR_KEY",
  });

  // --- Step 2: Load any existing checkpoint ---
  // If the service was previously running, we pick up exactly where we
  // left off. No duplicate processing, no missed messages.
  const existingCheckpoint = loadCheckpoint();
  if (existingCheckpoint) {
    console.log(
      `Resuming from checkpoint: seq=${existingCheckpoint.lastSequenceNumber}, ` +
      `ts=${existingCheckpoint.lastTimestamp}`,
    );
  } else {
    console.log("No checkpoint found — starting from the beginning.");
  }

  // --- Step 3: Subscribe to the topic ---
  const topicId = "0.0.YOUR_TOPIC_ID";

  const subscription = keeper.subscribeTopic(
    topicId,
    // This callback fires for every new message, already base64-decoded.
    (message: TopicMessage) => {
      console.log(`[seq ${message.sequence_number}] ${message.message}`);
    },
    {
      // Poll every 3 seconds (default is 5 seconds)
      pollingIntervalMs: 3_000,

      // Resume from the saved checkpoint (if any)
      checkpoint: existingCheckpoint,

      // Persist checkpoint after each successfully processed message
      onCheckpoint: (checkpoint: Checkpoint) => {
        saveCheckpoint(checkpoint);
      },

      // Log polling errors without crashing the subscription
      onError: (error: Error) => {
        console.error("Polling error:", error.message);
      },
    },
  );

  console.log(`Listening on topic ${topicId}... (Ctrl+C to stop)`);

  // --- Step 4: Graceful shutdown ---
  // When the process receives SIGINT (Ctrl+C), stop the subscription
  // cleanly. The last checkpoint is already persisted, so the next run
  // will resume seamlessly.
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    subscription.stop();
    console.log(`Subscription active: ${subscription.isActive}`); // false
    console.log("Goodbye!");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
