// Tests stripe-webhook.js against a fake Stripe SDK + fake DB.
// Run with: node test/webhook.test.js

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";

const assert = require("assert");

// ---- in-memory fake DB (same shape as the other test) ----
const users = new Map();

function fakeQuery(sql, params = []) {
  const s = sql.trim().replace(/\s+/g, " ");

  if (s.startsWith("INSERT INTO users (email, stripe_customer_id)")) {
    const [email, customerId] = params;
    if (!users.has(email)) {
      users.set(email, {
        email,
        credits: 0,
        membership_active: false,
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
      });
    } else if (!users.get(email).stripe_customer_id) {
      users.get(email).stripe_customer_id = customerId;
    }
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET credits = credits + 1")) {
    const [email] = params;
    users.get(email).credits += 1;
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET membership_active = TRUE, stripe_subscription_id")) {
    const [email, subId] = params;
    const u = users.get(email);
    u.membership_active = true;
    u.stripe_subscription_id = subId;
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET membership_active = $2")) {
    const [subId, active] = params;
    for (const u of users.values()) {
      if (u.stripe_subscription_id === subId) u.membership_active = active;
    }
    return { rows: [] };
  }
  throw new Error("Unhandled fake query: " + s);
}

const fakePool = { query: async (sql, params) => fakeQuery(sql, params) };

const dbPath = require.resolve("../netlify/functions/_db.js");
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getPool: () => fakePool },
};

// ---- fake Stripe SDK ----
let nextEvent = null;
function FakeStripe() {
  return {
    webhooks: {
      constructEvent: (body, sig, secret) => {
        if (sig !== "valid-signature") throw new Error("invalid signature");
        return nextEvent;
      },
    },
  };
}
const stripePath = require.resolve("stripe");
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: FakeStripe,
};

const webhook = require("../netlify/functions/stripe-webhook.js");

function evt(body, sig = "valid-signature") {
  return { body: JSON.stringify(body), headers: { "stripe-signature": sig } };
}

(async () => {
  // 1. bad signature -> 400
  nextEvent = null;
  let res = await webhook.handler(evt({}, "bad-sig"));
  assert.strictEqual(res.statusCode, 400);
  console.log("✓ invalid signature rejected with 400");

  // 2. one-time payment completes -> +1 credit
  nextEvent = {
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "payment",
        client_reference_id: "buyer@example.com",
        customer: "cus_123",
        customer_details: { email: "buyer@example.com" },
      },
    },
  };
  res = await webhook.handler(evt({}));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(users.get("buyer@example.com").credits, 1);
  console.log("✓ one-time checkout grants a credit:", users.get("buyer@example.com"));

  // 3. subscription checkout completes -> membership active
  nextEvent = {
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: "member@example.com",
        customer: "cus_456",
        subscription: "sub_789",
        customer_details: { email: "member@example.com" },
      },
    },
  };
  res = await webhook.handler(evt({}));
  assert.strictEqual(res.statusCode, 200);
  const member = users.get("member@example.com");
  assert.strictEqual(member.membership_active, true);
  assert.strictEqual(member.stripe_subscription_id, "sub_789");
  console.log("✓ subscription checkout activates membership:", member);

  // 4. subscription cancelled -> membership flips off
  nextEvent = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_789", status: "canceled" } },
  };
  res = await webhook.handler(evt({}));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(users.get("member@example.com").membership_active, false);
  console.log("✓ cancellation correctly deactivates membership");

  console.log("\nALL WEBHOOK CHECKS PASSED ✅");
})().catch((e) => {
  console.error("\nWEBHOOK TEST FAILED ❌");
  console.error(e);
  process.exit(1);
});
