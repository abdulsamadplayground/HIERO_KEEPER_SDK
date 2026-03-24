import { NextResponse } from "next/server";
import { HEDERA_CONFIG, mirrorFetch, hashscanLink } from "@/lib/hedera";

export const dynamic = "force-dynamic";

interface Transaction {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  name: string;
  transfers: Array<{ account: string; amount: number }>;
}

export async function GET() {
  try {
    const accountId = HEDERA_CONFIG.operatorId;
    const data = await mirrorFetch<{ transactions: Transaction[]; links: { next: string | null } }>(
      `/api/v1/transactions?account.id=${accountId}&limit=15&order=desc`
    );

    const transactions = (data.transactions || []).map((tx) => ({
      transactionId: tx.transaction_id,
      timestamp: tx.consensus_timestamp,
      result: tx.result,
      type: tx.name,
      transfers: tx.transfers.filter((t) => Math.abs(t.amount) > 0).slice(0, 5),
      hashscanUrl: hashscanLink("transaction", tx.consensus_timestamp),
    }));

    return NextResponse.json({
      accountId,
      transactionCount: transactions.length,
      transactions,
      network: HEDERA_CONFIG.network,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
