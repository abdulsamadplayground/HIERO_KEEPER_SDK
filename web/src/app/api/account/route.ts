import { NextResponse } from "next/server";
import { HEDERA_CONFIG, mirrorFetch, hashscanLink } from "@/lib/hedera";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accountId = HEDERA_CONFIG.operatorId;
    const data = await mirrorFetch<{ balances: Array<{ account: string; balance: number; tokens: Array<{ token_id: string; balance: number }> }> }>(
      `/api/v1/balances?account.id=${accountId}`
    );

    const entry = data.balances?.[0];
    if (!entry) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({
      account: entry.account,
      balanceHbar: entry.balance / 100_000_000,
      balanceTinybar: entry.balance,
      tokens: entry.tokens,
      hashscanUrl: hashscanLink("account", accountId),
      network: HEDERA_CONFIG.network,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
