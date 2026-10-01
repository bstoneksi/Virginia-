/**
 * The assistant's name before /api/bootstrap has loaded (login page, loading and error screens).
 * scripts/apply-config.mjs stamps the configured name and description into client/index.html, so the
 * static tags are the source of truth until the API answers. After login, use `useAssistant()`.
 */

/** Shown when index.html carries no stamped name (a checkout that never ran `npm run config:apply`). */
export const FALLBACK_ASSISTANT_NAME = "Assistant";

function metaContent(name: string): string | null {
  if (typeof document === "undefined") return null;
  const content = document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim();
  return content ? content : null;
}

/** `assistant.name` from the stamped `apple-mobile-web-app-title` meta (falls back to the page title). */
export function staticAssistantName(): string {
  const stamped = metaContent("apple-mobile-web-app-title");
  if (stamped) return stamped;
  const title = typeof document === "undefined" ? "" : document.title.trim();
  return title && !title.includes("·") ? title : FALLBACK_ASSISTANT_NAME;
}

/** `${owner.fullName}'s ${assistant.tagline}` from the stamped `description` meta, or null. */
export function staticAssistantDescription(): string | null {
  return metaContent("description");
}
