const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3030;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Base path for projects on Pi cluster
const PROJECTS_BASE = '/var/www';

// Known project configurations (port mappings)
const PROJECT_PORTS = {
  'rental': 3002,
  'crossfit-repo': 3000,
  'ical-adjuster': 3020,
  'kanban': 3010
};

// Display names
const PROJECT_NAMES = {
  'rental': 'Rental Platform',
  'crossfit-repo': 'CrossFit Generator',
  'ical-adjuster': 'iCal Adjuster',
  'kanban': 'Kanban Board'
};

// Results storage directory
const RESULTS_DIR = path.join(__dirname, 'results');

// Security: Validate projectId to prevent path traversal
function isValidProjectId(projectId) {
  // Only allow alphanumeric, dash, and underscore
  return /^[a-zA-Z0-9_-]+$/.test(projectId);
}

// Security: Sanitize grep parameter to prevent command injection
function sanitizeGrep(grep) {
  if (!grep) return null;
  // Only allow alphanumeric, spaces, @, and common test tag characters
  const sanitized = grep.replace(/[^a-zA-Z0-9\s@_-]/g, '');
  return sanitized.length > 0 && sanitized.length <= 100 ? sanitized : null;
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

  // Security: Validate projectId to prevent path traversal
  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  // Security: Verify project exists in discovered projects
  const projects = await discoverProjects();
  if (!projects[projectId]) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const resultsFile = path.join(RESULTS_DIR, `${projectId}.json`);
    const data = await fs.readFile(resultsFile, 'utf-8');
    res.json(JSON.parse(data));
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

  // Security: Validate projectId
  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  const projects = await discoverProjects();
  const config = projects[projectId];

  if (!config) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Security: Sanitize grep parameter
  const safeGrep = sanitizeGrep(grep);

  res.json({ message: 'Tests started', projectId });

  // Run tests in background
  runTestsForProject(projectId, config, safeGrep).catch(err => {
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

  const grepArg = grep ? `--grep "${grep}"` : '';
  const cmd = `cd ${config.path} && E2E_BASE_URL=${config.baseUrl} npx playwright test --reporter=json ${grepArg} 2>&1`;

  console.log(`Running tests for ${projectId}...`);
  console.log(`Command: ${cmd}`);

  let stdout = '';
  let exitCode = 0;

  try {
    const result = await execAsync(cmd, {
      maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for large outputs
      timeout: 300000  // 5 minute timeout
    });
    stdout = result.stdout;
  } catch (err) {
    // exec throws on non-zero exit code, but we still get stdout
    stdout = err.stdout || '';
    exitCode = err.code || 1;
  }

  // Parse JSON output
  let results;
  try {
    // Find JSON in output (might have other text around it)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      results = JSON.parse(jsonMatch[0]);
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

  // Security: Validate projectId to prevent path traversal
  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  // Security: Verify project exists in discovered projects
  const projects = await discoverProjects();
  if (!projects[projectId]) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const resultsFile = path.join(RESULTS_DIR, `${projectId}.json`);
    const data = await fs.readFile(resultsFile, 'utf-8');
    const parsed = JSON.parse(data);
    res.json(parsed.runs || []);
  } catch (err) {
    res.json([]);
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Test Dashboard running on http://localhost:${PORT}`);
  ensureResultsDir();

  // Log discovered projects on startup
  discoverProjects().then(projects => {
    console.log('Discovered projects:', Object.keys(projects));
  });
});
