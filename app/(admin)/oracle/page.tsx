"use client";

import { useMemo, useState } from "react";
import { formatEther, parseAbi, parseEther, type Address } from "viem";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ADDRESSES } from "../../../lib/contracts";

const ADMIN_WALLET = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf".toLowerCase();
const CLIENT_TOKEN_IDS = [640, 636, 810, 841, 1642, 1684, 7235, 7485, 7951, 8949, 9246, 9332];

const oracleAbi = parseAbi([
  "function setFloorPrice(uint256 tokenId, uint256 price)",
  "function getFloorPrice(uint256 tokenId) view returns (uint256)",
]);

function formatEth(value: bigint): string {
  return Number(formatEther(value)).toFixed(4);
}

export default function AdminOraclePage() {
  const { address, isConnected } = useAccount();
  const { writeContract, data: txHash, isPending: isSubmitting, error: writeError } = useWriteContract();

  const [tokenIdInput, setTokenIdInput] = useState("640");
  const [floorEthInput, setFloorEthInput] = useState("10");
  const [formError, setFormError] = useState("");

  const oracleAddress = ADDRESSES.oracle;
  const normalizedAddress = String(address || "").toLowerCase();
  const isAdminWallet = Boolean(isConnected && normalizedAddress === ADMIN_WALLET);

  const floorReads = useReadContracts({
    contracts: CLIENT_TOKEN_IDS.map((tokenId) => ({
      address: oracleAddress as Address,
      abi: oracleAbi,
      functionName: "getFloorPrice",
      args: [BigInt(tokenId)],
    })),
    query: {
      enabled: Boolean(isAdminWallet && oracleAddress),
    },
  });

  const txReceipt = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const rows = useMemo(() => {
    return CLIENT_TOKEN_IDS.map((tokenId, index) => {
      const read = floorReads.data?.[index];
      const wei = read?.status === "success" ? (read.result as bigint) : 0n;
      return {
        tokenId,
        floorWei: wei,
      };
    });
  }, [floorReads.data]);

  function submitUpdate() {
    setFormError("");

    if (!oracleAddress) {
      setFormError("Oracle address missing. Check NEXT_PUBLIC_ORACLE_ADDRESS_TESTNET.");
      return;
    }

    const tokenId = Number(tokenIdInput);
    const floorEth = Number(floorEthInput);

    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      setFormError("Token ID must be a positive number.");
      return;
    }

    if (!Number.isFinite(floorEth) || floorEth <= 0) {
      setFormError("Floor price must be greater than 0 ETH.");
      return;
    }

    writeContract({
      address: oracleAddress as Address,
      abi: oracleAbi,
      functionName: "setFloorPrice",
      args: [BigInt(tokenId), parseEther(String(floorEth))],
    });
  }

  if (!isConnected) {
    return (
      <section className="mx-auto max-w-5xl p-6">
        <h1 className="text-3xl font-semibold">Oracle Admin</h1>
        <p className="mt-2 text-sm opacity-80">Connect wallet to continue.</p>
      </section>
    );
  }

  if (!isAdminWallet) {
    return (
      <section className="mx-auto max-w-5xl p-6">
        <h1 className="text-3xl font-semibold">Oracle Admin</h1>
        <div className="mt-4 rounded-lg border border-rose-400/40 bg-rose-500/10 p-4 text-rose-300">Access denied</div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Oracle Admin</h1>
        <p className="mt-1 text-sm opacity-80">Update floor prices for client tokens (Sepolia).</p>
      </header>

      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Set Floor Price</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block opacity-80">Token ID</span>
            <input
              value={tokenIdInput}
              onChange={(e) => setTokenIdInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block opacity-80">Floor Price (ETH)</span>
            <input
              value={floorEthInput}
              onChange={(e) => setFloorEthInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submitUpdate}
            disabled={isSubmitting}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
          >
            {isSubmitting ? "Submitting..." : "Update Floor Price"}
          </button>
          <button
            onClick={() => floorReads.refetch()}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm"
          >
            Refresh Prices
          </button>
        </div>

        {formError ? <p className="mt-3 text-sm text-rose-300">{formError}</p> : null}
        {writeError ? <p className="mt-3 text-sm text-rose-300">{writeError.message}</p> : null}

        {txHash ? (
          <div className="mt-4 rounded-md border border-slate-700 bg-slate-950 p-3 text-sm">
            <div>Transaction: {txHash}</div>
            <div className="mt-1 opacity-80">
              Status: {txReceipt.isLoading ? "Confirming..." : txReceipt.isSuccess ? "Confirmed" : txReceipt.isError ? "Failed" : "Submitted"}
            </div>
            {txReceipt.data?.blockNumber ? (
              <div className="mt-1 opacity-80">Confirmed in block: {txReceipt.data.blockNumber.toString()}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Client Token Floor Prices</h2>
        <p className="mt-1 text-sm opacity-80">Wallet: 0xc82A...D46cf</p>

        {floorReads.isLoading ? (
          <p className="mt-4 text-sm opacity-80">Loading current floor prices...</p>
        ) : floorReads.isError ? (
          <p className="mt-4 text-sm text-rose-300">Failed to read floor prices: {floorReads.error.message}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left opacity-80">
                  <th className="py-2">Token ID</th>
                  <th className="py-2">Floor (ETH)</th>
                  <th className="py-2">Floor (wei)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tokenId} className="border-b border-slate-800/80">
                    <td className="py-2">#{row.tokenId}</td>
                    <td className="py-2">{formatEth(row.floorWei)}</td>
                    <td className="py-2">{row.floorWei.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
