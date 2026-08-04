import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import type { PageAccess } from "@/server/auth/page-auth";

export function AccessState({ access }: { access: Exclude<PageAccess, { state: "authenticated" }> }) {
  if (access.state === "setup") {
    return (
      <SetupNotice
        items={access.missing.map((label) => ({
          label,
          configured: false,
          hint: "Required for the authenticated Tier 2 application",
        }))}
      />
    );
  }
  return (
    <section className="notice notice-warning" role="status">
      <span className="notice-icon" aria-hidden="true">!</span>
      <div>
        <h2>Sign in required</h2>
        <p>This workspace never assumes a fallback identity.</p>
        <Link className="secondary-button" href="/sign-in">Enter a provisioned session token</Link>
      </div>
    </section>
  );
}
