"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Shortlist", shortLabel: "S" },
  { href: "/scans", label: "Scans", shortLabel: "R" },
  { href: "/rolodex", label: "Rolodex", shortLabel: "C" },
  { href: "/tuning", label: "Tuning", shortLabel: "T" },
  { href: "/taste-log", label: "Taste log", shortLabel: "L" },
] as const;

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      <div className="nav-inner">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className="nav-item"
              href={item.href}
              key={item.href}
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.shortLabel}
              </span>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
