const { getPool } = require("./_db");
const { getEmailFromRequest } = require("./_auth");

exports.handler = async (event) => {
  const email = getEmailFromRequest(event);
  if (!email) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not signed in." }) };
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT free_reading_used, credits, membership_active FROM users WHERE email = $1",
      [email]
    );
    const u = rows[0];
    if (!u) {
      return { statusCode: 404, body: JSON.stringify({ error: "No account found." }) };
    }

    const canRead = !u.free_reading_used || u.membership_active || u.credits > 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        canRead,
        freeReadingUsed: u.free_reading_used,
        credits: u.credits,
        membershipActive: u.membership_active,
      }),
    };
  } catch (e) {
    console.error("DB error in access-status:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error." }) };
  }
};
