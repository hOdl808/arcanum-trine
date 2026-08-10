const { getPool } = require("./_db");
const { getEmailFromRequest } = require("./_auth");

// This runs right before a reading is drawn. It locks the user's row,
// figures out what they're entitled to, consumes exactly one unit of
// access (free reading, membership, or a purchased credit), and commits —
// all inside one transaction, so two rapid clicks can't both succeed.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const email = getEmailFromRequest(event);
  if (!email) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not signed in." }) };
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      "SELECT free_reading_used, credits, membership_active FROM users WHERE email = $1 FOR UPDATE",
      [email]
    );
    const u = rows[0];

    if (!u) {
      await client.query("ROLLBACK");
      return { statusCode: 404, body: JSON.stringify({ error: "No account found." }) };
    }

    if (!u.free_reading_used) {
      await client.query(
        "UPDATE users SET free_reading_used = TRUE, updated_at = now() WHERE email = $1",
        [email]
      );
      await client.query("COMMIT");
      return { statusCode: 200, body: JSON.stringify({ granted: true, via: "free" }) };
    }

    if (u.membership_active) {
      await client.query("COMMIT");
      return { statusCode: 200, body: JSON.stringify({ granted: true, via: "membership" }) };
    }

    if (u.credits > 0) {
      await client.query(
        "UPDATE users SET credits = credits - 1, updated_at = now() WHERE email = $1",
        [email]
      );
      await client.query("COMMIT");
      return { statusCode: 200, body: JSON.stringify({ granted: true, via: "credit" }) };
    }

    await client.query("ROLLBACK");
    return {
      statusCode: 402,
      body: JSON.stringify({ granted: false, error: "No readings available." }),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("DB error in start-reading:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error." }) };
  } finally {
    client.release();
  }
};
