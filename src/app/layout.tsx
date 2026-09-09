import type { Metadata } from "next";
import { Source_Code_Pro } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Deck · BNB Agent Marketplace",
  description: "Discover, compare, and hire AI agents on BNB Smart Chain",
  icons: {
    icon: "/deck-logo.png",
  },
  openGraph: {
    title: "Deck · BNB Agent Marketplace",
    description: "Discover, compare, and hire AI agents on BNB Smart Chain",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Deck · BNB Agent Marketplace",
    description: "Discover, compare, and hire AI agents on BNB Smart Chain",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sourceCodePro.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-black text-white font-sans" style={{ paddingTop: "var(--deck-header-height,72px)" }}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
