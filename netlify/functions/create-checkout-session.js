const Stripe = require("stripe");
const { getPool } = require("./_db");
const { getEmailFromRequest } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const email = getEmailFromRequest(event);
  if (!email) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not signed in." }) };
  }

  let type;
  try {
    ({ type } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  if (type !== "single" && type !== "membership") {
    return { statusCode: 400, body: JSON.stringify({ error: "Unknown plan." }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const priceId =
    type === "membership" ? process.env.STRIPE_PRICE_MEMBERSHIP : process.env.STRIPE_PRICE_SINGLE;

  if (!priceId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing price ID for "${type}" — set it in Netlify env vars.` }),
    };
  }

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";

  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT stripe_customer_id FROM users WHERE email = $1", [email]);
    const existingCustomerId = rows[0] && rows[0].stripe_customer_id;

    const session = await stripe.checkout.sessions.create({
      mode: type === "membership" ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: existingCustomerId || undefined,
      customer_email: existingCustomerId ? undefined : email,
      client_reference_id: email,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancelled`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    console.error("Stripe/DB error in create-checkout-session:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not start checkout. Try again." }) };
  }
};
