// @hiero/keeper — Automation helpers and Job model

import { ContractExecuteTransaction, Hbar } from "@hashgraph/sdk";
import type { Client, ScheduleId } from "@hashgraph/sdk";
import type { ScheduledTxHelper } from "./scheduled-tx-helper.js";
import type { CreateJobParams, Job } from "./types.js";
import { ValidationError } from "./errors.js";

const CONTRACT_ID_RE = /^0\.0\.\d+$/;
const HEX_RE = /^(0x)?[0-9a-fA-F]*$/;

/**
 * Validates a contract ID matches the `0.0.N` format.
 */
function validateContractId(id: string): void {
  if (!CONTRACT_ID_RE.test(id)) {
    throw new ValidationError(
      `Invalid contract ID "${id}": must match 0.0.N format`,
    );
  }
}

/**
 * Validates calldata is valid hex (optionally prefixed with 0x).
 */
function validateCalldata(calldata: string): void {
  if (!HEX_RE.test(calldata)) {
    throw new ValidationError(
      `Invalid calldata "${calldata}": must be valid hex`,
    );
  }
}

/**
 * Creates automation Jobs by composing a `ContractExecuteTransaction`
 * into a `ScheduleCreateTransaction` via the `ScheduledTxHelper`.
 */
export class AutomationHelper {
  constructor(
    private readonly scheduledTxHelper: ScheduledTxHelper,
  ) {}

  /**
   * Create and schedule an automation job targeting a smart contract.
   */
  async createJob(params: CreateJobParams, client: Client): Promise<Job> {
    validateContractId(params.targetContractId);
    validateCalldata(params.calldata);

    const contractTx = new ContractExecuteTransaction()
      .setContractId(params.targetContractId)
      .setFunctionParameters(Buffer.from(params.calldata.replace(/^0x/, ""), "hex"))
      .setPayableAmount(new Hbar(params.rewardHbar));

    const scheduleId: ScheduleId = await this.scheduledTxHelper.scheduleTransaction(
      contractTx,
      params.executeAfterSeconds,
      client,
    );

    return {
      scheduleId: String(scheduleId),
      targetContractId: params.targetContractId,
      calldata: params.calldata,
      scheduledAt: new Date().toISOString(),
      executeAfterSeconds: params.executeAfterSeconds,
      rewardHbar: params.rewardHbar,
      status: "PENDING",
    };
  }

  /**
   * Query the status of a scheduled job.
   * In practice, scheduled transactions execute automatically when their
   * expiration time is reached. This is a convenience wrapper.
   */
  async executeJob(scheduleId: string, client: Client): Promise<unknown> {
    const sid = scheduleId as unknown as import("@hashgraph/sdk").ScheduleId;
    return this.scheduledTxHelper.getScheduleStatus(sid, client);
  }
}

/**
 * Serialize a Job to a JSON string.
 */
export function serializeJob(job: Job): string {
  return JSON.stringify(job);
}

/**
 * Deserialize a JSON string to a Job, with basic validation.
 */
export function deserializeJob(json: string): Job {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const requiredFields: (keyof Job)[] = [
    "scheduleId",
    "targetContractId",
    "calldata",
    "scheduledAt",
    "executeAfterSeconds",
    "rewardHbar",
    "status",
  ];

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new ValidationError(`Missing required Job field: ${field}`);
    }
  }

  return parsed as unknown as Job;
}
