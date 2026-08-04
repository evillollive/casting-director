"use client";

import { useState } from "react";

export function SessionControl() {
  const [error, setError] = useState(false);

  async function signOut() {
    setError(false);
    const response = await fetch("/api/auth/session", { method: "DELETE" });
    if (!response.ok) {
      setError(true);
      return;
    }
    window.location.assign("/sign-in");
  }

  return (
    <div className="session-control">
      <button className="header-session-button" type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      {error ? <span role="alert">Sign out failed</span> : null}
    </div>
  );
}
