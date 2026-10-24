import * as Sentry from "@sentry/nextjs";

/**
 * Error tracking — same "degrades gracefully, never fakes being configured" shape as
 * WhatsApp/email/Paystack (see src/lib/whatsapp.ts, src/lib/email.ts, src/lib/payments.ts).
 * Without SENTRY_DSN set, Sentry.init() is never called at all, so onRequestError
 * (instrumentation.ts) and any Sentry.captureException call becomes a safe no-op — nothing is
 * silently "half-reported." See docs/MONITORING_AND_BACKUPS.md for what this does and doesn't
 * cover yet (no org/project configured in next.config.ts, so no source-map upload — error
 * reports will show minified stack traces until a real Sentry project is set up).
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // Off by default — this app has no performance-monitoring need yet, and tracing adds
    // overhead to every request. Set a real value once that's actually wanted.
    tracesSampleRate: 0,
  });
}
