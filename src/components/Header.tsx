"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import WalletButton from "@/components/WalletButton";
import { getConnectedWallet, subscribeConnectedWallet } from "@/lib/wallet-store";

const PUBLIC_LINKS = [
  { label: "Marketplace", href: "/" },
  { label: "Agent Advantage", href: "/agent-advantage" },
  { label: "PancakeSwap", href: "/defi/pancakeswap" },
];

/**
 * Account pages, hidden until a wallet is connected. Both are empty without one,
 * and the main track is judged on a first-time visitor never hitting a dead end.
 */
const WALLET_LINKS = [
  { label: "Jobs", href: "/jobs" },
  { label: "Permissions", href: "/sessions" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const connected = useSyncExternalStore(
    subscribeConnectedWallet,
    () => getConnectedWallet() !== null,
    () => false
  );

  // Marketplace first, then the account pages, so the wallet-gated items sit
  // next to the wallet button rather than interrupting discovery.
  const navLinks = connected
    ? [PUBLIC_LINKS[0], ...WALLET_LINKS, ...PUBLIC_LINKS.slice(1)]
    : PUBLIC_LINKS;

  return (
    <header
      className={`absolute left-0 right-0 top-0 z-50 ${
        menuOpen ? "bg-black/95 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      {/* Three columns, not flex + justify-between. With three flex children the
          nav lands wherever the gap between the logo and the wallet button leaves
          it, and those two are nowhere near the same width — so the links sat off
          to one side. Equal 1fr rails on the outside centre the middle column
          against the page, not against its neighbours.
          Every child pins its own column. `hidden` is `display:none`, which
          generates no box at all, so on mobile the nav does not hold its cell
          open — auto-placement then slid the actions into the middle column and
          the menu button appeared near the centre. */}
      <div className="mx-auto grid h-[72px] max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-8 lg:px-12">
        <Link href="/" className="col-start-1 flex items-center gap-1.5 justify-self-start" aria-label="Deck home">
          <Image src="/deck-logo.png" alt="Deck" width={25} height={25} priority className="h-[25px] w-[25px] object-contain" />
          <span className="text-[19px] font-medium text-[#f5f5f5]">Deck</span>
        </Link>

        <nav className="col-start-2 hidden items-center gap-9 justify-self-center md:flex">
          {navLinks.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap text-[13px] font-semibold transition-colors ${active ? "text-[#f5f5f5]" : "text-[#999] hover:text-[#f5f5f5]"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="col-start-3 flex items-center gap-3 justify-self-end">
          <WalletButton />

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="-mr-2 flex h-10 w-10 items-center justify-center text-[#d3d3d3] transition-colors hover:text-white md:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="8" x2="21" y2="8" />
                  <line x1="3" y1="16" x2="21" y2="16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-[#1c1c1c] bg-[#0a0a0a] px-5 py-5 md:hidden">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`text-[13px] font-semibold transition-colors ${active ? "text-white" : "text-[#999] hover:text-white"}`}
                >
                  {link.label}
                </Link>
              );
            })}
            <WalletButton mobile />
          </nav>
        </div>
      )}
    </header>
  );
}
