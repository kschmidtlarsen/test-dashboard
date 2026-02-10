// API Base URL
const API_BASE = window.location.origin;

// State
let projects = [];
let results = {};
let expandedProjects = new Set();
let expandedTests = new Set();

// DOM Elements
const summaryCards = document.getElementById('summaryCards');
const resultsContainer = document.getElementById('resultsContainer');
const historyContainer = document.getElementById('historyContainer');
const projectFilter = document.getElementById('projectFilter');
const statusFilter = document.getElementById('statusFilter');
const runAllBtn = document.getElementById('runAllBtn');
const refreshBtn = document.getElementById('refreshBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

// Initialize
async function init() {
  await loadProjects();
  await loadResults();
  setupEventListeners();
}

// Load projects
async function loadProjects() {
  try {
    const res = await fetch(`${API_BASE}/api/projects`);
    projects = await res.json();

    // Populate project filter
    projectFilter.innerHTML = '<option value="all">All Projects</option>';
    projects.forEach(p => {
      projectFilter.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
  } catch (err) {
    showToast('Failed to load projects', 'error');
  }
}

// Load all results
async function loadResults() {
  try {
    const res = await fetch(`${API_BASE}/api/results`);
    results = await res.json();
    renderSummaryCards();
    renderResults();
    renderHistory();
  } catch (err) {
    showToast('Failed to load results', 'error');
  }
}

// Render summary cards
function renderSummaryCards() {
  summaryCards.innerHTML = '';

  for (const project of projects) {
    const data = results[project.id] || {};
    const card = document.createElement('div');
    card.className = 'summary-card';

    const statusClass = data.status === 'failed' ? 'status-failed' :
                        data.status === 'passed' ? 'status-passed' : 'status-unknown';

    const lastRunText = data.lastRun ?
      formatDate(data.lastRun.timestamp) : 'Never run';

    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-title">${project.name}</span>
        <span class="summary-card-status ${statusClass}">
          ${data.status || 'Unknown'}
        </span>
      </div>
      <div class="summary-card-stats">
        <div class="stat">
          <div class="stat-value passed">${data.passed || 0}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat">
          <div class="stat-value failed">${data.failed || 0}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat">
          <div class="stat-value skipped">${data.skipped || 0}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat">
          <div class="stat-value total">${data.total || 0}</div>
          <div class="stat-label">Total</div>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="last-run">Last run: ${lastRunText}</span>
        <button class="btn btn-sm btn-primary" onclick="runTests('${project.id}')">
          Run Tests
        </button>
      </div>
    `;

    summaryCards.appendChild(card);
  }
}

// Render detailed results
async function renderResults() {
  resultsContainer.innerHTML = '';

  const selectedProject = projectFilter.value;
  const selectedStatus = statusFilter.value;

  const projectsToShow = selectedProject === 'all' ?
    projects : projects.filter(p => p.id === selectedProject);

  for (const project of projectsToShow) {
    try {
      const res = await fetch(`${API_BASE}/api/results/${project.id}`);
      const data = await res.json();

      if (!data.lastRun) {
        const div = document.createElement('div');
        div.className = 'project-results';
        div.innerHTML = `
          <div class="project-header">
            <span class="project-name">${project.name}</span>
            <span class="project-summary">No tests run yet</span>
          </div>
        `;
        resultsContainer.appendChild(div);
        continue;
      }

      const tests = extractTests(data.lastRun.suites, selectedStatus);
      const isExpanded = expandedProjects.has(project.id);

      const div = document.createElement('div');
      div.className = 'project-results';
      div.innerHTML = `
        <div class="project-header" onclick="toggleProject('${project.id}')">
          <span class="project-name">${project.name}</span>
          <div class="project-summary">
            <span style="color: var(--success)">✓ ${data.lastRun.stats.passed}</span>
            <span style="color: var(--error)">✗ ${data.lastRun.stats.failed}</span>
            <span style="color: var(--warning)">○ ${data.lastRun.stats.skipped}</span>
          </div>
        </div>
        <div class="test-list ${isExpanded ? 'expanded' : ''}" id="tests-${project.id}">
          ${tests.map((t, idx) => {
            const testId = `${project.id}-test-${idx}`;
            const isTestExpanded = expandedTests.has(testId);
            return `
              <div class="test-item-wrapper">
                <div class="test-item" onclick="toggleTestDetails('${testId}')">
                  <div class="test-name">
                    <span class="test-status-icon ${t.status}">${getStatusIcon(t.status)}</span>
                    <span>${t.title}</span>
                  </div>
                  <div class="test-meta">
                    <span class="test-duration">${t.duration}ms</span>
                    ${t.description ? '<span class="test-info-icon" title="Click for details">ℹ</span>' : ''}
                  </div>
                </div>
                <div class="test-details ${isTestExpanded ? 'expanded' : ''}" id="details-${testId}">
                  ${t.description ? `
                    <div class="test-description">
                      <strong>What this test does:</strong>
                      <p>${t.description}</p>
                    </div>
                  ` : ''}
                  ${t.file ? `<div class="test-file"><strong>File:</strong> ${t.file}:${t.line}</div>` : ''}
                  ${t.errors && t.errors.length > 0 ? `
                    <div class="test-errors">
                      <strong>Errors:</strong>
                      <pre>${t.errors.map(e => e.message || e).join('\n')}</pre>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      resultsContainer.appendChild(div);
    } catch (err) {
      console.error(`Failed to load results for ${project.id}:`, err);
    }
  }

  if (resultsContainer.innerHTML === '') {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p>No test results available</p>
        <button class="btn btn-primary" onclick="runAllTests()">Run Tests</button>
      </div>
    `;
  }
}

// Extract tests from suites
function extractTests(suites, statusFilter) {
  const tests = [];

  function traverse(suites, prefix = '') {
    for (const suite of suites || []) {
      const suiteName = prefix ? `${prefix} > ${suite.title}` : suite.title;

      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const result = test.results?.[0];
          const status = result?.status || 'unknown';
          const normalizedStatus = status === 'expected' ? 'passed' :
                                   status === 'unexpected' ? 'failed' : status;

          if (statusFilter === 'all' || normalizedStatus === statusFilter) {
            // Extract description from annotations
            const descAnnotation = test.annotations?.find(a => a.type === 'description');
            const description = descAnnotation?.description || null;

            tests.push({
              title: `${suiteName} > ${spec.title}`,
              status: normalizedStatus,
              duration: result?.duration || 0,
              description: description,
              file: spec.file || null,
              line: spec.line || null,
              errors: result?.errors || []
            });
          }
        }
      }

      traverse(suite.suites, suiteName);
    }
  }

  traverse(suites);
  return tests;
}

// Toggle test details
function toggleTestDetails(testId) {
  if (expandedTests.has(testId)) {
    expandedTests.delete(testId);
  } else {
    expandedTests.add(testId);
  }

  const details = document.getElementById(`details-${testId}`);
  if (details) {
    details.classList.toggle('expanded');
  }
}

// Render history
async function renderHistory() {
  historyContainer.innerHTML = '';

  const allHistory = [];

  for (const project of projects) {
    try {
      const res = await fetch(`${API_BASE}/api/history/${project.id}`);
      const runs = await res.json();

      for (const run of runs.slice(0, 5)) {
        allHistory.push({
          project: project.name,
          projectId: project.id,
          ...run
        });
      }
    } catch (err) {
      console.error(`Failed to load history for ${project.id}:`, err);
    }
  }

  // Sort by timestamp descending
  allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const run of allHistory.slice(0, 10)) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-card-header">
        <span class="history-project">${run.project}</span>
        <span class="history-time">${formatDate(run.timestamp)}</span>
      </div>
      <div class="history-stats">
        <span style="color: var(--success)">✓ ${run.stats.passed}</span>
        <span style="color: var(--error)">✗ ${run.stats.failed}</span>
        <span style="color: var(--warning)">○ ${run.stats.skipped}</span>
      </div>
    `;
    historyContainer.appendChild(card);
  }

  if (allHistory.length === 0) {
    historyContainer.innerHTML = `
      <div class="empty-state">
        <p>No test history available</p>
      </div>
    `;
  }
}

// Toggle project expansion
function toggleProject(projectId) {
  if (expandedProjects.has(projectId)) {
    expandedProjects.delete(projectId);
  } else {
    expandedProjects.add(projectId);
  }

  const testList = document.getElementById(`tests-${projectId}`);
  if (testList) {
    testList.classList.toggle('expanded');
  }
}

// Run tests for a single project
async function runTests(projectId) {
  showLoading(true);

  try {
    const res = await fetch(`${API_BASE}/api/run/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to start tests', 'error');
      showLoading(false);
      return;
    }

    showToast(`Tests started for ${projectId}`, 'success');

    // Poll for results
    await pollForResults(projectId);
  } catch (err) {
    showToast('Failed to start tests', 'error');
  } finally {
    showLoading(false);
  }
}

// Run all tests
async function runAllTests() {
  showLoading(true);

  try {
    await fetch(`${API_BASE}/api/run-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    showToast('Running tests for all projects...', 'success');

    // Wait and reload
    setTimeout(async () => {
      await loadResults();
      showLoading(false);
    }, 30000); // Wait 30 seconds then refresh

  } catch (err) {
    showToast('Failed to start tests', 'error');
    showLoading(false);
  }
}

// Poll for results
async function pollForResults(projectId) {
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;

    try {
      const res = await fetch(`${API_BASE}/api/results/${projectId}`);
      const data = await res.json();

      if (data.lastRun) {
        await loadResults();
        showToast(`Tests completed: ${data.lastRun.stats.passed}/${data.lastRun.stats.total} passed`, 'success');
        return;
      }
    } catch (err) {
      // Continue polling
    }
  }

  await loadResults();
}

// Setup event listeners
function setupEventListeners() {
  runAllBtn.addEventListener('click', runAllTests);
  refreshBtn.addEventListener('click', loadResults);
  projectFilter.addEventListener('change', renderResults);
  statusFilter.addEventListener('change', renderResults);
}

// Utility functions
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusIcon(status) {
  switch (status) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'skipped': return '○';
    default: return '?';
  }
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// Make functions available globally
window.runTests = runTests;
window.runAllTests = runAllTests;
window.toggleProject = toggleProject;
window.toggleTestDetails = toggleTestDetails;

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
