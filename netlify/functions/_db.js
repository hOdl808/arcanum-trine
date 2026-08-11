// Shared Postgres connection pool for Netlify Database.
// getDatabase() from @netlify/database automatically finds and connects to
// the right database branch for wherever this code is running — no manual
// connection string needed.
const { getDatabase } = require("@netlify/database");

let db;

function getPool() {
  if (!db) {
    db = getDatabase();
  }
  return db.pool; // a standard pg.Pool, so the rest of our code is unchanged
}

module.exports = { getPool };
