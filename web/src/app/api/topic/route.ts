import { NextResponse } from "next/server";
import { HEDERA_CONFIG, mirrorFetch, hashscanLink } from "@/lib/hedera";

export const dynamic = "force-dynamic";

interface TopicMessage {
  consensus_timestamp: string;
  topic_id: string;
  message: string;
  sequence_number: number;
  payer_account_id: string;
}

export async function GET() {
  try {
    const topicId = HEDERA_CONFIG.topicId;
    if (!topicId) {
      return NextResponse.json({ error: "HEDERA_TOPIC_ID not configured" }, { status: 400 });
    }

    const data = await mirrorFetch<{ messages: TopicMessage[]; links: { next: string | null } }>(
      `/api/v1/topics/${topicId}/messages?limit=25&order=desc`
    );

    const messages = (data.messages || []).map((m) => ({
      sequenceNumber: m.sequence_number,
      timestamp: m.consensus_timestamp,
      message: Buffer.from(m.message, "base64").toString("utf-8"),
      payerAccountId: m.payer_account_id,
    }));

    return NextResponse.json({
      topicId,
      messageCount: messages.length,
      messages,
      hashscanUrl: hashscanLink("topic", topicId),
      network: HEDERA_CONFIG.network,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
