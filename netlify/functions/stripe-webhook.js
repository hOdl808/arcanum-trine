const Stripe = require("stripe");
const { getPool } = require("./_db");

// IMPORTANT: this endpoint is called by Stripe, not by your frontend.
// Register its URL (https://YOURSITE/api/stripe-webhook) in the Stripe
// Dashboard so Stripe knows where to send events. See README.
exports.handler = async (event) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const pool = getPool();

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        const email = (
          session.client_reference_id ||
          (session.customer_details && session.customer_details.email) ||
          ""
        ).toLowerCase();
        if (!email) break;

        await pool.query(
          `INSERT INTO users (email, stripe_customer_id)
           VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE
             SET stripe_customer_id = COALESCE(users.stripe_customer_id, EXCLUDED.stripe_customer_id)`,
          [email, session.customer]
        );

        if (session.mode === "payment") {
          await pool.query(
            "UPDATE users SET credits = credits + 1, updated_at = now() WHERE email = $1",
            [email]
          );
        } else if (session.mode === "subscription") {
          await pool.query(
            `UPDATE users
               SET membership_active = TRUE, stripe_subscription_id = $2, updated_at = now()
             WHERE email = $1`,
            [email, session.subscription]
          );
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        const active = sub.status === "active" || sub.status === "trialing";
        await pool.query(
          "UPDATE users SET membership_active = $2, updated_at = now() WHERE stripe_subscription_id = $1",
          [sub.id, active]
        );
        break;
      }

      default:
        // Other events are ignored on purpose.
        break;
    }
  } catch (e) {
    console.error("Webhook handling error:", e);
    return { statusCode: 500, body: "Webhook handler error" };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
