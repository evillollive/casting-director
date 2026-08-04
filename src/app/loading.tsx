export default function Loading() {
  return (
    <section className="notice" aria-live="polite" aria-busy="true">
      <span className="notice-icon" aria-hidden="true">…</span>
      <div><h2>Loading workspace</h2><p>Fetching authenticated, workspace-scoped data.</p></div>
    </section>
  );
}
