const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3030;

// Security: Disable X-Powered-By header
app.disable('x-powered-by');

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Security: Validate projectId to prevent injection
function isValidProjectId(projectId) {
  if (!projectId || typeof projectId !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(projectId) && projectId.length <= 100;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'playwright-dashboard' });
});

// API health check (for Vercel)
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'playwright-dashboard', timestamp: new Date().toISOString() });
});

// Get list of projects
app.get('/api/projects', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, base_url, port FROM projects ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get all results summary (for dashboard overview)
app.get('/api/results', async (req, res) => {
  try {
    // Get latest run for each project
    const result = await db.query(`
      SELECT DISTINCT ON (project_id)
        project_id,
        run_id,
        timestamp,
        stats_total,
        stats_passed,
        stats_failed,
        stats_skipped,
        stats_duration,
        exit_code
      FROM test_runs
      ORDER BY project_id, timestamp DESC
    `);

    // Get project names
    const projects = await db.query('SELECT id, name FROM projects');
    const projectNames = {};
    projects.rows.forEach(p => { projectNames[p.id] = p.name; });

    // Build summary
    const summary = {};
    result.rows.forEach(row => {
      summary[row.project_id] = {
        name: projectNames[row.project_id] || row.project_id,
        lastRun: {
          id: row.run_id,
          timestamp: row.timestamp,
          stats: {
            total: row.stats_total,
            passed: row.stats_passed,
            failed: row.stats_failed,
            skipped: row.stats_skipped,
            duration: row.stats_duration
          }
        },
        passed: row.stats_passed,
        failed: row.stats_failed,
        skipped: row.stats_skipped,
        total: row.stats_total,
        status: row.stats_failed > 0 ? 'failed' : row.stats_passed > 0 ? 'passed' : 'unknown'
      };
    });

    // Add projects with no runs
    projects.rows.forEach(p => {
      if (!summary[p.id]) {
        summary[p.id] = {
          name: p.name,
          lastRun: null,
          passed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          status: 'unknown'
        };
      }
    });

    res.json(summary);
  } catch (err) {
    console.error('Error fetching results summary:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Get test results for a specific project
app.get('/api/results/:projectId', async (req, res) => {
  const { projectId } = req.params;

  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  try {
    const result = await db.query(`
      SELECT
        run_id as id,
        timestamp,
        stats_total as total,
        stats_passed as passed,
        stats_failed as failed,
        stats_skipped as skipped,
        stats_duration as duration,
        source,
        exit_code,
        suites,
        errors
      FROM test_runs
      WHERE project_id = $1
      ORDER BY timestamp DESC
      LIMIT 20
    `, [projectId]);

    if (result.rows.length === 0) {
      return res.json({ runs: [], lastRun: null });
    }

    const runs = result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      stats: {
        total: row.total,
        passed: row.passed,
        failed: row.failed,
        skipped: row.skipped,
        duration: row.duration
      },
      source: row.source,
      exitCode: row.exit_code,
      suites: row.suites,
      errors: row.errors
    }));

    res.json({
      runs,
      lastRun: runs[0]
    });
  } catch (err) {
    console.error('Error fetching project results:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Get test run history for a project
app.get('/api/history/:projectId', async (req, res) => {
  const { projectId } = req.params;

  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  try {
    const result = await db.query(`
      SELECT
        run_id as id,
        timestamp,
        stats_total as total,
        stats_passed as passed,
        stats_failed as failed,
        stats_skipped as skipped,
        stats_duration as duration,
        source,
        exit_code
      FROM test_runs
      WHERE project_id = $1
      ORDER BY timestamp DESC
      LIMIT 50
    `, [projectId]);

    const runs = result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      stats: {
        total: row.total,
        passed: row.passed,
        failed: row.failed,
        skipped: row.skipped,
        duration: row.duration
      },
      source: row.source,
      exitCode: row.exit_code
    }));

    res.json(runs);
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Upload test results (for CI/CD and manual test runs)
app.post('/api/upload/:projectId', async (req, res) => {
  const { projectId } = req.params;

  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  const { stats, suites, errors, source } = req.body;

  if (!stats || typeof stats !== 'object') {
    return res.status(400).json({ error: 'Invalid stats object' });
  }

  try {
    const runId = Date.now().toString();

    await db.query(`
      INSERT INTO test_runs (
        project_id, run_id, timestamp,
        stats_total, stats_passed, stats_failed, stats_skipped, stats_duration,
        source, exit_code, suites, errors
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      projectId,
      runId,
      stats.total || 0,
      stats.passed || 0,
      stats.failed || 0,
      stats.skipped || 0,
      stats.duration || 0,
      source || 'ci-upload',
      stats.failed > 0 ? 1 : 0,
      JSON.stringify(suites || []),
      JSON.stringify(errors || [])
    ]);

    // Ensure project exists
    await db.query(`
      INSERT INTO projects (id, name)
      VALUES ($1, $1)
      ON CONFLICT (id) DO NOTHING
    `, [projectId]);

    // Clean up old runs (keep last 50 per project)
    await db.query(`
      DELETE FROM test_runs
      WHERE project_id = $1
      AND id NOT IN (
        SELECT id FROM test_runs
        WHERE project_id = $1
        ORDER BY timestamp DESC
        LIMIT 50
      )
    `, [projectId]);

    const run = {
      id: runId,
      timestamp: new Date().toISOString(),
      stats: {
        total: stats.total || 0,
        passed: stats.passed || 0,
        failed: stats.failed || 0,
        skipped: stats.skipped || 0,
        duration: stats.duration || 0
      },
      source: source || 'ci-upload',
      exitCode: stats.failed > 0 ? 1 : 0
    };

    console.log(`Results uploaded for ${projectId}: ${run.stats.passed}/${run.stats.total} passed (source: ${run.source})`);

    res.json({ message: 'Results uploaded', run });
  } catch (err) {
    console.error('Error uploading results:', err);
    res.status(500).json({ error: 'Failed to upload results' });
  }
});

// Poll endpoint - returns latest update timestamp for efficient polling
app.get('/api/poll', async (req, res) => {
  const { since } = req.query;

  try {
    let query = 'SELECT MAX(timestamp) as latest FROM test_runs';
    const result = await db.query(query);

    const latest = result.rows[0]?.latest;
    const hasUpdates = since ? new Date(latest) > new Date(since) : false;

    res.json({
      latest: latest?.toISOString() || null,
      hasUpdates
    });
  } catch (err) {
    console.error('Error polling:', err);
    res.status(500).json({ error: 'Failed to poll' });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// Start server only if run directly (not imported for testing or Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Playwright Dashboard running on http://localhost:${PORT}`);
  });
}

// Export for Vercel and testing
module.exports = app;
