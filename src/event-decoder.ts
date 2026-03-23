// @hiero/keeper — EventDecoder: ABI-based contract event log decoding

import { Interface } from "ethers";
import type { AbiItem, ContractLog, DecodedEvent } from "./types.js";
import { EventDecodingError } from "./errors.js";

/**
 * Decodes contract event logs against a provided ABI using ethers.Interface.
 */
export class EventDecoder {
  private readonly iface: Interface;

  constructor(abi: readonly AbiItem[]) {
    this.iface = new Interface(abi as AbiItem[]);
  }

  /**
   * Decode a single contract log entry into a structured event.
   *
   * @throws EventDecodingError if the log topic doesn't match any ABI event
   *   or if the log data cannot be decoded.
   */
  decode(log: ContractLog): DecodedEvent {
    let parsed;
    try {
      parsed = this.iface.parseLog({ topics: log.topics, data: log.data });
    } catch (err) {
      throw new EventDecodingError(
        `Failed to decode event log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!parsed) {
      throw new EventDecodingError(
        `No matching event found for topic ${log.topics[0] ?? "(empty)"}`,
      );
    }

    // Convert parsed.args to a plain Record by iterating over event inputs
    const args: Record<string, unknown> = {};
    const fragment = parsed.fragment;
    for (let i = 0; i < fragment.inputs.length; i++) {
      const input = fragment.inputs[i];
      const value = parsed.args[i];
      // Convert BigInt values to strings for serialization safety
      args[input.name] = typeof value === "bigint" ? value.toString() : value;
    }

    return {
      eventName: parsed.name,
      args,
      signature: parsed.signature,
    };
  }
}
