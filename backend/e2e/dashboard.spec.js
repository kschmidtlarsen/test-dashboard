const { test, expect } = require('@playwright/test');

test.describe('Test Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the dashboard with correct title', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the page title is "E2E Test Dashboard" and the header h1 element displays the same text.'
    });
    await expect(page).toHaveTitle('E2E Test Dashboard');
    await expect(page.locator('header h1')).toHaveText('E2E Test Dashboard');
  });

  test('should display header action buttons', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Checks that the "Run All Tests" button (#runAllBtn) and "Refresh" button (#refreshBtn) are visible in the header.'
    });
    await expect(page.locator('#runAllBtn')).toBeVisible();
    await expect(page.locator('#refreshBtn')).toBeVisible();
  });

  test('should display overview section', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the Overview section exists with an h2 heading and the summary cards container (#summaryCards) is visible.'
    });
    await expect(page.locator('section.summary-section h2')).toHaveText('Overview');
    await expect(page.locator('#summaryCards')).toBeVisible();
  });

  test('should display test results section with filters', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Checks that the Test Results section has an h2 heading and both the project filter (#projectFilter) and status filter (#statusFilter) dropdowns are visible.'
    });
    await expect(page.locator('section.details-section h2')).toHaveText('Test Results');
    await expect(page.locator('#projectFilter')).toBeVisible();
    await expect(page.locator('#statusFilter')).toBeVisible();
  });

  test('should display run history section', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the Run History section exists with an h2 heading and the history container (#historyContainer) is visible.'
    });
    await expect(page.locator('section.history-section h2')).toHaveText('Run History');
    await expect(page.locator('#historyContainer')).toBeVisible();
  });

  test('project filter should have "All Projects" option', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Checks that the project filter dropdown contains an "All Projects" option with value="all".'
    });
    const option = page.locator('#projectFilter option[value="all"]');
    await expect(option).toHaveText('All Projects');
  });

  test('status filter should have all status options', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the status filter dropdown contains all four options: All Status, Passed, Failed, and Skipped.'
    });
    await expect(page.locator('#statusFilter option[value="all"]')).toHaveText('All Status');
    await expect(page.locator('#statusFilter option[value="passed"]')).toHaveText('Passed');
    await expect(page.locator('#statusFilter option[value="failed"]')).toHaveText('Failed');
    await expect(page.locator('#statusFilter option[value="skipped"]')).toHaveText('Skipped');
  });
});

test.describe('Project Accordion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for results to load
    await page.waitForSelector('#resultsContainer', { timeout: 5000 });
  });

  test('should expand project when header is clicked', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Tests the accordion toggle behavior: 1) Finds project headers, 2) Clicks to expand and verifies .expanded class is added, 3) Clicks again to collapse and verifies .expanded class is removed.'
    });
    // Check if there are any project results
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      // Get the first project's test list
      const firstHeader = projectHeaders.first();
      const projectId = await firstHeader.evaluate(el => {
        const onclick = el.getAttribute('onclick');
        return onclick ? onclick.match(/toggleProject\('([^']+)'\)/)?.[1] : null;
      });

      if (projectId) {
        const testList = page.locator(`#tests-${projectId}`);

        // Initially should not have expanded class
        await expect(testList).not.toHaveClass(/expanded/);

        // Click to expand
        await firstHeader.click();

        // Should now have expanded class
        await expect(testList).toHaveClass(/expanded/);

        // Click again to collapse
        await firstHeader.click();

        // Should not have expanded class anymore
        await expect(testList).not.toHaveClass(/expanded/);
      }
    }
  });

  test('expanded accordion should show all tests without overflow', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the CSS fix for accordion overflow: 1) Expands a project, 2) Checks that max-height is "none" (not a fixed value), 3) Checks that overflow is "visible" (not hidden/clipped).'
    });
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      const firstHeader = projectHeaders.first();

      // Click to expand
      await firstHeader.click();

      // Wait for expansion
      await page.waitForTimeout(500);

      // Get the test list element
      const testList = page.locator('.test-list.expanded').first();
      const isVisible = await testList.isVisible();

      if (isVisible) {
        // Check that the test list has no max-height constraint or is set to 'none'
        const maxHeight = await testList.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.maxHeight;
        });

        // max-height should be 'none' (no limit) after our fix
        expect(maxHeight).toBe('none');

        // Check that overflow is visible
        const overflow = await testList.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.overflow;
        });

        expect(overflow).toBe('visible');
      }
    }
  });

  test('all test items should be fully visible when accordion is expanded', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Ensures no tests are cut off: 1) Expands a project accordion, 2) Iterates through ALL test items, 3) Verifies each item is visible and not clipped by the parent container.'
    });
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      const firstHeader = projectHeaders.first();

      // Click to expand
      await firstHeader.click();

      // Wait for expansion animation
      await page.waitForTimeout(500);

      // Get all test items in the expanded list
      const testItems = page.locator('.test-list.expanded .test-item');
      const itemCount = await testItems.count();

      // Verify each test item is visible
      for (let i = 0; i < itemCount; i++) {
        const item = testItems.nth(i);
        await expect(item).toBeVisible();

        // Check that the item is within the viewport or scrollable area
        const isInViewport = await item.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const parent = el.closest('.test-list');
          const parentRect = parent.getBoundingClientRect();

          // Item should be within parent bounds (not clipped)
          return rect.bottom <= parentRect.bottom + 1 ||
                 window.getComputedStyle(parent).overflow !== 'hidden';
        });

        expect(isInViewport).toBe(true);
      }
    }
  });
});

test.describe('API Health', () => {
  test('health endpoint should return healthy status', async ({ request }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Calls GET /health and verifies response contains {status: "healthy", service: "test-dashboard"}.'
    });
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('test-dashboard');
  });

  test('projects endpoint should return array', async ({ request }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Calls GET /api/projects and verifies the response is an array of project objects.'
    });
    const response = await request.get('/api/projects');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('results summary endpoint should return object', async ({ request }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Calls GET /api/results and verifies the response is an object containing test results summary for all projects.'
    });
    const response = await request.get('/api/results');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(typeof data).toBe('object');
  });
});

test.describe('UI Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('refresh button should reload results', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Clicks the refresh button (#refreshBtn) and verifies no error toast appears. If a toast is shown, it should not have the "error" class.'
    });
    // Click refresh button
    await page.locator('#refreshBtn').click();

    // Should not show error toast
    const toast = page.locator('#toast');
    await page.waitForTimeout(500);

    // If toast is visible, it should not be an error
    const isVisible = await toast.isVisible();
    if (isVisible) {
      const hasErrorClass = await toast.evaluate(el => el.classList.contains('error'));
      expect(hasErrorClass).toBe(false);
    }
  });

  test('loading overlay should be hidden initially', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'description',
      description: 'Verifies the loading spinner overlay (#loadingOverlay) has the "hidden" class when the page first loads.'
    });
    const loadingOverlay = page.locator('#loadingOverlay');
    await expect(loadingOverlay).toHaveClass(/hidden/);
  });
});
