const crypto = require("crypto");
const { getPool } = require("./_db");
const { signToken } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let email, code;
  try {
    ({ email, code } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }
  email = (email || "").trim().toLowerCase();
  code = (code || "").trim();

  if (!email || !code) {
    return { statusCode: 400, body: JSON.stringify({ error: "Enter the code you were emailed." }) };
  }

  const pool = getPool();

  let record;
  try {
    const { rows } = await pool.query("SELECT * FROM otp_codes WHERE email = $1", [email]);
    record = rows[0];
  } catch (e) {
    console.error("DB error in verify-code:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error. Try again shortly." }) };
  }

  if (!record) {
    return { statusCode: 400, body: JSON.stringify({ error: "Request a new code first." }) };
  }
  if (new Date(record.expires_at) < new Date()) {
    return { statusCode: 400, body: JSON.stringify({ error: "That code expired. Request a new one." }) };
  }
  if (record.attempts >= 5) {
    return { statusCode: 429, body: JSON.stringify({ error: "Too many attempts. Request a new code." }) };
  }

  const codeHash = crypto
    .createHash("sha256")
    .update(code + process.env.JWT_SECRET)
    .digest("hex");

  if (codeHash !== record.code_hash) {
    await pool.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1", [email]);
    return { statusCode: 400, body: JSON.stringify({ error: "Incorrect code." }) };
  }

  try {
    await pool.query("DELETE FROM otp_codes WHERE email = $1", [email]);
    await pool.query(
      `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email]
    );
  } catch (e) {
    console.error("DB error finalizing verify-code:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error. Try again shortly." }) };
  }

  const token = signToken(email);
  return { statusCode: 200, body: JSON.stringify({ token }) };
};
