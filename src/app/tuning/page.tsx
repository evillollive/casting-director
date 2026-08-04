import { PageHeading } from "@/components/page-heading";

export const metadata = { title: "Tuning" };

export default function TuningPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Editorial configuration"
        title="Tuning"
        description="Workspace tuning changes create immutable revisions so every scan remains reproducible."
        action={
          <button className="primary-button" disabled>
            Save revision
          </button>
        }
      />
      <section className="form-card">
        <label>
          <span>Beat / theme focus</span>
          <textarea
            disabled
            placeholder="What should the desk pay attention to right now?"
          />
        </label>
        <div className="form-columns">
          <label>
            <span>Hard nos</span>
            <textarea disabled placeholder="One editorial exclusion per line" />
          </label>
          <label>
            <span>More of</span>
            <textarea disabled placeholder="One desired pattern per line" />
          </label>
        </div>
      </section>
      <section className="boundary-card">
        <p className="eyebrow">Canonical boundary</p>
        <h2>Tuning does not rewrite the rubric</h2>
        <p>
          Prompt generation continues to source the existing Tier 0 prompt,
          rubric, and Python evaluator. This app stores operational revisions
          and exact scan snapshots only.
        </p>
      </section>
    </div>
  );
}
