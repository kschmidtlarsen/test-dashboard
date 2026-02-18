// API Base URL
const API_BASE = window.location.origin;

// Polling configuration
const POLL_INTERVAL = 30000; // 30 seconds
let pollInterval = null;
let lastUpdateTimestamp = null;

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

// Polling for updates
async function checkForUpdates() {
  try {
    const url = lastUpdateTimestamp
      ? `${API_BASE}/api/poll?since=${encodeURIComponent(lastUpdateTimestamp)}`
      : `${API_BASE}/api/poll`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.hasUpdates || !lastUpdateTimestamp) {
      lastUpdateTimestamp = data.latest;
      await loadResults();
      updateConnectionStatus(true);
    }
  } catch (err) {
    console.error('Polling error:', err);
    updateConnectionStatus(false);
  }
}

function startPolling() {
  if (!pollInterval) {
    pollInterval = setInterval(checkForUpdates, POLL_INTERVAL);
    updateConnectionStatus(true);
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.classList.toggle('connected', connected);
    statusEl.classList.toggle('disconnected', !connected);
    statusEl.title = connected ? 'Auto-refresh active (30s)' : 'Connection issue - click Refresh';
  }
}

// Initialize
async function init() {
  await loadProjects();
  await loadResults();
  setupEventListeners();
  startPolling();
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
    card.setAttribute('data-project-id', project.id);

    const statusClass = data.status === 'failed' ? 'status-failed' :
                        data.status === 'passed' ? 'status-passed' : 'status-unknown';
    const statusText = data.status || 'Unknown';

    const passed = data.passed || 0;
    const failed = data.failed || 0;
    const skipped = data.skipped || 0;
    const total = data.total || 0;

    const footerText = data.lastRun ? `Last run: ${formatDate(data.lastRun.timestamp)}` : 'Last run: Never';

    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-title">${project.name}</span>
        <span class="summary-card-status ${statusClass}">
          ${statusText}
        </span>
      </div>
      <div class="summary-card-stats">
        <div class="stat">
          <div class="stat-value passed">${passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat">
          <div class="stat-value failed">${failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat">
          <div class="stat-value skipped">${skipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat">
          <div class="stat-value total">${total}</div>
          <div class="stat-label">Total</div>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="last-run">${footerText}</span>
        <a href="https://github.com/kschmidtlarsen/${project.id}/actions/workflows/e2e-manual.yml"
           target="_blank"
           class="btn btn-sm btn-primary run-btn"
           title="Run tests via GitHub Actions">
          Run Tests ↗
        </a>
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
        div.setAttribute('data-results-project', project.id);
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
      div.setAttribute('data-results-project', project.id);
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
        <p>Run tests via GitHub Actions to see results here.</p>
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

// Open GitHub Actions to run all tests
function runAllTests() {
  window.open('https://github.com/kschmidtlarsen?tab=repositories', '_blank');
  showToast('Opening GitHub - select a repo and run the E2E workflow', 'info');
}

// Setup event listeners
function setupEventListeners() {
  runAllBtn.addEventListener('click', runAllTests);
  refreshBtn.addEventListener('click', async () => {
    showToast('Refreshing...', 'info');
    await loadResults();
    showToast('Results refreshed', 'success');
  });
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
window.toggleProject = toggleProject;
window.toggleTestDetails = toggleTestDetails;

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
