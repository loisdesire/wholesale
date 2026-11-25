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

## 7. Known small things (not bugs in the new work)

- The OpenAI key in your `.env` file has expired, so AI replies and AI photo descriptions fail until you put in a new key.
- The `main` branch on GitHub is older than the `main` on your computer. It does not affect the app.
- A harmless warning from Sentry (the error-tracking tool) shows when the app starts. It can be ignored.

## 8. Words you may meet

- **Branch** — a separate copy of the code to work in.
- **Merge** — joining one branch's work into another.
- **Tag / bookmark** — a name stuck on one exact moment so you can return to it.
- **Dependency** — a ready-made package the app is built from.
- **Test** — a small program that checks something still works.
- **Build** — turning the code into the fast version used when the app is live.
