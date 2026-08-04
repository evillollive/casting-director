import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceNav } from "./workspace-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <header className="site-header">
        <div className="header-inner">
          <Link className="wordmark" href="/">
            <span className="wordmark-mark" aria-hidden="true">
              C
            </span>
            <span>casting-director</span>
          </Link>
          <div className="workspace-chip">
            <span className="presence-dot" aria-hidden="true" />
            Casting workspace
          </div>
        </div>
        <WorkspaceNav />
      </header>
      <main className="page-shell">{children}</main>
    </div>
  );
}
