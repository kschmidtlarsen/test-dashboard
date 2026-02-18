#!/usr/bin/env node
/**
 * Upload E2E test results to the Test Dashboard
 *
 * Usage:
 *   node scripts/upload-results.js [dashboard-url]
 *
 * This script:
 * 1. Runs Playwright E2E tests with JSON reporter
 * 2. Parses the results
 * 3. Uploads them to the Test Dashboard API
 *
 * Environment variables:
 *   E2E_BASE_URL - URL to test against (default: http://localhost:3030)
 *   DASHBOARD_URL - Test Dashboard API URL (default: http://192.168.0.120:3030)
 */

const { spawn } = require('child_process');
const path = require('path');

const DASHBOARD_URL = process.argv[2] || process.env.DASHBOARD_URL || 'https://playwright.vercel.app';
const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3030';
const PROJECT_ID = process.env.PROJECT_ID || 'playwright-dashboard';

async function runTests() {
  console.log(`Running E2E tests against ${E2E_BASE_URL}...`);

  return new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', '--reporter=json'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, E2E_BASE_URL },
      timeout: 300000
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
}

function parseResults(output) {
  try {
    const jsonStart = output.indexOf('{');
    if (jsonStart !== -1) {
      const jsonCandidate = output.substring(jsonStart);
      return JSON.parse(jsonCandidate);
    }
    throw new Error('No JSON found in output');
  } catch (err) {
    console.error('Failed to parse test output:', err.message);
    return {
      config: {},
      suites: [],
      errors: [output.substring(0, 500) || 'Failed to parse test output']
    };
  }
}

function countResults(suites) {
  const stats = { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 };

  function count(suiteList) {
    for (const suite of suiteList || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          stats.total++;
          const status = test.results?.[0]?.status || 'unknown';
          const duration = test.results?.[0]?.duration || 0;
          stats.duration += duration;

          if (status === 'passed' || status === 'expected') {
            stats.passed++;
          } else if (status === 'failed' || status === 'unexpected') {
            stats.failed++;
          } else if (status === 'skipped') {
            stats.skipped++;
          }
        }
      }
      count(suite.suites);
    }
  }

  count(suites);
  return stats;
}

async function uploadResults(stats, suites, errors) {
  console.log(`Uploading results to ${DASHBOARD_URL}/api/upload/${PROJECT_ID}...`);

  const response = await fetch(`${DASHBOARD_URL}/api/upload/${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stats,
      suites,
      errors,
      source: process.env.CI ? 'github-actions' : 'local'
    })
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  try {
    // Run tests
    const { stdout, exitCode } = await runTests();

    // Parse results
    const results = parseResults(stdout);
    const stats = countResults(results.suites);
    stats.duration = results.stats?.duration || stats.duration;

    console.log(`\nTest Results: ${stats.passed}/${stats.total} passed`);
    if (stats.failed > 0) {
      console.log(`  Failed: ${stats.failed}`);
    }
    if (stats.skipped > 0) {
      console.log(`  Skipped: ${stats.skipped}`);
    }

    // Upload to dashboard
    const uploadResult = await uploadResults(stats, results.suites, results.errors);
    console.log(`\nResults uploaded successfully!`);
    console.log(`  Run ID: ${uploadResult.run?.id}`);
    console.log(`  Timestamp: ${uploadResult.run?.timestamp}`);

    process.exit(exitCode);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
