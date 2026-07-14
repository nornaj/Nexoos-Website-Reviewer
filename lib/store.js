/**
 * localStorage helpers for persisting data.
 * Will be swapped to Supabase later.
 */

const STORAGE_KEYS = {
  PROJECTS: "nexoos_projects",
  USER: "nexoos_user",
  COMMENTS: "nexoos_comments",
};

/**
 * Get data from localStorage by key
 */
export function getStoredData(key, fallback = null) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Set data in localStorage by key
 */
export function setStoredData(key, data) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save to localStorage:", e);
  }
}

/**
 * Generate a UUID v4
 */
export function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

/**
 * Format a timestamp to a short date string (e.g., "Jul 10")
 */
export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export { STORAGE_KEYS };
