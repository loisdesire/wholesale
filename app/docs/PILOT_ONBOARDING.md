# Pilot onboarding

How to bring a real wholesale business onto the platform today. There is **no self-serve sign-up
flow yet** — every organization that exists (the two demo ones included) was created directly
against the database, via `prisma/seed.ts` or a one-off script. Onboarding a pilot is therefore a
manual, ops-run process: someone with `DIRECT_URL` access runs the steps below once per business.
This is deliberate, not an oversight — see "What's missing for self-serve" below for what a real
sign-up flow would need and why it's out of scope until there's a pilot to learn from.

## Before you start

- The business needs a WhatsApp Business number already set up in Meta's Cloud API, with its
  `phone_number_id` in hand (`Organization.whatsappPhoneNumberId` — see `docs/ISOLATION.md`'s
  "WhatsApp webhooks" section for how inbound messages get routed to the right organization by
  this field). Without it the org can still use the app, just not receive WhatsApp messages.
- Decide the owner's login email up front — this is also where billing/subscription
  communication would go (no separate billing contact field exists).
- Decide which plan to start them on (`src/lib/billing.ts`'s `PLAN_LIMITS` — these are
  illustrative placeholders, not finalized pricing; see `docs/PROGRESS.md`). A pilot is more
  likely to start on a comped/trial basis than a paying plan on day one.

## Steps

1. **Create the organization, owner user, and membership.** There's no dedicated onboarding
   script yet (`scripts/` only has `check-isolation.ts` and `run-ai-eval.ts`) — run this once
   against `DIRECT_URL`, adapted from the same pattern `prisma/seed.ts` uses:

   ```ts
   import { PrismaClient } from "@prisma/client";
   import bcrypt from "bcryptjs";

   const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

   const org = await prisma.organization.create({
     data: {
       name: "<Business name>",
       whatsappPhoneNumberId: "<their Meta phone_number_id, or omit for now>",
     },
   });

   await prisma.user.create({
     data: {
       email: "<owner email>",
       passwordHash: await bcrypt.hash("<a real temporary password>", 10),
       name: "<owner name>",
       memberships: { create: { organizationId: org.id, role: "OWNER" } },
     },
   });
   ```

   Hand the owner their email and temporary password out of band (not over WhatsApp, not in a
   ticket) and have them sign in and change it — there's no "forgot password"/self-service
   password-change flow yet either, so a password change today also means a direct database
   update (`passwordHash`) until that's built.

2. **Start their trial**, so `/billing` shows a real countdown instead of the schema default
   (`subscriptionStatus: TRIALING`, `trialEndsAt: null` — which `isTrialExpired()` correctly never
   treats as expired, but also never nudges anyone to pay):

   ```ts
   import { startTrial } from "@/lib/billing";
   await startTrial(org.id);
   ```

   `startTrial` is written and tested (`tests/billing.test.ts`) but not yet wired into any
   automatic flow — call it explicitly here as part of onboarding. It sets `trialEndsAt` to 14
   days out (`TRIAL_DAYS` in `src/lib/billing.ts`) on the `STARTER` plan; follow it with a direct
   `organization.update` if the pilot should start on a different plan or a longer/comped trial.

3. **Load their real catalogue.** Two options, both already built:
   - `/catalogue/import` — CSV import, for a business that can export their existing product list.
   - Manual entry via `/catalogue/new`, one SKU at a time, if there's no existing digital catalogue
     (common for a WhatsApp-native wholesale business — this is the more likely path for a first
     pilot).

   Either way, opening stock must go through the app (a stock-ledger movement), not a direct
   database write — `recordStockMovement` is what keeps the ledger meaningful from day one.

4. **Register the WhatsApp number**, if not already set in step 1
   (`organization.update({ data: { whatsappPhoneNumberId } })`), and confirm Meta's webhook is
   pointed at `https://<host>/api/webhooks/whatsapp` with the shared `WHATSAPP_VERIFY_TOKEN` (see
   `docs/DEPLOYMENT.md`). Send a test message from a personal phone to their business number and
   confirm it shows up in `/inbox`.

5. **Add any additional staff.** Each additional `Membership` (role `STAFF` or `OWNER`) for an
   existing or new `User` — same pattern as step 1, minus the trial/plan setup, which is
   per-organization, not per-user.

6. **Walk the owner through the app once, live**, rather than handing over credentials cold —
   there's no in-app onboarding tour or help content yet. At minimum: Dashboard, Inbox, placing an
   order, marking it paid, Operations (the attention queue), and `/billing`.

## What's missing for self-serve

Listed here so it isn't silently assumed to exist. A real sign-up flow would need, roughly in
order of how blocking each is:

1. **A public sign-up page** (`/signup` or similar) that creates the organization + owner user +
   membership in one transaction — today's step 1 done through the UI instead of a script.
2. **Email verification and password reset**, since a self-serve owner can't be handed a password
   out of band the way a pilot can today.
3. **`startTrial` wired into that sign-up flow automatically** (step 2 above, done for them).
4. **A WhatsApp-number self-registration or connection flow** — today's step 4 assumes someone
   with database access does it by hand; Meta's Embedded Signup flow is the realistic path here,
   not yet integrated.
5. Platform super-admin tooling to see/manage all organizations without touching the database
   directly (still open on the Phase 7 list — see `docs/PROGRESS.md`).

None of this should be built speculatively — VISION.md's own build order calls for proving the
product with a hands-on pilot first, then automating the parts that onboarding pilots 2 and 3
makes obviously worth automating.
