// Shared Postgres connection pool for Netlify Database.
// We pass the connection string explicitly (from the NETLIFY_DATABASE_URL
// environment variable) rather than relying on getDatabase()'s
// auto-detection, which wasn't picking up the database for this site.
const { getDatabase } = require("@netlify/database");

let db;

function getPool() {
  if (!db) {
    const connectionString = process.env.NETLIFY_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NETLIFY_DATABASE_URL is not set in this site's environment variables.");
    }
    db = getDatabase({ connectionString });
  }
  return db.pool; // a standard pg.Pool, so the rest of our code is unchanged
}

module.exports = { getPool };
