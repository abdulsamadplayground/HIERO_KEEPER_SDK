import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "@hiero/keeper — SDK Dashboard",
  description:
    "Live dashboard for the Hiero Keeper SDK — scheduled transactions, HCS topics, mirror node queries on Hedera testnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
        {children}
      </body>
    </html>
  );
}
