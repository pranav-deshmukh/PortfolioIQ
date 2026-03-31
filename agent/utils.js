// ── Utility helpers ───────────────────────────────────────────────────

/** Pseudo UUID-ish ID generator (no crypto dependency) */
export function v4Ish() {
  return "xxxx-xxxx-xxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

/** Format dollar amounts */
export function fmt$(n) {
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toLocaleString();
}
