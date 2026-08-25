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

  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT stripe_customer_id FROM users WHERE email = $1", [email]);
    const customerId = rows[0] && rows[0].stripe_customer_id;

    if (!customerId) {
      return { statusCode: 400, body: JSON.stringify({ error: "No billing account on file yet." }) };
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: portalSession.url }) };
  } catch (e) {
    console.error("Stripe/DB error in customer-portal:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not open billing portal." }) };
  }
};
