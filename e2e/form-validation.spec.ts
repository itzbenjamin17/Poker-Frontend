import { test, expect } from './fixtures';

test.describe('Item 34: Form validation', () => {
  test('Create Room form rejects big blind less than 2x small blind and prevents API submission', async ({
    page,
  }) => {
    let apiCreateCallOccurred = false;

    // Track any call to /api/room/create
    await page.route('**/api/room/create', async (route) => {
      apiCreateCallOccurred = true;
      await route.continue();
    });

    await page.goto('/');

    const createSection = page.getByRole('region', { name: /create table/i });
    await expect(createSection).toBeVisible();

    // Fill valid room name and player alias
    await createSection.getByLabel(/room name/i).fill('Invalid Stakes Room');
    await createSection.getByLabel(/player alias/i).fill('RuleTester');

    // Fill invalid blind values: small blind = $10, big blind = $5 (< 2x small blind)
    await createSection.getByLabel(/small blind/i).fill('10');
    await createSection.getByLabel(/big blind/i).fill('5');

    // Click submit button
    const submitBtn = createSection.getByRole('button', { name: /establish table/i });
    await submitBtn.click();

    // Verify error message is shown
    const expectedError = 'Big blind must be at least 2× the small blind.';
    await expect(page.getByRole('alert')).toContainText(expectedError);

    // Verify the backend API was never called
    expect(apiCreateCallOccurred).toBe(false);
  });
});
