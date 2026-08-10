// Ad-hoc integration test: exercises send-code -> verify-code -> start-reading
// against an in-memory fake Postgres, and fakes the Resend email call so we
// can capture the code without actually sending mail. Run with:
//   node test/mock-flow.test.js

process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";

const assert = require("assert");
const Module = require("module");

// ---- in-memory fake "Postgres" ----
const state = { users: new Map(), otp: new Map() };

function fakeQuery(sql, params = []) {
  const s = sql.trim().replace(/\s+/g, " ");

  if (s.startsWith("INSERT INTO otp_codes")) {
    const [email, code_hash, expires_at] = params;
    state.otp.set(email, { email, code_hash, expires_at, attempts: 0 });
    return { rows: [] };
  }
  if (s.startsWith("SELECT * FROM otp_codes")) {
    const [email] = params;
    const row = state.otp.get(email);
    return { rows: row ? [row] : [] };
  }
  if (s.startsWith("UPDATE otp_codes SET attempts")) {
    const [email] = params;
    const row = state.otp.get(email);
    if (row) row.attempts += 1;
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM otp_codes")) {
    const [email] = params;
    state.otp.delete(email);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO users (email) VALUES")) {
    const [email] = params;
    if (!state.users.has(email)) {
      state.users.set(email, {
        email,
        free_reading_used: false,
        credits: 0,
        membership_active: false,
        stripe_customer_id: null,
      });
    }
    return { rows: [] };
  }
  if (s.startsWith("SELECT free_reading_used, credits, membership_active FROM users")) {
    const [email] = params;
    const u = state.users.get(email);
    return { rows: u ? [u] : [] };
  }
  if (s.startsWith("UPDATE users SET free_reading_used")) {
    const [email] = params;
    state.users.get(email).free_reading_used = true;
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET credits = credits - 1")) {
    const [email] = params;
    state.users.get(email).credits -= 1;
    return { rows: [] };
  }
  if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
    return { rows: [] };
  }
  throw new Error("Unhandled fake query: " + s);
}

const fakeClient = {
  query: async (sql, params) => fakeQuery(sql, params),
  release: () => {},
};
const fakePool = {
  query: async (sql, params) => fakeQuery(sql, params),
  connect: async () => fakeClient,
};

// Intercept require("./_db") to hand back our fake pool instead of real pg.
const origResolve = Module._resolveFilename;
const dbPath = require.resolve("../netlify/functions/_db.js");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getPool: () => fakePool },
};

// Fake global fetch (used by send-code.js to call Resend) so no real email goes out.
let capturedCode = null;
global.fetch = async (url, opts) => {
  if (url === "https://api.resend.com/emails") {
    const body = JSON.parse(opts.body);
    const match = body.html.match(/(\d{6})/);
    capturedCode = match ? match[1] : null;
    return { ok: true, text: async () => "{}" };
  }
  throw new Error("Unexpected fetch to " + url);
};
process.env.RESEND_API_KEY = "fake-key-for-test";

const sendCode = require("../netlify/functions/send-code.js");
const verifyCode = require("../netlify/functions/verify-code.js");
const startReading = require("../netlify/functions/start-reading.js");
const accessStatus = require("../netlify/functions/access-status.js");

function req(body, token) {
  return {
    httpMethod: "POST",
    body: body ? JSON.stringify(body) : undefined,
    headers: token ? { authorization: "Bearer " + token } : {},
  };
}

(async () => {
  const email = "reader@example.com";

  // 1. send-code
  let res = await sendCode.handler(req({ email }));
  assert.strictEqual(res.statusCode, 200, "send-code should succeed");
  assert.ok(capturedCode && /^\d{6}$/.test(capturedCode), "should capture a 6-digit code");
  console.log("✓ send-code issued code:", capturedCode);

  // 2. wrong code rejected
  res = await verifyCode.handler(req({ email, code: "000000" }));
  assert.strictEqual(res.statusCode, 400, "wrong code should be rejected");
  console.log("✓ wrong code correctly rejected");

  // 3. correct code accepted, get token
  res = await verifyCode.handler(req({ email, code: capturedCode }));
  assert.strictEqual(res.statusCode, 200, "correct code should succeed");
  const { token } = JSON.parse(res.body);
  assert.ok(token, "should receive a JWT");
  console.log("✓ verify-code issued a session token");

  // 4. access-status: fresh user, free reading available
  res = await accessStatus.handler(req(null, token));
  let status = JSON.parse(res.body);
  assert.strictEqual(status.canRead, true);
  assert.strictEqual(status.freeReadingUsed, false);
  console.log("✓ fresh user has free reading available:", status);

  // 5. start-reading consumes the free reading
  res = await startReading.handler(req({}, token));
  let result = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(result.via, "free");
  console.log("✓ first reading granted via free tier");

  // 6. second attempt with no membership/credits should be BLOCKED (this is the important one)
  res = await startReading.handler(req({}, token));
  result = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 402, "second reading with no credits/membership must be blocked");
  assert.strictEqual(result.granted, false);
  console.log("✓ second reading correctly blocked (no free double-dip):", result);

  // 7. simulate a webhook granting a credit, then confirm access returns
  state.users.get(email).credits += 1;
  res = await accessStatus.handler(req(null, token));
  status = JSON.parse(res.body);
  assert.strictEqual(status.canRead, true);
  assert.strictEqual(status.credits, 1);
  console.log("✓ after simulated credit purchase, access restored:", status);

  // 8. start-reading consumes the credit
  res = await startReading.handler(req({}, token));
  result = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(result.via, "credit");
  console.log("✓ reading granted via purchased credit");

  // 9. credit now exhausted again -> blocked
  res = await startReading.handler(req({}, token));
  assert.strictEqual(res.statusCode, 402);
  console.log("✓ blocked again once credit is used up");

  // 10. simulate membership activation -> unlimited
  state.users.get(email).membership_active = true;
  for (let i = 0; i < 3; i++) {
    res = await startReading.handler(req({}, token));
    result = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(result.via, "membership");
  }
  console.log("✓ active membership grants repeated readings");

  console.log("\nALL CHECKS PASSED ✅");
})().catch((e) => {
  console.error("\nTEST FAILED ❌");
  console.error(e);
  process.exit(1);
});
