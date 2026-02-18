const { Pool } = require('pg');

// Create connection pool
// Neon requires SSL - always enable it when DATABASE_URL is set
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Test connection on startup
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
