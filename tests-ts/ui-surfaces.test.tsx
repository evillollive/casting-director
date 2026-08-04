import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessState } from "@/components/access-state";
import { LiveScanPanel, type ScanDetail } from "@/app/scans/live/live-scan-panel";
import { RolodexTable } from "@/app/rolodex/rolodex-table";
import { TuningEditor } from "@/app/tuning/tuning-editor";
import { TasteLogEditor } from "@/app/taste-log/taste-log-editor";

describe("authenticated product surfaces", () => {
  it("shows an explicit authorization state instead of a fallback identity", () => {
    const markup = renderToStaticMarkup(
      <AccessState access={{ state: "unauthenticated" }} />,
    );
    expect(markup).toContain("Sign in required");
    expect(markup).toContain("never assumes a fallback identity");
  });

  it("labels failed scan output as diagnostic rather than shippable", () => {
    const failed: ScanDetail = {
      id: "scan-failed",
      status: "FAILED",
      error: "Evaluator rejected the report.",
      candidatesFetched: 4,
      candidatesDeduped: 3,
      candidatesScreened: 3,
      shortlistCount: 1,
      parkingCount: 1,
      shippable: false,
      diagnosticReportMarkdown: "# Partial",
      sourceProgress: [],
      evaluatorViolations: [
        {
          id: "violation-1",
          severity: "ERROR",
          code: "GATE_VIOLATION",
          message: "Visible hook was below 3.",
        },
      ],
      job: {
        attempt: 3,
        maxAttempts: 3,
        failureCode: "EVALUATOR_FAILED",
        lastError: "Evaluator rejected the report.",
      },
    };
    const markup = renderToStaticMarkup(
      <LiveScanPanel sources={[]} initialScan={failed} />,
    );
    expect(markup).toContain("Scan failed — diagnostic only");
    expect(markup).toContain("Partial diagnostic report");
    expect(markup).not.toContain("Completed and evaluator-clean");
  });

  it("renders accessible rolodex bulk actions and expandable provenance", () => {
    const markup = renderToStaticMarkup(
      <RolodexTable
        availableTags={[{ id: "tag-1", name: "Maker" }]}
        items={[
          {
            id: "candidate-1",
            name: "Alex Example",
            handle: "@alex",
            project: "Open tool",
            projectUrl: null,
            region: "North America",
            overallScore: 4,
            status: "NEW",
            doNotResurface: false,
            notForSurfacing: false,
            lastSeenAt: "2026-08-04T00:00:00.000Z",
            tags: [{ tag: { id: "tag-1", name: "Maker" } }],
            notes: [],
            provenance: [],
          },
        ]}
      />,
    );
    expect(markup).toContain("Bulk candidate actions");
    expect(markup).toContain("Notes and provenance");
    expect(markup).toContain("Authored note history");
  });

  it("renders immutable tuning and taste revision histories", () => {
    const tuning = renderToStaticMarkup(
      <TuningEditor
        initial={{ version: 1, beat: "Human journeys", hardNos: [], moreOf: [] }}
        revisions={[]}
      />,
    );
    const taste = renderToStaticMarkup(<TasteLogEditor entries={[]} />);
    expect(tuning).toContain("Generate canonical preview");
    expect(tuning).toContain("Revision history");
    expect(taste).toContain("Add observation");
  });
});
