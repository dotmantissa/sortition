"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Sun, Moon, LogIn, LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
export function Header() {
  const path = usePathname();
  const { login, logout, authenticated, ready, user } = usePrivy();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(
    () => setDark(document.documentElement.dataset.theme === "dark"),
    [],
  );
  function toggle() {
    const d = !dark;
    setDark(d);
    document.documentElement.dataset.theme = d ? "dark" : "light";
    localStorage.setItem("sortition-theme", d ? "dark" : "light");
  }
  return (
    <header className="masthead">
      <Link href="/" className="brand" aria-label="Sortition home">
        <Image src="/logo.svg" width={38} height={38} alt="" />
        <span>
          sortition<span className="brand-period">.</span>
        </span>
      </Link>
      <button
        className="icon-button mobile-menu"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav
        className={open ? "navigation open" : "navigation"}
        aria-label="Main navigation"
      >
        {[
          ["/", "The docket"],
          ["/console", "Operator console"],
          ["/integrate", "Integrate"],
        ].map(([href, label]) => (
          <Link
            onClick={() => setOpen(false)}
            href={href}
            key={href}
            className={path === href ? "active" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <button
          className="icon-button"
          onClick={toggle}
          aria-label={dark ? "Use light mode" : "Use dark mode"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="login-button"
          disabled={!ready}
          onClick={() => (authenticated ? logout() : login())}
        >
          {authenticated ? <LogOut size={16} /> : <LogIn size={16} />}
          <span>
            {authenticated
              ? user?.email?.address?.split("@")[0] || "Sign out"
              : "Sign in"}
          </span>
        </button>
      </div>
    </header>
  );
}
