"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther, parseEther, type Address } from "viem";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { ADDRESSES, vaultAbi } from "../../../lib/contracts";

type GalleryItem = {
  tokenId: number;
  imageUrl: string;
};

const CLIENT_TOKEN_IDS = [640, 636, 810, 841, 1642, 1684, 7235, 7485, 7951, 8949, 9246, 9332];
const MAINNET_COLLECTION = "0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4";
const PLACEHOLDER_IMAGE = "https://placehold.co/640x640/0f172a/e2e8f0?text=Gorilla+NFT";

const erc721OwnerAbi = ["function ownerOf(uint256 tokenId) view returns (address)"] as const;
const mockOracleAbi = ["function getFloorPrice(uint256 tokenId) view returns (uint256)"] as const;

function normalizeTokenId(raw: any): number {
  const tokenIdRaw = raw?.tokenId ?? raw?.id?.tokenId ?? 0;
  if (typeof tokenIdRaw === "string" && tokenIdRaw.startsWith("0x")) {
    return parseInt(tokenIdRaw, 16);
  }
  return Number(tokenIdRaw) || 0;
}

function resolveImageUrl(raw: any): string {
  return (
    raw?.image?.cachedUrl ||
    raw?.image?.thumbnailUrl ||
    raw?.image?.pngUrl ||
    raw?.image?.originalUrl ||
    raw?.rawMetadata?.image ||
    PLACEHOLDER_IMAGE
  );
}

function NftCard({
  tokenId,
  imageUrl,
  nftAddress,
  oracleAddress,
  expectedOwner,
  canReadOwner,
  isDemoMode,
  onLocked,
}: {
  tokenId: number;
  imageUrl: string;
  nftAddress: string;
  oracleAddress: string;
  expectedOwner: string;
  canReadOwner: boolean;
  isDemoMode: boolean;
  onLocked: (tokenId: number) => Promise<void>;
}) {
  const [lockError, setLockError] = useState("");
  const [locking, setLocking] = useState(false);

  const ownerQuery = useReadContract({
    address: nftAddress as Address,
    abi: erc721OwnerAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
    query: { enabled: canReadOwner && Boolean(nftAddress) },
  });

  const oracleQuery = useReadContract({
    address: oracleAddress as Address,
    abi: mockOracleAbi,
    functionName: "getFloorPrice",
    args: [BigInt(tokenId)],
    query: { enabled: Boolean(oracleAddress) },
  });

  const owner = String(ownerQuery.data || "");
  const expectedOwnerLc = expectedOwner.toLowerCase();
  const isOwnedByClient = !canReadOwner || (owner && owner.toLowerCase() === expectedOwnerLc);

  const floorWei = (oracleQuery.data as bigint | undefined) ?? 0n;
  const floorEth = Number(formatEther(floorWei));
  const ltvEth = Number(formatEther((floorWei * 7000n) / 10000n));

  async function handleLock() {
    setLockError("");
    setLocking(true);
    try {
      await onLocked(tokenId);
    } catch (err) {
      setLockError((err as Error).message || "Lock failed");
    } finally {
      setLocking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Token #{tokenId}</CardTitle>
        <CardDescription>
          {isDemoMode ? "Demo token card" : "Live token metadata"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <img src={imageUrl} alt={`Token ${tokenId}`} className="h-44 w-full rounded-md border object-cover" />

        {ownerQuery.isLoading || oracleQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-1 text-sm">
            <div>Oracle value: {floorEth.toFixed(4)} ETH</div>
            <div>LTV (70%): {ltvEth.toFixed(4)} ETH</div>
            <div className="flex items-center gap-2">
              <span>Owner:</span>
              <Badge variant={isOwnedByClient ? "success" : "secondary"}>
                {isOwnedByClient ? "Client" : "Other"}
              </Badge>
            </div>
          </div>
        )}

        {lockError ? <p className="text-xs text-rose-300">{lockError}</p> : null}

        <Button
          className="w-full"
          onClick={handleLock}
          disabled={locking || ownerQuery.isLoading || oracleQuery.isLoading || !isOwnedByClient}
        >
          {locking ? "Locking..." : "Lock"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function NftGalleryPage() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const networkMode = String(process.env.NEXT_PUBLIC_NETWORK_MODE || "local").toLowerCase();
  const isTestnet = networkMode === "testnet";

  const collectionAddress = process.env.NEXT_PUBLIC_MOCK_NFT_ADDRESS_TESTNET || process.env.NEXT_PUBLIC_COLLECTION_ADDRESS;
  const fallbackMainnetCollection = process.env.NEXT_PUBLIC_COLLECTION_ADDRESS || MAINNET_COLLECTION;

  const nftContractAddress = isTestnet
    ? collectionAddress
    : fallbackMainnetCollection;

  const oracleAddress = ADDRESSES.oracle;
  const readWallet = String(address || process.env.NEXT_PUBLIC_ADMIN_WALLET || "");

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadMainnetFromAlchemy() {
      const alchemyApiKey = String(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "").trim();
      if (!alchemyApiKey) {
        throw new Error("NEXT_PUBLIC_ALCHEMY_API_KEY is missing");
      }
      if (!readWallet) {
        throw new Error("Wallet address unavailable");
      }

      const url =
        `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}/getNFTsForOwner` +
        `?owner=${readWallet}&contractAddresses[]=${fallbackMainnetCollection}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Alchemy request failed (${res.status})`);
      }

      const json = await res.json();
      const ownedNfts = Array.isArray(json?.ownedNfts) ? json.ownedNfts : [];
      return ownedNfts
        .map((nft: any) => ({
          tokenId: normalizeTokenId(nft),
          imageUrl: resolveImageUrl(nft),
        }))
        .filter((item: GalleryItem) => Number.isFinite(item.tokenId) && item.tokenId > 0);
    }

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (isTestnet) {
          if (!mounted) return;
          setDemoMode(true);
          setItems(CLIENT_TOKEN_IDS.map((tokenId) => ({ tokenId, imageUrl: PLACEHOLDER_IMAGE })));
          return;
        }

        const fetched = await loadMainnetFromAlchemy();
        if (!mounted) return;
        setDemoMode(false);
        setItems(fetched);
      } catch (err) {
        if (!mounted) return;
        setDemoMode(true);
        setItems(CLIENT_TOKEN_IDS.map((tokenId) => ({ tokenId, imageUrl: PLACEHOLDER_IMAGE })));
        setError((err as Error).message || "Failed to fetch NFTs from Alchemy. Using fallback demo list.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [isTestnet, readWallet, fallbackMainnetCollection]);

  async function lockInVault(tokenId: number) {
    if (!address) {
      throw new Error("Connect your wallet to lock NFTs.");
    }
    if (!ADDRESSES.vault) {
      throw new Error("Vault address missing for active network.");
    }

    await writeContractAsync({
      abi: vaultAbi,
      address: ADDRESSES.vault as Address,
      functionName: "lockMintingRights",
      args: [BigInt(tokenId), 0n, address as Address, true],
    } as never);
  }

  if (!readWallet) {
    return (
      <section className="mx-auto max-w-7xl p-6">
        <h1 className="text-3xl font-semibold">NFT Gallery</h1>
        <p className="mt-2 text-sm text-rose-300">Wallet unavailable. Connect wallet or set NEXT_PUBLIC_ADMIN_WALLET.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">NFT Gallery</h1>
        <p className="mt-1 text-sm opacity-80">Contract: {nftContractAddress || "N/A"}</p>
      </div>

      {(demoMode || isTestnet) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Demo mode - showing client&apos;s token IDs with oracle values from Sepolia contract.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, idx) => (
            <Skeleton key={idx} className="h-80 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <NftCard
              key={item.tokenId}
              tokenId={item.tokenId}
              imageUrl={item.imageUrl}
              nftAddress={String(nftContractAddress || "")}
              oracleAddress={String(oracleAddress || "")}
              expectedOwner={readWallet}
              canReadOwner={isTestnet}
              isDemoMode={demoMode || isTestnet}
              onLocked={lockInVault}
            />
          ))}
        </div>
      )}
    </section>
  );
}
