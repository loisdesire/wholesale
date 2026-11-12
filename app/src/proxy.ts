import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login"];
// The public marketing page. Signed-out visitors to "/" are shown it (a rewrite, so the URL stays
// "/"); signed-in users at "/" get the dashboard as before. Every other route stays protected.
const LANDING_PATH = "/welcome";

export default auth((req) => {
  const isPublic = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  const isLoggedIn = !!req.auth;

  if (req.nextUrl.pathname === LANDING_PATH) {
    // One canonical URL for the landing page: "/" (which also sends signed-in users home).
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
  if (!isLoggedIn && req.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL(LANDING_PATH, req.nextUrl.origin));
  }

  if (!isLoggedIn && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isPublic) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
});

export const config = {
  // api/webhooks/* receives unauthenticated calls from third parties (Meta's
  // WhatsApp webhook) verified by its own signature check, not a session —
  // it must never go through session-based auth.
  matcher: ["/((?!api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
