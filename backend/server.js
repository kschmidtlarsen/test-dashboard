const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3030;

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${clients.size}`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});

// Broadcast message to all connected clients
function broadcast(event, data) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

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
  'calify': 3020,
  'kanban': 3010,
  'test-dashboard': 3030,
  'shopping-list': 3040
};

// Display names
const PROJECT_NAMES = {
  'rental': 'Rental Platform',
  'crossfit-repo': 'CrossFit Generator',
  'ical-adjuster': 'iCal Adjuster',
  'calify': 'Calify Calendar Transformer',
  'kanban': 'Kanban Board',
  'test-dashboard': 'Playwright Dashboard',
  'shopping-list': 'Grablist Shopping List'
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

// Projects that cannot run tests from UI (self-testing, special cases)
const SELF_TEST_PROJECTS = ['test-dashboard'];

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
          const canRunFromUI = !SELF_TEST_PROJECTS.includes(dir);
          projects[dir] = {
            id: dir,
            name: PROJECT_NAMES[dir] || dir,
            path: backendPath,
            baseUrl: `http://192.168.0.120:${port}`,
            port,
            canRunFromUI
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

  // Check if project can run tests from UI
  if (!validation.project.canRunFromUI) {
    return res.status(400).json({
      error: `Tests for ${projectId} run via CI/CD pipeline, not from UI`,
      message: 'Results are uploaded automatically after CI/CD runs'
    });
  }

  const safeGrep = sanitizeGrep(grep);
  res.json({ message: 'Tests started', projectId });

  // Run tests in background (broadcasts tests:started with expectedTotal)
  runTestsForProject(projectId, validation.project, safeGrep).catch(err => {
    console.error(`Error running tests for ${projectId}:`, err);
    broadcast('tests:error', { projectId, error: err.message });
  });
});

// Run tests for all projects
app.post('/api/run-all', async (req, res) => {
  const { grep } = req.body;

  // Security: Sanitize grep parameter
  const safeGrep = sanitizeGrep(grep);

  const projects = await discoverProjects();
  // Filter to only projects that can run from UI
  const runnableProjects = Object.entries(projects)
    .filter(([, config]) => config.canRunFromUI);

  res.json({
    message: 'Running tests for all projects',
    projects: runnableProjects.map(([id]) => id),
    skipped: Object.keys(projects).filter(id => !projects[id].canRunFromUI)
  });

  for (const [projectId, config] of runnableProjects) {
    try {
      await runTestsForProject(projectId, config, safeGrep);
    } catch (err) {
      console.error(`Error running tests for ${projectId}:`, err);
    }
  }
});

// Upload test results (for CI/CD integration)
app.post('/api/upload/:projectId', async (req, res) => {
  const { projectId } = req.params;

  if (!isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  const { stats, suites, errors, source } = req.body;

  if (!stats || typeof stats !== 'object') {
    return res.status(400).json({ error: 'Invalid stats object' });
  }

  await ensureResultsDir();

  // Create run record
  const run = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    stats: {
      total: stats.total || 0,
      passed: stats.passed || 0,
      failed: stats.failed || 0,
      skipped: stats.skipped || 0,
      duration: stats.duration || 0
    },
    source: source || 'ci-upload',
    exitCode: stats.failed > 0 ? 1 : 0,
    suites: suites || [],
    errors: errors || []
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

  console.log(`Results uploaded for ${projectId}: ${run.stats.passed}/${run.stats.total} passed (source: ${run.source})`);

  // Broadcast results uploaded
  broadcast('results:uploaded', { projectId, run });

  res.json({ message: 'Results uploaded', run });
});

// Helper: Get total test count from Playwright
async function getTestCount(config, grep) {
  const args = ['playwright', 'test', '--list', '--reporter=json'];
  if (grep) {
    args.push('--grep', grep);
  }

  return new Promise((resolve) => {
    const child = spawn('npx', args, {
      cwd: config.path,
      env: { ...process.env, E2E_BASE_URL: config.baseUrl },
      timeout: 30000
    });

    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stdout += data; });

    child.on('close', () => {
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart !== -1) {
          const data = JSON.parse(stdout.substring(jsonStart));
          // Count tests in suites
          let count = 0;
          function countTests(suites) {
            for (const suite of suites || []) {
              for (const spec of suite.specs || []) {
                count += (spec.tests || []).length;
              }
              countTests(suite.suites);
            }
          }
          countTests(data.suites);
          resolve(count);
        } else {
          resolve(0);
        }
      } catch (err) {
        console.error('Failed to get test count:', err.message);
        resolve(0);
      }
    });

    child.on('error', () => resolve(0));
  });
}

// Function to run tests and save results
async function runTestsForProject(projectId, config, grep) {
  await ensureResultsDir();
  const startTime = Date.now();

  // Get expected test count first
  const expectedTotal = await getTestCount(config, grep);
  console.log(`Expected ${expectedTotal} tests for ${projectId}`);

  // Broadcast start with expected total
  broadcast('tests:started', {
    projectId,
    grep: grep || null,
    expectedTotal,
    startTime: new Date(startTime).toISOString()
  });

  // Build arguments for line reporter (for progress) + JSON (for final results)
  const args = ['playwright', 'test', '--reporter=line,json'];
  if (grep) {
    args.push('--grep', grep);
  }

  console.log(`Running tests for ${projectId}...`);
  console.log(`Command: npx ${args.join(' ')}`);

  // Track progress
  const progress = { passed: 0, failed: 0, skipped: 0, completed: 0 };
  const seenSkippedTests = new Set(); // Track test numbers we've counted as skipped

  // Use spawn with arguments array (no shell interpolation)
  const result = await new Promise((resolve) => {
    const child = spawn('npx', args, {
      cwd: config.path,
      env: { ...process.env, E2E_BASE_URL: config.baseUrl },
      timeout: 300000  // 5 minute timeout
    });

    let stdout = '';
    let stdoutBuffer = '';

    // Line reporter outputs to stdout (along with JSON at the end)
    // Parse stdout for progress indicators like [1/38]
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutBuffer += chunk;

      // Parse for progress - look for [N/M] pattern and failure indicators
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        // Strip ANSI escape codes for easier parsing
        const cleanLine = line.replace(/\x1b\[[0-9;]*[a-zA-Z]|\[\d+[A-Za-z]/g, '');

        // Detect failure indicators: "  1) [chromium]"
        // Playwright shows failures as numbered list: "1)", "2)", etc.
        const failureMatch = cleanLine.match(/^\s*(\d+)\)\s+\[/);
        if (failureMatch) {
          const failureNum = parseInt(failureMatch[1]);
          if (failureNum > progress.failed) {
            progress.failed = failureNum;
            // Recalculate passed
            progress.passed = progress.completed - progress.failed - progress.skipped;
            console.log(`[${projectId}] Failure detected: ${progress.failed} failed`);
            broadcast('tests:progress', { projectId, ...progress, expectedTotal });
          }
        }

        // Detect skipped tests - multiple patterns:
        // 1. Summary line: "X skipped"
        // 2. Individual skipped test with dash: "[N/M] -  [chromium]"
        // 3. Line contains "skipped" after progress marker
        const skippedCountMatch = cleanLine.match(/(\d+)\s+skipped/i);
        if (skippedCountMatch) {
          const skippedNum = parseInt(skippedCountMatch[1]);
          if (skippedNum > progress.skipped) {
            progress.skipped = skippedNum;
            progress.passed = progress.completed - progress.failed - progress.skipped;
            console.log(`[${projectId}] Skipped summary detected: ${progress.skipped} skipped`);
            broadcast('tests:progress', { projectId, ...progress, expectedTotal });
          }
        }

        // Detect individual skipped test: line with progress marker followed by "-" or contains "skipped"
        // Format: "[N/M] -  [browser]" or "[N/M] ... skipped" or "-  [browser]"
        // Extract test number to avoid double-counting
        const skipProgressMatch = cleanLine.match(/\[(\d+)\/\d+\]/);
        const isSkipLine = cleanLine.match(/\[\d+\/\d+\]\s*-\s+\[/) ||
                           cleanLine.match(/^\s*-\s+\[.*\]\s+›/) ||
                           (skipProgressMatch && cleanLine.toLowerCase().includes('skipped'));
        if (isSkipLine && skipProgressMatch) {
          const testNum = parseInt(skipProgressMatch[1]);
          if (!seenSkippedTests.has(testNum)) {
            seenSkippedTests.add(testNum);
            progress.skipped = seenSkippedTests.size;
            progress.passed = progress.completed - progress.failed - progress.skipped;
            console.log(`[${projectId}] Individual skip detected (test #${testNum}): ${progress.skipped} skipped`);
            broadcast('tests:progress', { projectId, ...progress, expectedTotal });
          }
        }

        // Line reporter format: "[1/38] [chromium] › file.spec.ts:10:5 › test name"
        const progressMatch = cleanLine.match(/\[(\d+)\/(\d+)\]/);
        if (progressMatch) {
          const current = parseInt(progressMatch[1]);
          const total = parseInt(progressMatch[2]);

          // Update completed count from progress indicator
          if (current > progress.completed) {
            progress.completed = current;
            // Calculate passed = completed - failed - skipped
            progress.passed = current - progress.failed - progress.skipped;
            console.log(`[${projectId}] Progress: ${progress.completed}/${total} (${progress.passed} passed, ${progress.failed} failed)`);
            broadcast('tests:progress', { projectId, ...progress, expectedTotal: total || expectedTotal });
          }
        }
      }
    });

    // Capture stderr for error messages
    child.stderr.on('data', (data) => {
      // stderr may contain error details, just append to output
      stdout += data;
    });

    child.on('close', (code) => {
      resolve({ stdout, exitCode: code || 0 });
    });

    child.on('error', (err) => {
      resolve({ stdout: err.message, exitCode: 1 });
    });
  });

  const stdout = result.stdout;
  const exitCode = result.exitCode;
  const duration = Date.now() - startTime;

  // Parse JSON output for final results
  let results;
  try {
    // Find JSON in output - look for the last complete JSON object
    const jsonStart = stdout.lastIndexOf('\n{');
    if (jsonStart !== -1) {
      const jsonCandidate = stdout.substring(jsonStart + 1);
      results = JSON.parse(jsonCandidate);
    } else {
      // Try from first {
      const firstJson = stdout.indexOf('{');
      if (firstJson !== -1) {
        results = JSON.parse(stdout.substring(firstJson));
      } else {
        throw new Error('No JSON found in output');
      }
    }
  } catch (parseErr) {
    console.error(`Failed to parse test output for ${projectId}:`, parseErr.message);
    results = {
      config: {},
      suites: [],
      errors: [stdout.substring(0, 500) || 'Failed to parse test output']
    };
  }

  // Use Playwright's summary stats (more accurate than counting individual test statuses)
  // Playwright's stats object contains: expected, unexpected, skipped, flaky
  // - expected = passed tests
  // - unexpected = failed tests
  // - skipped = programmatically skipped tests
  let stats;

  if (results.stats && typeof results.stats.expected === 'number') {
    // Use Playwright's built-in stats summary
    stats = {
      total: (results.stats.expected || 0) + (results.stats.unexpected || 0) + (results.stats.skipped || 0),
      passed: results.stats.expected || 0,
      failed: results.stats.unexpected || 0,
      skipped: results.stats.skipped || 0,
      duration
    };
    console.log(`Using Playwright summary stats: ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped`);
  } else {
    // Fallback: count individual test results
    stats = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration
    };

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
    console.log(`Using counted stats: ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped`);
  }

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

  // Broadcast tests completed
  broadcast('tests:completed', { projectId, run });

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
  server.listen(PORT, () => {
    console.log(`Playwright Dashboard running on http://localhost:${PORT}`);
    console.log(`WebSocket server ready for connections`);
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
