# Playwright Integration for Goodreads Scraping

This project includes Playwright for automated browser interaction and web scraping.

## Installation

Playwright and its dependencies are already installed. If you need to reinstall:

```bash
npm install -D @playwright/test playwright
npx playwright install chromium
```

## Scraping Goodreads Data

A scraper script is available to fetch book metadata from Goodreads:

```bash
npm run scrape-goodreads
```

This script:
- Uses Playwright to visit each book's Goodreads page
- Extracts metadata (title, author, rating, genres, tags, etc.)
- Saves the data to `src/features/books/data/books-metadata.json`

### Current Limitations

Goodreads implements anti-scraping measures, so the current scraper may not always work reliably. The book data in `books.ts` has been manually curated with accurate information.

## Using Playwright for Other Tasks

Playwright can be used for:
- **End-to-end testing**: Test your application's user flows
- **Web scraping**: Extract data from websites
- **Browser automation**: Automate repetitive tasks
- **Screenshot generation**: Capture page screenshots
- **PDF generation**: Convert pages to PDFs

### Basic Example

```typescript
import { chromium } from 'playwright';

async function example() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://example.com');
  const title = await page.textContent('h1');
  console.log(title);
  
  await browser.close();
}
```

### Testing Example

Create tests in a `tests` or `e2e` directory:

```typescript
import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await expect(page.locator('h1')).toBeVisible();
});
```

Run tests with:
```bash
npx playwright test
```

## Configuration

Create a `playwright.config.ts` file to configure Playwright:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 3001,
    reuseExistingServer: !process.env.CI,
  },
});
```

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Testing](https://playwright.dev/docs/intro)
- [Playwright API](https://playwright.dev/docs/api/class-playwright)

## Book Metadata Updates

To update book metadata:

1. Edit `src/features/books/data/books.ts` directly for reliable data
2. Or modify `scripts/scrape-goodreads.ts` and run the scraper (may require selector updates if Goodreads HTML changes)
3. Verify data accuracy before committing changes
