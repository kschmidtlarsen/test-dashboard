const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3030;

// Security: Disable X-Powered-By header to hide Express version
app.disable('x-powered-by');

// Middleware
// CORS is safe here - internal dashboard for test results
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Base path for projects on Pi cluster (configurable for testing)
const PROJECTS_BASE = process.env.PROJECTS_BASE || '/var/www';

// Known project configurations (port mappings)
const PROJECT_PORTS = {
  'rental': 3002,
  'crossfit-repo': 3000,
  'ical-adjuster': 3020,
  'kanban': 3010,
  'test-dashboard': 3030
};

// Display names
const PROJECT_NAMES = {
  'rental': 'Rental Platform',
  'crossfit-repo': 'CrossFit Generator',
  'ical-adjuster': 'iCal Adjuster',
  'kanban': 'Kanban Board',
  'test-dashboard': 'Test Dashboard'
};

// Results storage directory
const RESULTS_DIR = path.join(__dirname, 'results');

// Security: Validate projectId to prevent path traversal
function isValidProjectId(projectId) {
  // Only allow alphanumeric, dash, and underscore
  if (!projectId || typeof projectId !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(projectId);
}

// Security: Sanitize grep parameter to prevent command injection
function sanitizeGrep(grep) {
  if (!grep) return null;
  // Only allow alphanumeric, spaces, @, and common test tag characters
  const sanitized = grep.replace(/[^a-zA-Z0-9\s@_-]/g, '');
  return sanitized.length > 0 && sanitized.length <= 100 ? sanitized : null;
}

// Helper: Validate projectId and get project config (reduces duplication)
async function validateAndGetProject(projectId) {
  if (!isValidProjectId(projectId)) {
    return { error: 'Invalid project ID', status: 400 };
  }
  const projects = await discoverProjects();
  if (!projects[projectId]) {
    return { error: 'Project not found', status: 404 };
  }
  return { project: projects[projectId], projects };
}

// Helper: Read project results file (reduces duplication)
async function readProjectResults(projectId) {
  const resultsFile = path.join(RESULTS_DIR, `${projectId}.json`);
  const data = await fs.readFile(resultsFile, 'utf-8');
  return JSON.parse(data);
}

// Ensure results directory exists
async function ensureResultsDir() {
  try {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
  } catch (err) {
    // Directory exists
  }
}

// Discover projects dynamically
async function discoverProjects() {
  const projects = {};

  try {
    const dirs = await fs.readdir(PROJECTS_BASE);

    for (const dir of dirs) {
      // Skip self-testing - test-dashboard's E2E tests run in CI/CD, not from its own UI
      if (dir === 'test-dashboard') continue;

      const backendPath = path.join(PROJECTS_BASE, dir, 'backend');
      const e2ePath = path.join(backendPath, 'e2e');
      const playwrightConfig = path.join(backendPath, 'playwright.config.js');

      try {
        // Check if backend/e2e exists and has test files
        const e2eStats = await fs.stat(e2ePath);
        const configStats = await fs.stat(playwrightConfig);

        if (e2eStats.isDirectory() && configStats.isFile()) {
          const port = PROJECT_PORTS[dir] || 3000;
          projects[dir] = {
            id: dir,
            name: PROJECT_NAMES[dir] || dir,
            path: backendPath,
            baseUrl: `http://192.168.0.120:${port}`,
            port
          };
        }
      } catch (err) {
        // No e2e tests for this project
      }
    }
  } catch (err) {
    console.error('Error discovering projects:', err);
  }

  return projects;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'test-dashboard' });
});

// Get list of projects (dynamic discovery)
app.get('/api/projects', async (req, res) => {
  const projects = await discoverProjects();
  const projectList = Object.values(projects);
  res.json(projectList);
});

// Get test results for a project
app.get('/api/results/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const validation = await validateAndGetProject(projectId);
  if (validation.error) {
    return res.status(validation.status).json({ error: validation.error });
  }

  try {
    const data = await readProjectResults(projectId);
    res.json(data);
  } catch (err) {
    res.json({ runs: [], lastRun: null });
  }
});

// Get all results summary
app.get('/api/results', async (req, res) => {
  await ensureResultsDir();
  const projects = await discoverProjects();
  const summary = {};

  for (const [projectId, config] of Object.entries(projects)) {
    try {
      const resultsFile = path.join(RESULTS_DIR, `${projectId}.json`);
      const data = await fs.readFile(resultsFile, 'utf-8');
      const parsed = JSON.parse(data);
      summary[projectId] = {
        name: config.name,
        lastRun: parsed.lastRun,
        passed: parsed.lastRun?.stats?.passed || 0,
        failed: parsed.lastRun?.stats?.failed || 0,
        skipped: parsed.lastRun?.stats?.skipped || 0,
        total: parsed.lastRun?.stats?.total || 0,
        status: parsed.lastRun?.stats?.failed > 0 ? 'failed' :
                parsed.lastRun?.stats?.passed > 0 ? 'passed' : 'unknown'
      };
    } catch (err) {
      summary[projectId] = {
        name: config.name,
        lastRun: null,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        status: 'unknown'
      };
    }
  }

  res.json(summary);
});

// Run tests for a project
app.post('/api/run/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const { grep } = req.body;

  const validation = await validateAndGetProject(projectId);
  if (validation.error) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const safeGrep = sanitizeGrep(grep);
  res.json({ message: 'Tests started', projectId });

  // Run tests in background
  runTestsForProject(projectId, validation.project, safeGrep).catch(err => {
    console.error(`Error running tests for ${projectId}:`, err);
  });
});

// Run tests for all projects
app.post('/api/run-all', async (req, res) => {
  const { grep } = req.body;

  // Security: Sanitize grep parameter
  const safeGrep = sanitizeGrep(grep);

  const projects = await discoverProjects();

  res.json({ message: 'Running tests for all projects', projects: Object.keys(projects) });

  for (const [projectId, config] of Object.entries(projects)) {
    try {
      await runTestsForProject(projectId, config, safeGrep);
    } catch (err) {
      console.error(`Error running tests for ${projectId}:`, err);
    }
  }
});

// Function to run tests and save results
async function runTestsForProject(projectId, config, grep) {
  await ensureResultsDir();

  // Build arguments array (safe from shell injection)
  const args = ['playwright', 'test', '--reporter=json'];
  if (grep) {
    args.push('--grep', grep);  // Pass as separate argument, not interpolated
  }

  console.log(`Running tests for ${projectId}...`);
  console.log(`Command: npx ${args.join(' ')}`);

  // Use spawn with arguments array (no shell interpolation)
  const result = await new Promise((resolve) => {
    const child = spawn('npx', args, {
      cwd: config.path,
      env: { ...process.env, E2E_BASE_URL: config.baseUrl },
      timeout: 300000  // 5 minute timeout
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      resolve({ stdout: stdout + stderr, exitCode: code || 0 });
    });

    child.on('error', (err) => {
      resolve({ stdout: err.message, exitCode: 1 });
    });
  });

  const stdout = result.stdout;
  const exitCode = result.exitCode;

  // Parse JSON output
  let results;
  try {
    // Find JSON in output using indexOf (safe from ReDoS)
    const jsonStart = stdout.indexOf('{');
    if (jsonStart !== -1) {
      // Try to parse from the first { to the end
      const jsonCandidate = stdout.substring(jsonStart);
      results = JSON.parse(jsonCandidate);
    } else {
      throw new Error('No JSON found in output');
    }
  } catch (parseErr) {
    console.error(`Failed to parse test output for ${projectId}:`, parseErr.message);
    results = {
      config: {},
      suites: [],
      errors: [stdout.substring(0, 500) || 'Failed to parse test output']
    };
  }

  // Calculate stats
  const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: results.stats?.duration || 0
  };

  // Count results from suites
  function countResults(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          stats.total++;
          const status = test.results?.[0]?.status || 'unknown';
          if (status === 'passed' || status === 'expected') {
            stats.passed++;
          } else if (status === 'failed' || status === 'unexpected') {
            stats.failed++;
          } else if (status === 'skipped') {
            stats.skipped++;
          }
        }
      }
      countResults(suite.suites);
    }
  }
  countResults(results.suites);

  // Create run record
  const run = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    stats,
    grep: grep || null,
    exitCode,
    suites: results.suites || [],
    errors: results.errors || []
  };

  // Load existing results
  let existingData = { runs: [] };
  try {
    const existingFile = await fs.readFile(path.join(RESULTS_DIR, `${projectId}.json`), 'utf-8');
    existingData = JSON.parse(existingFile);
  } catch (err) {
    // File doesn't exist yet
  }

  // Add new run (keep last 20 runs)
  existingData.runs.unshift(run);
  existingData.runs = existingData.runs.slice(0, 20);
  existingData.lastRun = run;

  // Save results
  await fs.writeFile(
    path.join(RESULTS_DIR, `${projectId}.json`),
    JSON.stringify(existingData, null, 2)
  );

  console.log(`Tests completed for ${projectId}: ${stats.passed}/${stats.total} passed`);
  return run;
}

// Get test run history for a project
app.get('/api/history/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const validation = await validateAndGetProject(projectId);
  if (validation.error) {
    return res.status(validation.status).json({ error: validation.error });
  }

  try {
    const data = await readProjectResults(projectId);
    res.json(data.runs || []);
  } catch (err) {
    res.json([]);
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// Start server only if run directly (not imported for testing)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Test Dashboard running on http://localhost:${PORT}`);
    ensureResultsDir();

    // Log discovered projects on startup
    discoverProjects().then(projects => {
      console.log('Discovered projects:', Object.keys(projects));
    });
  });
}

// Export for testing
module.exports = {
  app,
  isValidProjectId,
  sanitizeGrep,
  validateAndGetProject,
  readProjectResults,
  discoverProjects,
  RESULTS_DIR
};
