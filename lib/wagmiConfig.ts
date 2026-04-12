import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia, hardhat } from "wagmi/chains";
import { http } from "wagmi";

const sepoliaTransport = process.env.NEXT_PUBLIC_RPC_URL_TESTNET
  ? http(process.env.NEXT_PUBLIC_RPC_URL_TESTNET)
  : http();

export const config = getDefaultConfig({
  appName: "Gorilla Credit Engine",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!,
  chains: [mainnet, sepolia, hardhat],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: sepoliaTransport,
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});
