"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Navbar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  // Hide navbar on editor pages (editor has its own toolbar)
  const isEditorPage = pathname.includes("/editor");
  // Hide on public review pages
  const isReviewPage = pathname.startsWith("/review/");

  if (isEditorPage || isReviewPage) return null;

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-logo">
          <img src="/logo.svg" alt="Nexoos Website Reviewer" className="navbar-logo-img" />
        </Link>
        <div className="navbar-right">
          <Link href="/account" className="navbar-avatar" title="My Account">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
          <button onClick={logout} className="navbar-logout" title="Sign Out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
