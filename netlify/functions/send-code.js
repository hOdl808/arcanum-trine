const crypto = require("crypto");
const { getPool } = require("./_db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }
  email = (email || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Enter a valid email address." }) };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  const codeHash = crypto
    .createHash("sha256")
    .update(code + process.env.JWT_SECRET)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO otp_codes (email, code_hash, expires_at, attempts)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (email) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0`,
      [email, codeHash, expiresAt]
    );
  } catch (e) {
    console.error("DB error in send-code:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error. Try again shortly." }) };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.EMAIL_FROM || "Arcanum Trine <onboarding@resend.dev>";

  if (!resendKey) {
    console.error("RESEND_API_KEY is not set.");
    return { statusCode: 500, body: JSON.stringify({ error: "Email sending isn't configured yet." }) };
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: email,
        subject: "Your Arcanum Trine code",
        html: `
          <div style="font-family:Georgia,serif;background:#15112a;color:#ece3d0;padding:32px;border-radius:12px;">
            <h2 style="color:#c9a15a;letter-spacing:1px;">Arcanum Trine</h2>
            <p>Your one-time code is:</p>
            <p style="font-size:32px;letter-spacing:8px;color:#e0c184;font-weight:bold;">${code}</p>
            <p style="color:#a89bc4;">This code expires in 10 minutes. If you didn't request this, you can ignore it.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return { statusCode: 502, body: JSON.stringify({ error: "Could not send the code. Try again in a moment." }) };
    }
  } catch (e) {
    console.error("Email send failed:", e);
    return { statusCode: 502, body: JSON.stringify({ error: "Could not send the code. Try again in a moment." }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
