import { expect, test } from '@playwright/test'

test('the game loads at a level briefing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
})
