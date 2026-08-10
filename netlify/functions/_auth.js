const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Add it in Netlify's environment variables (see README).");
  }
  return secret;
}

function signToken(email) {
  return jwt.sign({ email }, getSecret(), { expiresIn: "30d" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch (e) {
    return null;
  }
}

// Pulls the verified email out of an incoming request's Authorization header,
// or returns null if there isn't a valid one.
function getEmailFromRequest(event) {
  const header =
    (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = verifyToken(token);
  return payload ? payload.email : null;
}

module.exports = { signToken, verifyToken, getEmailFromRequest };
