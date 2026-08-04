type SetupItem = {
  label: string;
  configured: boolean;
  hint: string;
};

export function SetupNotice({ items }: { items: SetupItem[] }) {
  const missing = items.filter((item) => !item.configured);
  if (missing.length === 0) return null;

  return (
    <section className="notice notice-warning" aria-labelledby="setup-title">
      <div className="notice-icon" aria-hidden="true">
        !
      </div>
      <div>
        <h2 id="setup-title">Runtime setup is incomplete</h2>
        <p>
          The interface is available, but database-backed actions remain
          disabled until these settings are supplied.
        </p>
        <ul className="setup-list">
          {missing.map((item) => (
            <li key={item.label}>
              <code>{item.label}</code>
              <span>{item.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
