import { describe, it, expect } from "vitest";
import { isAllowedImageType, imageResponseHeaders } from "@/lib/images";

describe("image serving safety", () => {
  it("allows raster types only", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "IMAGE/PNG"]) expect(isAllowedImageType(t)).toBe(true);
    for (const t of ["image/svg+xml", "text/html", "application/octet-stream", ""]) expect(isAllowedImageType(t)).toBe(false);
  });

  it("never serves a disallowed type inline", () => {
    const h = imageResponseHeaders("image/svg+xml", 10);
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toBe("attachment");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
  });

  it("serves an allowed type inline with nosniff", () => {
    const h = imageResponseHeaders("image/png", 10);
    expect(h["Content-Type"]).toBe("image/png");
    expect(h["Content-Disposition"]).toBe("inline");
  });
});
