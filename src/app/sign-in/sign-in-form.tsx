"use client";

import { useState, type FormEvent } from "react";

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const token = new FormData(event.currentTarget).get("token");
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      window.location.assign("/");
      return;
    }
    const body = (await response.json()) as { error?: { message?: string } };
    setError(body.error?.message ?? "Sign in failed.");
    setSubmitting(false);
  }

  return (
    <form className="form-card auth-card" onSubmit={submit}>
      <label>
        <span>Provisioned session token</span>
        <input name="token" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
