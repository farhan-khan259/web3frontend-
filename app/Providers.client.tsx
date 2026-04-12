"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "../lib/wagmiConfig";

export default function Providers({ children }: { children: ReactNode }) {
    // Only render on client
    if (typeof window === "undefined") return null;

    const [queryClient] = useState(() => new QueryClient());

    useEffect(() => {
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = String(event.reason ?? "");
            if (reason.includes("Failed to connect to MetaMask")) {
                event.preventDefault();
            }
        };
        window.addEventListener("unhandledrejection", handleUnhandledRejection);
        return () => {
            window.removeEventListener("unhandledrejection", handleUnhandledRejection);
        };
    }, []);

    // Runtime check for WalletConnect projectId
    if (!process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID) {
        if (typeof window !== "undefined") {
            console.warn("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is missing");
        }
        return (
            <div style={{color: 'red', padding: 16}}>
                WalletConnect Project ID missing. Please set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID in your environment variables.
            </div>
        );
    }

    return (
        <WagmiProvider config={config} reconnectOnMount={false}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
