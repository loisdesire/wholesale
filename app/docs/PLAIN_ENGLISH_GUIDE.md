# Plain-English guide — what changed and how to use it

This page explains the recent work without technical talk. If something here is unclear, ask and it will be rewritten.

## 1. The big picture (updated 2026-11-25)

Three things happened:

1. **The whole website got a new look ("Dispatch").** Every page, including the landing page, was redesigned: cleaner layout, shorter words, less crowding on phones, better organised on a computer screen.
2. **Security problems were fixed.** The software the app is built on (Next.js and a few helper packages) had known weaknesses. They are patched. A scan for known problems now reports **zero**.
3. **Extra protection was added.** Details in section 4.

Nothing about how the app *works* was removed. Orders, customers, catalogue, inbox (WhatsApp and Telegram), payments, reports and the dashboard all still work as before. They were tested after the changes (see section 5).

## 2. Where things live (branches)

A "branch" is just a separate copy of the code where work happens. There are only two now:

| Branch | What it is |
| --- | --- |
| `main` | The older, original line. Not touched by this work. |
| `working` | **The real app.** It now has the new design and the security fixes. |

There is also a **bookmark called `pre-redesign`**. It marks exactly how the app looked *before* the redesign. Nothing else lives there; it just lets you go back.

## 3. How to see the old design again

Pick one:

- **Just look at it, change nothing:** in the project folder run `git checkout pre-redesign`. When done, run `git checkout working` to come back.
- **Undo the redesign on the real app:** run `git revert -m 1 0f500ea`. This adds a new step that reverses the redesign. The security fixes are kept only if they were made separately; if you are unsure, ask first.

Do not delete the `pre-redesign` bookmark. It is your way back.

## 4. The security work, in simple words

- **Next.js updated to 16.4.6.** The old version had known holes that attackers could use. The new one does not.
- **Other flagged problems fixed.** Fifteen smaller warnings from the dependency scan (`npm audit`) were cleared too.
- **Photo uploads are stricter.** Only normal pictures (JPEG, PNG, WebP, GIF) are accepted. A sneaky file pretending to be a picture (such as an SVG that can run code) is refused. Old files already stored are shown safely, never run.
- **WhatsApp messages are checked more carefully.** The secret code that proves a message really came from WhatsApp is now compared in a safer way, and picture links are only fetched from Meta's own servers.
- **Browser safety headers.** The site tells browsers to always use the secure `https` connection once it is live on a real domain, and not to be shown inside other sites.
- **Saved report views** no longer crash when someone types a bad date. They show a clear message.

## 5. How it was checked

- The automatic checks: code has no errors, **395 tests pass**, and the app builds for real use.
- A robot clicked through the app like a person on a copy of the database (not your real data): sign in, add customer, add product with photo, make an order, confirm it, mark paid, ship it, request a return, open the inbox, send test WhatsApp and Telegram messages, download reports. **All 145 checks passed**, on both computer and phone sizes.

Not checked (needs the real thing): live traffic from Meta, Telegram or Paystack, and how the secure-connection setting behaves on your final domain. Test these once you go live.

## 6. How to run it on your computer

1. Start the database (Docker must be open): in the `app` folder run `docker compose up -d`.
2. Start the app: `npm run dev`.
3. Open http://localhost:3000 in your browser.

If the page looks broken or old after a change, stop the app, delete the `.next` folder inside `app`, and start again.

## 6b. New on 2026-11-25

- **"Your order shipped" message.** When staff ship an order, the customer is messaged in the same chat (WhatsApp or Telegram) with how many items, the carrier, the tracking number and a link. If the message can't be sent (for example WhatsApp isn't connected yet), the shipment still goes through and the order page has a **Copy link** button so you can send it by hand. The owner can switch the message off in **Operations → Settings**.
- **Customer status page.** The link in that message opens a simple page that shows progress (confirmed, paid, shipped) and each shipment. It has no phone number, address or prices. Only someone with the link can open it.
- **Daily backup.** The database is copied every evening at 9pm into the `app/backups` folder. See section 6 of `MVP_STATUS_AND_FLOWS.md` for how to run, restore or stop it. The copies are on this laptop only.
- **Fonts.** The whole app now uses the Figtree font.

## 6c. Fixes after the testing review (2026-11-26)

A tester went through the whole app and found problems. All of them are fixed. In plain words:

- **The AI quoted some prices ten times too high** (₦3,500 became ₦35,000). It now gets ready-written prices and no longer does its own sums.
- **The AI could create the same order twice.** It now checks first and reuses or updates the one that exists. It also can never draft more than you have in stock.
- **The AI can now answer "where is my order?"** It looks up only that customer's own orders and replies with the status, carrier, tracking number and link. It cannot see anyone else's.
- **The AI no longer guesses about delivery, returns or payment.** It says it will check with your team.
- **WhatsApp now gets automatic AI replies**, like Telegram. If you would rather review every chat yourself, switch it off in **Operations → Settings**.
- **The inbox is fast with thousands of chats.** It shows 40 at a time, with search and a "Needs reply" filter.
- **The New order page** shows your 30 most recent customers and searches for the rest, instead of one huge list.
- **A new Returns page**, so the link from Operations works.
- **Signing out now really ends the session**, even if someone copied your login. Sessions last 7 days.
- **Every page has its own tab title**, and the product has its own name (**Dispatch**, a placeholder you can change in one place: `src/lib/brand.ts`). The AI now uses each business's real name instead of always saying "Adaeze".
- **A new business sees a "Get started" checklist** instead of "All caught up".
- **Plainer wording** on the dashboard and in the payment reminder drafts; the "Running low" list no longer invents a sales speed; a "Skip to main content" link for keyboard users; two products can no longer share a SKU that differs only by capital letters.
- **The dashboard is shorter on a phone**, and products without photos get a coloured tile with their initials.
- **The AI test no longer leaves junk businesses behind** in your database.

How it was checked: all automatic tests pass, a robot clicked through every area on a copy of your data, and the real AI was asked the same questions again. See `QA_REPORT_2026-11-25.md` for the full list.

## 7. Known small things (not bugs in the new work)

- The AI key is now working. If it ever fails again, check the key in `.env` and make sure no old `OPENAI_API_KEY` is set in Windows, because Windows settings override the file.
- The `main` branch on GitHub is older than the `main` on your computer. It does not affect the app.
- A harmless warning from Sentry (the error-tracking tool) shows when the app starts. It can be ignored.

## 8. Words you may meet

- **Branch** — a separate copy of the code to work in.
- **Merge** — joining one branch's work into another.
- **Tag / bookmark** — a name stuck on one exact moment so you can return to it.
- **Dependency** — a ready-made package the app is built from.
- **Test** — a small program that checks something still works.
- **Build** — turning the code into the fast version used when the app is live.
