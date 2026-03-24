// Shared Hedera config and mirror node helpers for API routes

export const HEDERA_CONFIG = {
  operatorId: process.env.HEDERA_OPERATOR_ID || "",
  operatorKey: process.env.HEDERA_OPERATOR_KEY || "",
  network: (process.env.HEDERA_NETWORK || "testnet") as "testnet" | "mainnet" | "previewnet",
  topicId: process.env.HEDERA_TOPIC_ID || "",
  mirrorNodeUrl: process.env.HEDERA_MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com",
};

export const HASHSCAN_BASE = `https://hashscan.io/${HEDERA_CONFIG.network}`;

export function hashscanLink(type: string, id: string): string {
  return `${HASHSCAN_BASE}/${type}/${id}`;
}

// Direct mirror node fetch (no SDK dependency needed for read-only queries)
export async function mirrorFetch<T>(path: string): Promise<T> {
  const url = `${HEDERA_CONFIG.mirrorNodeUrl}${path}`;
  const res = await fetch(url, { next: { revalidate: 5 } });
  if (!res.ok) throw new Error(`Mirror Node ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
