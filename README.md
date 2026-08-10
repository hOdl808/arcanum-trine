# Arcanum Trine — Setup & Deploy Guide

This turns the app from "one static file" into a real product: email sign-in,
one free reading per person, and paid readings (single or membership) backed
by Stripe. Everything below happens on Netlify — you don't need a separate
server.

## What's in this project

```
public/index.html          the app itself (frontend)
netlify/functions/         the backend (7 small serverless functions)
db/schema.sql              the two database tables it needs
test/                      automated tests for the backend logic (dev only, not deployed)
netlify.toml                Netlify config (routes /api/* to the functions)
package.json                backend dependencies
```

## Before you start — accounts you'll need

- **Netlify** — you're already on it.
- **Stripe** — you said you have one. Good.
- **Resend** (or any transactional email service) — for sending the login
  codes. Free tier is plenty to start. Sign up at resend.com.

---

## 1. Get the site onto Netlify (with functions + a database this time)

Netlify Drop (the drag-and-drop you used before) only handles static files —
it can't run the backend functions or provision a database. For this version
you need a proper Netlify *site*, connected either to Git or deployed via
the Netlify CLI. The CLI is the fastest path if you don't want to set up a
GitHub repo:

```bash
npm install -g netlify-cli
netlify login
cd arcanum-trine          # the folder you unzipped
netlify init              # creates a new Netlify site, or links an existing one
```

Say yes when it asks to detect build settings — it'll pick up `netlify.toml`
automatically.

## 2. Turn on Netlify Database

In the Netlify dashboard: your site → **Database** tab → **Create database**.
This is a real Postgres database, fully managed by Netlify. Once created, it
automatically sets an environment variable called `NETLIFY_DATABASE_URL` —
you don't need to touch that one yourself.

Then load the schema into it. The Database tab gives you a connection
string; use it with any Postgres client:

```bash
psql "the-connection-string-from-the-dashboard" -f db/schema.sql
```

(No `psql` installed? Any GUI Postgres client — TablePlus, Postico, pgAdmin —
works too. Just run the contents of `db/schema.sql` against the database.)

## 3. Set up Stripe

**a. Create two Prices in the Stripe Dashboard** (Product catalog → Add product):

- **Single Reading** — one-time price, whatever you want to charge (e.g. $4)
- **Membership** — recurring price, billed monthly (e.g. $9/month)

After creating each, copy its **Price ID** (starts with `price_...`).

**b. Get your API key**: Developers → API keys → copy the **Secret key**
(starts with `sk_test_...` while you're testing, `sk_live_...` when real).

**c. Set up the webhook** — this is the piece that makes payment verification
real instead of "trust the browser." Developers → Webhooks → Add endpoint:

- Endpoint URL: `https://YOUR-SITE.netlify.app/api/stripe-webhook`
- Events to send: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`

After creating it, copy the **Signing secret** (starts with `whsec_...`).

## 4. Set up email (Resend)

- Sign up at resend.com, grab your **API key**.
- **Important limitation to know about**: until you verify your own sending
  domain with Resend, you can only send emails to the address you signed up
  with — real users won't receive their codes. For testing that's fine; for
  real visitors, verify a domain (Resend walks you through adding a couple
  of DNS records) and use an address on it, e.g.
  `Arcanum Trine <hello@yourdomain.com>`.

## 5. Set the environment variables

In Netlify: your site → **Site configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | from Stripe, step 3b |
| `STRIPE_WEBHOOK_SECRET` | from Stripe, step 3c |
| `STRIPE_PRICE_SINGLE` | the single-reading Price ID |
| `STRIPE_PRICE_MEMBERSHIP` | the membership Price ID |
| `RESEND_API_KEY` | from Resend, step 4 |
| `EMAIL_FROM` | e.g. `Arcanum Trine <hello@yourdomain.com>` |
| `JWT_SECRET` | any long random string — this signs login sessions |

For `JWT_SECRET`, anything long and random works, e.g. generate one with:
```bash
openssl rand -hex 32
```

(`NETLIFY_DATABASE_URL` is already set automatically from step 2 — don't add
it yourself.)

## 6. Deploy

```bash
netlify deploy --prod
```

That builds and ships both the frontend and the seven backend functions.

## 7. Test it before telling anyone

1. Visit your live URL, enter your own email, get the code, log in.
2. Do one free reading — should work.
3. Try a second reading — should hit the paywall.
4. Click "Buy 1 Reading," use Stripe's test card `4242 4242 4242 4242`,
   any future expiry, any CVC.
5. You should land back on the app and, within a couple of seconds, be able
   to draw again. If it hangs on "Confirming your payment…" for the full
   ~12 seconds, check Stripe Dashboard → Developers → Webhooks → your
   endpoint → Recent deliveries. A non-200 response there means the webhook
   secret or price IDs are mismatched — the error message will say which.

## Going live for real

Everything above can be done in Stripe's **test mode** first — nothing is
charged, and test-mode Price IDs/keys are separate from live ones. When
you're ready to accept real payments:

1. Flip Stripe's dashboard toggle from Test to Live.
2. Re-create the two Prices in live mode (test and live products don't
   share IDs) and re-create the webhook endpoint in live mode too.
3. Swap `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SINGLE`,
   and `STRIPE_PRICE_MEMBERSHIP` in Netlify for their live-mode versions.
4. Redeploy.

## If something breaks

- **Netlify → your site → Functions** tab shows logs for each function —
  this is the first place to look if login codes aren't arriving or
  payments aren't unlocking readings.
- **Stripe → Developers → Webhooks → your endpoint** shows every event
  Stripe tried to send and whether your site accepted it (200) or not.
- The `test/` folder has two scripts you can rerun locally any time you
  change the backend logic, with everything mocked (no real Stripe/email/DB
  needed):
  ```bash
  npm install
  node test/mock-flow.test.js
  node test/webhook.test.js
  ```
