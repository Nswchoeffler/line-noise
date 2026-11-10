import { expect, test } from '@playwright/test'

test('the game loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Line Noise' })).toBeVisible()
})
