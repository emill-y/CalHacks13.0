"use client";

const KEY = "tb-device-id";

/** Anonymous random id for this browser. No account, no fingerprinting. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export function resetDeviceId() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
