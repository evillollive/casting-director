import type { ReactNode } from "react";

export function EmptyState({
  marker,
  title,
  children,
}: {
  marker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-marker" aria-hidden="true">
        {marker}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}
