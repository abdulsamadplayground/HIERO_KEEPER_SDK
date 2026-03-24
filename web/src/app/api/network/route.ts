import { NextResponse } from "next/server";
import { HEDERA_CONFIG, mirrorFetch, HASHSCAN_BASE } from "@/lib/hedera";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await mirrorFetch<{ blocks: Array<{ number: number; timestamp: { from: string } }> }>(
      `/api/v1/blocks?limit=1&order=desc`
    );

    const latestBlock = data.blocks?.[0];

    return NextResponse.json({
      network: HEDERA_CONFIG.network,
      mirrorNodeUrl: HEDERA_CONFIG.mirrorNodeUrl,
      operatorId: HEDERA_CONFIG.operatorId,
      topicId: HEDERA_CONFIG.topicId,
      latestBlock: latestBlock ? { number: latestBlock.number, timestamp: latestBlock.timestamp.from } : null,
      hashscanBase: HASHSCAN_BASE,
      status: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      network: HEDERA_CONFIG.network,
      status: "error",
      error: String(err),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
