// Shared Postgres connection pool for Netlify Database.
// Netlify injects NETLIFY_DATABASE_URL automatically once you enable
// Netlify Database for this site — you don't set this one yourself.
const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "NETLIFY_DATABASE_URL is not set. Enable Netlify Database for this site (see README)."
      );
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

module.exports = { getPool };
