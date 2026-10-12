"use client";
import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const sync = () =>
      setTheme(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme,
          accentColor: "#87290f",
          logo: "/logo.svg",
          showWalletLoginFirst: false,
        },
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
