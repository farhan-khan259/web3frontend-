"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { formatEther, parseAbi, type Address } from "viem";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { ADDRESSES } from "../../../lib/contracts";

type TokenSnapshot = {
  tokenId: number;
  floorWei: bigint;
  debtWei: bigint;
  inPanic: boolean;
};

const vaultReadAbi = parseAbi([
  "function getLockedTokens(address owner) view returns (uint256[])",
  "function getLockedRightsByWallet(address owner) view returns (uint256[])",
]);

const oracleReadAbi = parseAbi(["function getFloorPrice(uint256 tokenId) view returns (uint256)"]);
const loanGetLoanAbi = parseAbi(["function getLoan(uint256 tokenId) view returns (uint256 debtAmount, bool inPanic)"]);
const loanPositionsAbi = parseAbi([
  "function positions(uint256 tokenId) view returns (uint256 debt, bool inPanic, bool liquidated)",
]);

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function parseGetLoanResult(result: unknown): { debtWei: bigint; inPanic: boolean } | null {
  if (!result) return null;

  if (Array.isArray(result)) {
    const [debt, inPanic] = result as unknown[];
    return {
      debtWei: typeof debt === "bigint" ? debt : 0n,
      inPanic: Boolean(inPanic),
    };
  }

  if (typeof result === "object") {
    const payload = result as Record<string, unknown>;
    const debtRaw = payload.debtAmount ?? payload.debt ?? payload.outstandingDebt;
    const inPanicRaw = payload.inPanic ?? payload.panic ?? false;
    return {
      debtWei: typeof debtRaw === "bigint" ? debtRaw : 0n,
      inPanic: Boolean(inPanicRaw),
    };
  }

  return null;
}

function LockedTokenWatcher({
  tokenId,
  refreshKey,
  enabled,
  onSnapshot,
}: {
  tokenId: number;
  refreshKey: number;
  enabled: boolean;
  onSnapshot: (snapshot: TokenSnapshot) => void;
}) {
  const floorQuery = useReadContract({
    address: ADDRESSES.oracle as Address,
    abi: oracleReadAbi,
    functionName: "getFloorPrice",
    args: [BigInt(tokenId)],
    query: { enabled: enabled && Boolean(ADDRESSES.oracle) },
    scopeKey: `dashboard-floor-${refreshKey}`,
  });

  const loanQuery = useReadContract({
    address: ADDRESSES.loan as Address,
    abi: loanGetLoanAbi,
    functionName: "getLoan",
    args: [BigInt(tokenId)],
    query: { enabled: enabled && Boolean(ADDRESSES.loan) },
    scopeKey: `dashboard-loan-${refreshKey}`,
  });

  const fallbackLoanQuery = useReadContract({
    address: ADDRESSES.loan as Address,
    abi: loanPositionsAbi,
    functionName: "positions",
    args: [BigInt(tokenId)],
    query: { enabled: enabled && Boolean(ADDRESSES.loan) && Boolean(loanQuery.error) },
    scopeKey: `dashboard-loan-fallback-${refreshKey}`,
  });

  useEffect(() => {
    const floorWei = (floorQuery.data as bigint | undefined) ?? 0n;

    const primary = parseGetLoanResult(loanQuery.data);
    if (primary) {
      onSnapshot({
        tokenId,
        floorWei,
        debtWei: primary.debtWei,
        inPanic: primary.inPanic,
      });
      return;
    }

    if (Array.isArray(fallbackLoanQuery.data)) {
      const [debtRaw, inPanicRaw] = fallbackLoanQuery.data as unknown[];
      onSnapshot({
        tokenId,
        floorWei,
        debtWei: typeof debtRaw === "bigint" ? debtRaw : 0n,
        inPanic: Boolean(inPanicRaw),
      });
      return;
    }

    onSnapshot({ tokenId, floorWei, debtWei: 0n, inPanic: false });
  }, [tokenId, floorQuery.data, loanQuery.data, loanQuery.error, fallbackLoanQuery.data, onSnapshot]);

  return null;
}

export default function UserDashboardPage() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();

  const [refreshKey, setRefreshKey] = useState(0);
  const [tokenSnapshots, setTokenSnapshots] = useState<Record<number, TokenSnapshot>>({});

  const lockedTokensPrimary = useReadContract({
    address: ADDRESSES.vault as Address,
    abi: vaultReadAbi,
    functionName: "getLockedTokens",
    args: [address as Address],
    query: { enabled: Boolean(isConnected && address && ADDRESSES.vault) },
    scopeKey: `dashboard-locked-primary-${refreshKey}`,
  });

  const lockedTokensFallback = useReadContract({
    address: ADDRESSES.vault as Address,
    abi: vaultReadAbi,
    functionName: "getLockedRightsByWallet",
    args: [address as Address],
    query: {
      enabled:
        Boolean(isConnected && address && ADDRESSES.vault) &&
        (Boolean(lockedTokensPrimary.error) || !lockedTokensPrimary.data),
    },
    scopeKey: `dashboard-locked-fallback-${refreshKey}`,
  });

  const lockedTokenIds = useMemo(() => {
    const source = (lockedTokensPrimary.data || lockedTokensFallback.data || []) as bigint[];
    return source.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0);
  }, [lockedTokensPrimary.data, lockedTokensFallback.data]);

  useEffect(() => {
    setTokenSnapshots({});
  }, [address, chainId, refreshKey, lockedTokenIds.length]);

  const snapshots = useMemo(() => {
    return lockedTokenIds
      .map((id) => tokenSnapshots[id])
      .filter((row): row is TokenSnapshot => Boolean(row));
  }, [lockedTokenIds, tokenSnapshots]);

  const totalCollateralWei = useMemo(() => snapshots.reduce((sum, row) => sum + row.floorWei, 0n), [snapshots]);
  const totalDebtWei = useMemo(() => snapshots.reduce((sum, row) => sum + row.debtWei, 0n), [snapshots]);
  const availableBorrowingWei = useMemo(
    () => (totalCollateralWei * 7000n) / 10000n - totalDebtWei,
    [totalCollateralWei, totalDebtWei]
  );

  const loadingLocked = lockedTokensPrimary.isLoading || lockedTokensFallback.isLoading;
  const watchingInProgress = lockedTokenIds.length > snapshots.length;
  const loading = loadingLocked || watchingInProgress;

  const error = useMemo(() => {
    if (!ADDRESSES.vault || !ADDRESSES.oracle || !ADDRESSES.loan) {
      return "Missing vault/oracle/loan address for active network mode.";
    }
    return (
      (lockedTokensPrimary.error as Error | undefined)?.message ||
      (lockedTokensFallback.error as Error | undefined)?.message ||
      ""
    );
  }, [lockedTokensPrimary.error, lockedTokensFallback.error]);

  const rows = useMemo(() => {
    return snapshots.map((row) => {
      const floorEth = Number(formatEther(row.floorWei));
      const debtEth = Number(formatEther(row.debtWei));
      const ltvPct = floorEth > 0 ? (debtEth / floorEth) * 100 : 0;
      return {
        tokenId: row.tokenId,
        floorEth,
        debtEth,
        ltvPct,
        inPanic: row.inPanic,
      };
    });
  }, [snapshots]);

  function onRefresh() {
    setRefreshKey((value) => value + 1);
  }

  function onSnapshotUpdate(snapshot: TokenSnapshot) {
    setTokenSnapshots((prev) => {
      const current = prev[snapshot.tokenId];
      if (
        current &&
        current.floorWei === snapshot.floorWei &&
        current.debtWei === snapshot.debtWei &&
        current.inPanic === snapshot.inPanic
      ) {
        return prev;
      }
      return { ...prev, [snapshot.tokenId]: snapshot };
    });
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to view on-chain dashboard data.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">User Dashboard</h1>
          <p className="mt-1 text-sm opacity-80">Connected Wallet: {address}</p>
          <p className="text-sm opacity-80">Network Chain ID: {chainId || "N/A"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/nft-gallery")}>NFT Gallery</Button>
          <Button variant="secondary" onClick={() => router.push("/borrow")}>Borrow</Button>
          <Button variant="outline" onClick={() => router.push("/repay")}>Repay</Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Collateral Value"
              value={`${Number(formatEther(totalCollateralWei)).toFixed(4)} ETH`}
              hint="Sum of oracle floor prices for locked NFTs"
            />
            <MetricCard
              title="Total Debt"
              value={`${Number(formatEther(totalDebtWei)).toFixed(4)} ETH`}
              hint="Sum of loan debt across locked NFTs"
            />
            <MetricCard
              title="Available Borrowing Power"
              value={`${Number(formatEther(availableBorrowingWei > 0n ? availableBorrowingWei : 0n)).toFixed(4)} ETH`}
              hint="70% collateral value minus total debt"
            />
          </>
        )}
      </div>

      {lockedTokenIds.length === 0 && !loading ? (
        <Card>
          <CardContent className="pt-6 text-sm opacity-80">
            No locked NFTs. Go to NFT Gallery to lock your tokens.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Locked NFT Overview</CardTitle>
          <CardDescription>Live on-chain floor value and debt from Sepolia contracts.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Oracle Value</TableHead>
                  <TableHead>Debt</TableHead>
                  <TableHead>LTV</TableHead>
                  <TableHead>Panic Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.tokenId}>
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.floorEth.toFixed(4)} ETH</TableCell>
                    <TableCell>{row.debtEth.toFixed(4)} ETH</TableCell>
                    <TableCell>{row.ltvPct.toFixed(2)}%</TableCell>
                    <TableCell>
                      {row.inPanic ? <Badge variant="danger">PANIC</Badge> : <Badge variant="success">OK</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No data yet.</p>
          )}
        </CardContent>
      </Card>

      {lockedTokenIds.map((tokenId) => (
        <LockedTokenWatcher
          key={`${tokenId}-${refreshKey}-${address}-${chainId}`}
          tokenId={tokenId}
          refreshKey={refreshKey}
          enabled={Boolean(isConnected && ADDRESSES.oracle && ADDRESSES.loan)}
          onSnapshot={onSnapshotUpdate}
        />
      ))}
    </section>
  );
}
