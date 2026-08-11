const { getPool } = require("./_db");

// TEMPORARY, ONE-TIME USE: creates the two tables this app needs.
// Visit this URL once with the key below, confirm success, then delete
// this file (and push that change) — it doesn't need to exist afterward.
//
//   https://YOUR-SITE.netlify.app/.netlify/functions/setup-db?key=arcanum-setup-2026
//
const SETUP_KEY = "arcanum-setup-2026";

exports.handler = async (event) => {
  const providedKey = (event.queryStringParameters && event.queryStringParameters.key) || "";
  if (providedKey !== SETUP_KEY) {
    return { statusCode: 401, body: "Unauthorized. Add ?key=arcanum-setup-2026 to the URL." };
  }

  try {
    const pool = getPool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        email               TEXT PRIMARY KEY,
        free_reading_used   BOOLEAN NOT NULL DEFAULT FALSE,
        credits             INTEGER NOT NULL DEFAULT 0,
        membership_active   BOOLEAN NOT NULL DEFAULT FALSE,
        stripe_customer_id  TEXT,
        stripe_subscription_id TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        email       TEXT PRIMARY KEY,
        code_hash   TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users (stripe_subscription_id);
    `);

    return {
      statusCode: 200,
      body: "Success! The 'users' and 'otp_codes' tables now exist. You can delete this setup-db.js file now.",
    };
  } catch (e) {
    return { statusCode: 500, body: "Error creating tables: " + e.message };
  }
};
