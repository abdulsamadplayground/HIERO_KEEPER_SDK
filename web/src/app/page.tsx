"use client";

import { useEffect, useState, useCallback } from "react";

interface NetworkInfo {
  network: string;
  operatorId: string;
  topicId: string;
  latestBlock: { number: number; timestamp: string } | null;
  hashscanBase: string;
  status: string;
  timestamp: string;
}

interface AccountInfo {
  account: string;
  balanceHbar: number;
  balanceTinybar: number;
  tokens: Array<{ token_id: string; balance: number }>;
  hashscanUrl: string;
  timestamp: string;
}

interface TopicInfo {
  topicId: string;
  messageCount: number;
  messages: Array<{
    sequenceNumber: number;
    timestamp: string;
    message: string;
    payerAccountId: string;
  }>;
  hashscanUrl: string;
  timestamp: string;
}

interface TransactionInfo {
  accountId: string;
  transactionCount: number;
  transactions: Array<{
    transactionId: string;
    timestamp: string;
    result: string;
    type: string;
    hashscanUrl: string;
    transfers: Array<{ account: string; amount: number }>;
  }>;
  timestamp: string;
}

function formatTimestamp(ts: string): string {
  if (ts.includes(".")) {
    const secs = parseFloat(ts);
    return new Date(secs * 1000).toLocaleString();
  }
  return new Date(ts).toLocaleString();
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#22c55e" : "#ef4444",
        marginRight: 6,
      }}
    />
  );
}

export default function Dashboard() {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [topic, setTopic] = useState<TopicInfo | null>(null);
  const [transactions, setTransactions] = useState<TransactionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [netRes, accRes, topRes, txRes] = await Promise.allSettled([
        fetch("/api/network").then((r) => r.json()),
        fetch("/api/account").then((r) => r.json()),
        fetch("/api/topic").then((r) => r.json()),
        fetch("/api/transactions").then((r) => r.json()),
      ]);
      if (netRes.status === "fulfilled") setNetwork(netRes.value);
      if (accRes.status === "fulfilled" && !accRes.value.error) setAccount(accRes.value);
      if (topRes.status === "fulfilled" && !topRes.value.error) setTopic(topRes.value);
      if (txRes.status === "fulfilled" && !txRes.value.error) setTransactions(txRes.value);
      setLastRefresh(new Date().toLocaleTimeString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const cardStyle: React.CSSProperties = {
    background: "#141414",
    border: "1px solid #262626",
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
  };

  const labelStyle: React.CSSProperties = {
    color: "#737373",
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 600,
    color: "#fafafa",
  };

  const linkStyle: React.CSSProperties = {
    color: "#3b82f6",
    textDecoration: "none",
    fontSize: 13,
  };

  const badgeStyle = (color: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: color === "green" ? "#052e16" : color === "red" ? "#450a0a" : "#1c1917",
    color: color === "green" ? "#4ade80" : color === "red" ? "#f87171" : "#a8a29e",
    border: `1px solid ${color === "green" ? "#166534" : color === "red" ? "#991b1b" : "#44403c"}`,
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: "#fafafa" }}>@hiero/keeper</h1>
          <p style={{ margin: "4px 0 0", color: "#737373", fontSize: 14 }}>
            SDK Dashboard — Live Hedera Testnet
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <button
            onClick={fetchAll}
            disabled={loading}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              cursor: loading ? "wait" : "pointer",
              fontSize: 14,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {lastRefresh && (
            <p style={{ margin: "6px 0 0", color: "#525252", fontSize: 12 }}>
              Last: {lastRefresh} · Auto-refresh 15s
            </p>
          )}
        </div>
      </div>

      {/* Network Status */}
      <div style={cardStyle}>
        <div style={labelStyle}>Network Status</div>
        {network ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginTop: 12 }}>
            <div>
              <div style={labelStyle}>Network</div>
              <div style={valueStyle}>
                <StatusDot ok={network.status === "connected"} />
                {network.network}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Operator Account</div>
              <div style={{ ...valueStyle, fontSize: 16 }}>{network.operatorId}</div>
              <a href={`${network.hashscanBase}/account/${network.operatorId}`} target="_blank" rel="noopener" style={linkStyle}>
                View on HashScan ↗
              </a>
            </div>
            <div>
              <div style={labelStyle}>HCS Topic</div>
              <div style={{ ...valueStyle, fontSize: 16 }}>{network.topicId || "—"}</div>
              {network.topicId && (
                <a href={`${network.hashscanBase}/topic/${network.topicId}`} target="_blank" rel="noopener" style={linkStyle}>
                  View on HashScan ↗
                </a>
              )}
            </div>
            <div>
              <div style={labelStyle}>Latest Block</div>
              <div style={{ ...valueStyle, fontSize: 16 }}>
                #{network.latestBlock?.number?.toLocaleString() ?? "—"}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: "#525252" }}>Loading...</p>
        )}
      </div>

      {/* Account Balance */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Account Balance</div>
          {account ? (
            <>
              <div style={{ ...valueStyle, fontSize: 32, marginTop: 8 }}>
                {account.balanceHbar.toFixed(4)} <span style={{ fontSize: 16, color: "#737373" }}>ℏ</span>
              </div>
              <p style={{ color: "#525252", fontSize: 12, margin: "4px 0 8px" }}>
                {account.balanceTinybar.toLocaleString()} tinybar
              </p>
              {account.tokens.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>Token Associations</div>
                  {account.tokens.map((t) => (
                    <div key={t.token_id} style={{ fontSize: 13, color: "#a3a3a3", marginBottom: 2 }}>
                      {t.token_id}: {t.balance}
                    </div>
                  ))}
                </div>
              )}
              <a href={account.hashscanUrl} target="_blank" rel="noopener" style={linkStyle}>
                Verify on HashScan ↗
              </a>
            </>
          ) : (
            <p style={{ color: "#525252" }}>Loading...</p>
          )}
        </div>

        {/* Topic Messages */}
        <div style={cardStyle}>
          <div style={labelStyle}>HCS Topic Messages</div>
          {topic ? (
            <>
              <div style={{ ...valueStyle, fontSize: 32, marginTop: 8 }}>
                {topic.messageCount} <span style={{ fontSize: 16, color: "#737373" }}>messages</span>
              </div>
              <p style={{ color: "#525252", fontSize: 12, margin: "4px 0 8px" }}>
                Topic: {topic.topicId}
              </p>
              <a href={topic.hashscanUrl} target="_blank" rel="noopener" style={linkStyle}>
                Verify on HashScan ↗
              </a>
            </>
          ) : (
            <p style={{ color: "#525252" }}>Loading...</p>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={labelStyle}>Recent Transactions</div>
          {transactions && (
            <span style={{ color: "#525252", fontSize: 12 }}>{transactions.transactionCount} shown</span>
          )}
        </div>
        {transactions && transactions.transactions.length > 0 ? (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #262626" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#737373", fontWeight: 500 }}>Type</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#737373", fontWeight: 500 }}>Result</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#737373", fontWeight: 500 }}>Timestamp</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#737373", fontWeight: 500 }}>HashScan</th>
                </tr>
              </thead>
              <tbody>
                {transactions.transactions.map((tx, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <td style={{ padding: "8px 12px", color: "#d4d4d4" }}>{tx.type}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={badgeStyle(tx.result === "SUCCESS" ? "green" : "red")}>
                        {tx.result}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#a3a3a3" }}>{formatTimestamp(tx.timestamp)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <a href={tx.hashscanUrl} target="_blank" rel="noopener" style={linkStyle}>
                        View ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "#525252", marginTop: 12 }}>
            {transactions ? "No transactions found" : "Loading..."}
          </p>
        )}
      </div>

      {/* Topic Messages List */}
      {topic && topic.messages.length > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>HCS Message History</div>
          <div style={{ marginTop: 12, maxHeight: 400, overflowY: "auto" }}>
            {topic.messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid #1a1a1a",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <span style={{ color: "#3b82f6", fontWeight: 600, fontSize: 12, marginRight: 8 }}>
                    #{msg.sequenceNumber}
                  </span>
                  <span style={{ color: "#d4d4d4", fontSize: 13 }}>
                    {msg.message.length > 120 ? msg.message.slice(0, 120) + "…" : msg.message}
                  </span>
                </div>
                <span style={{ color: "#525252", fontSize: 11, whiteSpace: "nowrap", marginLeft: 12 }}>
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", marginTop: 32, color: "#525252", fontSize: 12 }}>
        <p>
          Powered by{" "}
          <a href="https://github.com/abdulsamadplayground/HIERO_KEEPER_SDK" target="_blank" rel="noopener" style={linkStyle}>
            @hiero/keeper SDK
          </a>
          {" · "}
          <a href="https://hashscan.io/testnet" target="_blank" rel="noopener" style={linkStyle}>
            HashScan Testnet
          </a>
          {" · "}
          <a href="https://docs.hedera.com/hedera" target="_blank" rel="noopener" style={linkStyle}>
            Hedera Docs
          </a>
        </p>
      </div>
    </div>
  );
}
