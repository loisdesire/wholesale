/**
 * Image types this app will store and serve back. Deliberately an allowlist, not
 * `startsWith("image/")`: `image/svg+xml` is an image type that can carry scripts, and the
 * image routes are same-origin with the signed-in app, so serving one would be stored XSS.
 */
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType.toLowerCase());
}

/** Response headers for streaming stored image bytes back to a signed-in user. */
export function imageResponseHeaders(mimeType: string, sizeBytes: number): Record<string, string> {
  const safe = isAllowedImageType(mimeType);
  return {
    // Anything outside the allowlist (e.g. rows stored before it existed) is never rendered inline.
    "Content-Type": safe ? mimeType.toLowerCase() : "application/octet-stream",
    "Content-Length": String(sizeBytes),
    "Content-Disposition": safe ? "inline" : "attachment",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // Private — never cached by a shared/CDN cache, since this is tenant-private content.
    "Cache-Control": "private, max-age=86400",
  };
}
