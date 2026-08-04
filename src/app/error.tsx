"use client";

export default function ApplicationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="failure-panel" role="alert">
      <h1>Workspace unavailable</h1>
      <p>The application could not load its durable data. No change was applied.</p>
      <button className="secondary-button" type="button" onClick={reset}>Retry</button>
    </section>
  );
}
