import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia, hardhat } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Gorilla Credit Engine",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!,
  chains: [mainnet, sepolia, hardhat],
  ssr: true,
});
