import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Sortition | A fair hearing for every question",
    template: "%s | Sortition",
  },
  description:
    "Lock the question. Lock the evidence. Let a random jury resolve it. Sortition is an independent resolution service built on GenLayer.",
  icons: { icon: "/logo.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('sortition-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}",
          }}
        />
      </head>
      <body>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <div className="site-shell">
            <Header />
            <main id="main">{children}</main>
            <footer className="footer">
              <span>
                <ShieldCheck size={15} /> Independent by design. Public by
                default.
              </span>
              <div>
                <Link href="/integrate">Developer notes</Link>
                <a
                  href="https://studio.genlayer.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  GenLayer Studio
                </a>
                <a
                  href="https://github.com/dotmantissa/sortition"
                  target="_blank"
                  rel="noreferrer"
                >
                  Source code
                </a>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
