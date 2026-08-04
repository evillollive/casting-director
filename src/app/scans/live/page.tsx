import { AccessState } from "@/components/access-state";
import { PageHeading } from "@/components/page-heading";
import { LiveScanPanel } from "@/app/scans/live/live-scan-panel";
import { prisma } from "@/server/db";
import { resolvePageAccess } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live scan" };

export default async function LiveScanPage() {
  const access = await resolvePageAccess();
  if (access.state !== "authenticated") {
    return <div className="page-stack"><AccessState access={access} /></div>;
  }
  const [sources, activeScan] = await Promise.all([
    prisma.source.findMany({
      where: { active: true, executable: true },
      orderBy: [{ family: "asc" }, { displayName: "asc" }],
      select: { key: true, displayName: true, family: true },
    }),
    prisma.scan.findFirst({
      where: {
        workspaceId: access.principal.workspaceId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      include: {
        sources: { include: { source: true }, orderBy: { createdAt: "asc" } },
        evaluatorViolations: { orderBy: { createdAt: "asc" } },
        job: true,
      },
    }),
  ]);
  const initialScan = activeScan ? {
    id: activeScan.id,
    status: activeScan.status,
    error: activeScan.error,
    candidatesFetched: activeScan.candidatesFetched,
    candidatesDeduped: activeScan.candidatesDeduped,
    candidatesScreened: activeScan.candidatesScreened,
    shortlistCount: activeScan.shortlistCount,
    parkingCount: activeScan.parkingCount,
    shippable: false,
    diagnosticReportMarkdown: null,
    sourceProgress: activeScan.sources.map((source) => ({
      id: source.id,
      status: source.status,
      fetchedCount: source.fetchedCount,
      errorCode: source.errorCode,
      errorMessage: source.errorMessage,
      source: { key: source.source.key, displayName: source.source.displayName },
    })),
    evaluatorViolations: activeScan.evaluatorViolations.map((violation) => ({
      id: violation.id,
      severity: violation.severity,
      code: violation.code,
      message: violation.message,
    })),
    job: activeScan.job ? {
      attempt: activeScan.job.attempt,
      maxAttempts: activeScan.job.maxAttempts,
      failureCode: activeScan.job.failureCode,
      lastError: activeScan.job.lastError,
    } : null,
  } : null;
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Operations"
        title="Live scan"
        description="Trigger one durable workspace scan and watch source-level progress, retries, counts, and diagnostics."
      />
      {sources.length > 0 ? (
        <LiveScanPanel sources={sources} initialScan={initialScan} />
      ) : (
        <section className="notice notice-warning"><div><h2>No executable sources</h2><p>Seed active executable sources before starting a scan.</p></div></section>
      )}
    </div>
  );
}
