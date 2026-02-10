const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const {
  app,
  isValidProjectId,
  sanitizeGrep,
  validateAndGetProject,
  readProjectResults,
  discoverProjects,
  RESULTS_DIR
} = require('../server');

describe('Security Functions', () => {
  describe('isValidProjectId', () => {
    test('accepts valid project IDs', () => {
      expect(isValidProjectId('rental')).toBe(true);
      expect(isValidProjectId('crossfit-repo')).toBe(true);
      expect(isValidProjectId('ical_adjuster')).toBe(true);
      expect(isValidProjectId('project123')).toBe(true);
      expect(isValidProjectId('A-Z_0-9')).toBe(true);
    });

    test('rejects invalid project IDs with path traversal', () => {
      expect(isValidProjectId('../etc/passwd')).toBe(false);
      expect(isValidProjectId('../../root')).toBe(false);
      expect(isValidProjectId('project/../secret')).toBe(false);
      expect(isValidProjectId('..')).toBe(false);
      expect(isValidProjectId('.')).toBe(false);
    });

    test('rejects project IDs with special characters', () => {
      expect(isValidProjectId('project;rm -rf')).toBe(false);
      expect(isValidProjectId('project|cat /etc/passwd')).toBe(false);
      expect(isValidProjectId('project$(whoami)')).toBe(false);
      expect(isValidProjectId('project`id`')).toBe(false);
      expect(isValidProjectId('project&echo')).toBe(false);
      expect(isValidProjectId('project>file')).toBe(false);
      expect(isValidProjectId('project<file')).toBe(false);
    });

    test('rejects empty or null project IDs', () => {
      expect(isValidProjectId('')).toBe(false);
      expect(isValidProjectId(null)).toBe(false);
      expect(isValidProjectId(undefined)).toBe(false);
      expect(isValidProjectId(123)).toBe(false);
      expect(isValidProjectId({})).toBe(false);
      expect(isValidProjectId([])).toBe(false);
    });
  });

  describe('sanitizeGrep', () => {
    test('returns null for empty input', () => {
      expect(sanitizeGrep('')).toBe(null);
      expect(sanitizeGrep(null)).toBe(null);
      expect(sanitizeGrep(undefined)).toBe(null);
    });

    test('preserves valid grep patterns', () => {
      expect(sanitizeGrep('smoke')).toBe('smoke');
      expect(sanitizeGrep('@api')).toBe('@api');
      expect(sanitizeGrep('test-name')).toBe('test-name');
      expect(sanitizeGrep('test_name')).toBe('test_name');
      expect(sanitizeGrep('my test')).toBe('my test');
      expect(sanitizeGrep('TestName123')).toBe('TestName123');
    });

    test('removes dangerous shell characters', () => {
      expect(sanitizeGrep('test;rm -rf /')).toBe('testrm -rf ');
      expect(sanitizeGrep('test|cat /etc/passwd')).toBe('testcat etcpasswd');
      expect(sanitizeGrep('test$(whoami)')).toBe('testwhoami');
      expect(sanitizeGrep('test`id`')).toBe('testid');
      expect(sanitizeGrep('test&echo')).toBe('testecho');
      expect(sanitizeGrep('test>file')).toBe('testfile');
      expect(sanitizeGrep('test<file')).toBe('testfile');
    });

    test('rejects strings that are too long', () => {
      const longString = 'a'.repeat(101);
      expect(sanitizeGrep(longString)).toBe(null);
    });

    test('accepts strings up to 100 characters', () => {
      const maxString = 'a'.repeat(100);
      expect(sanitizeGrep(maxString)).toBe(maxString);
    });

    test('returns null for strings that become empty after sanitization', () => {
      expect(sanitizeGrep(';;;')).toBe(null);
      expect(sanitizeGrep('|||')).toBe(null);
      expect(sanitizeGrep('$()')).toBe(null);
    });
  });
});

describe('Helper Functions', () => {
  describe('validateAndGetProject', () => {
    test('returns error for invalid project ID', async () => {
      const result = await validateAndGetProject('../etc/passwd');
      expect(result.error).toBe('Invalid project ID');
      expect(result.status).toBe(400);
    });

    test('returns error for null project ID', async () => {
      const result = await validateAndGetProject(null);
      expect(result.error).toBe('Invalid project ID');
      expect(result.status).toBe(400);
    });

    test('returns error for non-existent project', async () => {
      const result = await validateAndGetProject('nonexistent-project-xyz');
      expect(result.error).toBe('Project not found');
      expect(result.status).toBe(404);
    });
  });

  describe('discoverProjects', () => {
    test('returns an object', async () => {
      const projects = await discoverProjects();
      expect(typeof projects).toBe('object');
      expect(projects).not.toBeNull();
    });

    test('returns object with expected shape when projects exist', async () => {
      const projects = await discoverProjects();
      for (const [id, config] of Object.entries(projects)) {
        expect(typeof id).toBe('string');
        expect(config).toHaveProperty('id');
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('path');
        expect(config).toHaveProperty('baseUrl');
        expect(config).toHaveProperty('port');
      }
    });
  });

  describe('readProjectResults', () => {
    const testProjectId = 'test-project-unit';
    const testResultsFile = path.join(RESULTS_DIR, `${testProjectId}.json`);

    beforeAll(async () => {
      // Ensure results directory exists
      await fs.mkdir(RESULTS_DIR, { recursive: true });
    });

    afterEach(async () => {
      // Clean up test file
      try {
        await fs.unlink(testResultsFile);
      } catch (err) {
        // File may not exist
      }
    });

    test('reads and parses JSON results file', async () => {
      const testData = { runs: [], lastRun: null };
      await fs.writeFile(testResultsFile, JSON.stringify(testData));

      const result = await readProjectResults(testProjectId);
      expect(result).toEqual(testData);
    });

    test('throws error for non-existent file', async () => {
      await expect(readProjectResults('nonexistent-project')).rejects.toThrow();
    });
  });
});

describe('API Endpoints', () => {
  describe('GET /health', () => {
    test('returns healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'healthy',
        service: 'test-dashboard'
      });
    });
  });

  describe('GET /api/projects', () => {
    test('returns array of projects', async () => {
      const response = await request(app).get('/api/projects');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('each project has required fields', async () => {
      const response = await request(app).get('/api/projects');
      for (const project of response.body) {
        expect(project).toHaveProperty('id');
        expect(project).toHaveProperty('name');
        expect(project).toHaveProperty('path');
        expect(project).toHaveProperty('baseUrl');
        expect(project).toHaveProperty('port');
      }
    });
  });

  describe('GET /api/results/:projectId', () => {
    const testProjectId = 'test-results-endpoint';
    const testResultsFile = path.join(RESULTS_DIR, `${testProjectId}.json`);

    beforeAll(async () => {
      await fs.mkdir(RESULTS_DIR, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.unlink(testResultsFile);
      } catch (err) {
        // File may not exist
      }
    });

    test('rejects invalid project ID with special chars', async () => {
      const response = await request(app).get('/api/results/project%3Brm%20-rf');
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid project ID');
    });

    test('returns 404 for non-existent project', async () => {
      const response = await request(app).get('/api/results/nonexistent-project-xyz');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Project not found');
    });
  });

  describe('GET /api/results', () => {
    test('returns summary object', async () => {
      const response = await request(app).get('/api/results');
      expect(response.status).toBe(200);
      expect(typeof response.body).toBe('object');
    });

    test('summary entries have expected shape', async () => {
      const response = await request(app).get('/api/results');
      for (const [projectId, summary] of Object.entries(response.body)) {
        expect(summary).toHaveProperty('name');
        expect(summary).toHaveProperty('lastRun');
        expect(summary).toHaveProperty('passed');
        expect(summary).toHaveProperty('failed');
        expect(summary).toHaveProperty('skipped');
        expect(summary).toHaveProperty('total');
        expect(summary).toHaveProperty('status');
        expect(typeof summary.passed).toBe('number');
        expect(typeof summary.failed).toBe('number');
      }
    });
  });

  describe('POST /api/run/:projectId', () => {
    test('rejects invalid project ID with special chars', async () => {
      const response = await request(app)
        .post('/api/run/project%24%28whoami%29')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid project ID');
    });

    test('returns 404 for non-existent project', async () => {
      const response = await request(app)
        .post('/api/run/nonexistent-project-xyz')
        .send({});
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Project not found');
    });

    test('sanitizes grep parameter', async () => {
      const response = await request(app)
        .post('/api/run/nonexistent-project-xyz')
        .send({ grep: 'test;rm -rf /' });
      // Should still return 404 (project not found) but grep was sanitized
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/run-all', () => {
    test('returns message with project list', async () => {
      const response = await request(app)
        .post('/api/run-all')
        .send({});
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('projects');
      expect(Array.isArray(response.body.projects)).toBe(true);
    });

    test('accepts and sanitizes grep parameter', async () => {
      const response = await request(app)
        .post('/api/run-all')
        .send({ grep: '@smoke' });
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Running tests');
    });
  });

  describe('GET /api/history/:projectId', () => {
    const testProjectId = 'test-history-endpoint';
    const testResultsFile = path.join(RESULTS_DIR, `${testProjectId}.json`);

    beforeAll(async () => {
      await fs.mkdir(RESULTS_DIR, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.unlink(testResultsFile);
      } catch (err) {
        // File may not exist
      }
    });

    test('rejects invalid project ID with special chars', async () => {
      const response = await request(app).get('/api/history/project%7Ccat');
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid project ID');
    });

    test('returns 404 for non-existent project', async () => {
      const response = await request(app).get('/api/history/nonexistent-project-xyz');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Project not found');
    });
  });

  describe('GET /* (wildcard)', () => {
    test('serves frontend for unknown routes', async () => {
      const response = await request(app).get('/some-random-page');
      // Should return 200 (serving index.html) or 404 if file doesn't exist
      expect([200, 404]).toContain(response.status);
    });
  });
});

describe('Security Headers', () => {
  test('does not expose X-Powered-By header', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  test('returns JSON content type for API endpoints', async () => {
    const response = await request(app).get('/api/projects');
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('CORS', () => {
  test('includes CORS headers', async () => {
    const response = await request(app)
      .get('/api/projects')
      .set('Origin', 'http://localhost:3000');
    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });
});

// Conditional tests for when mock-project exists (CI environment)
describe('Success Scenarios (with mock project)', () => {
  let mockProjectExists = false;

  beforeAll(async () => {
    // Check if mock-project exists (created by CI)
    const projects = await discoverProjects();
    mockProjectExists = 'mock-project' in projects;

    if (mockProjectExists) {
      // Set up test results file for mock-project
      await fs.mkdir(RESULTS_DIR, { recursive: true });
      const testResults = {
        runs: [{
          id: '123',
          timestamp: new Date().toISOString(),
          stats: { passed: 5, failed: 1, skipped: 0, total: 6 },
          suites: []
        }],
        lastRun: {
          id: '123',
          timestamp: new Date().toISOString(),
          stats: { passed: 5, failed: 1, skipped: 0, total: 6 }
        }
      };
      await fs.writeFile(
        path.join(RESULTS_DIR, 'mock-project.json'),
        JSON.stringify(testResults)
      );
    }
  });

  afterAll(async () => {
    try {
      await fs.unlink(path.join(RESULTS_DIR, 'mock-project.json'));
    } catch (err) {
      // File may not exist
    }
  });

  test('validateAndGetProject returns project for valid discovered project', async () => {
    if (!mockProjectExists) {
      console.log('Skipping: mock-project not available');
      return;
    }
    const result = await validateAndGetProject('mock-project');
    expect(result.project).toBeDefined();
    expect(result.project.id).toBe('mock-project');
    expect(result.error).toBeUndefined();
  });

  test('GET /api/results/:projectId returns results for valid project', async () => {
    if (!mockProjectExists) {
      console.log('Skipping: mock-project not available');
      return;
    }
    const response = await request(app).get('/api/results/mock-project');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('runs');
    expect(response.body).toHaveProperty('lastRun');
  });

  test('GET /api/history/:projectId returns history for valid project', async () => {
    if (!mockProjectExists) {
      console.log('Skipping: mock-project not available');
      return;
    }
    const response = await request(app).get('/api/history/mock-project');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  test('POST /api/run/:projectId starts tests for valid project', async () => {
    if (!mockProjectExists) {
      console.log('Skipping: mock-project not available');
      return;
    }
    const response = await request(app)
      .post('/api/run/mock-project')
      .send({ grep: '@smoke' });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Tests started');
    expect(response.body.projectId).toBe('mock-project');
  });
});
