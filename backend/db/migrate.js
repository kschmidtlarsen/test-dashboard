#!/usr/bin/env node
/**
 * Run database migrations
 * Usage: DATABASE_URL=... node db/migrate.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

async function migrate() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');

    // Create tables
    console.log('Creating test_runs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(100) NOT NULL,
        run_id VARCHAR(50) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stats_total INTEGER NOT NULL DEFAULT 0,
        stats_passed INTEGER NOT NULL DEFAULT 0,
        stats_failed INTEGER NOT NULL DEFAULT 0,
        stats_skipped INTEGER NOT NULL DEFAULT 0,
        stats_duration INTEGER NOT NULL DEFAULT 0,
        source VARCHAR(50) DEFAULT 'ci-upload',
        exit_code INTEGER DEFAULT 0,
        suites JSONB DEFAULT '[]'::jsonb,
        errors JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✓ test_runs table created');

    // Create indexes
    console.log('Creating indexes...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_runs_timestamp ON test_runs(timestamp DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_test_runs_project_timestamp ON test_runs(project_id, timestamp DESC)`);
    console.log('✓ Indexes created');

    // Create projects table
    console.log('Creating projects table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        base_url VARCHAR(500),
        port INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✓ projects table created');

    // Insert default projects
    console.log('Inserting default projects...');
    await pool.query(`
      INSERT INTO projects (id, name, base_url, port) VALUES
        ('rental', 'Rental Platform', 'https://rental.exe.pm', 3002),
        ('crossfit-generator', 'WODForge', 'https://crossfit.exe.pm', 3000),
        ('calify', 'Calify', 'https://calify.exe.pm', 3020),
        ('kanban', 'Kanban Board', 'https://kanban.exe.pm', 3010),
        ('grablist', 'Grablist', 'https://grablist.exe.pm', 3040),
        ('sorring3d', 'Sorring 3D', 'https://sorring3d.exe.pm', 3050)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✓ Default projects inserted');

    // Verify
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    console.log('\n✓ Migration complete!');
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));

    const projects = await pool.query('SELECT id, name FROM projects');
    console.log('Projects:', projects.rows.map(r => r.name).join(', '));

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
