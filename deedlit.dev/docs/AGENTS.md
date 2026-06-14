# AI Agent Testing & Development Guide

This guide is designed for AI agents to understand how to setup, test, and work with this Next.js application.

## Project Overview

**Technology Stack:**
- Next.js 15.1.6 (React 19)
- TypeScript 5.7.3  
- Playwright 1.58.2 for E2E testing
- Custom Goodreads scraper for book metadata

**Port:** Application runs on `http://localhost:3001`

**Key Features:**
- Book collection with Goodreads metadata
- Image gallery with filtering
- Service listing page
- PWA capabilities

## Setup Instructions

### 1. Initial Setup

```powershell
# Clone/navigate to project
cd path\to\deedlit.dev

# Install dependencies
npm install

# Install Playwright browsers (required for testing)
npx playwright install

# Verify installation
npx playwright --version
```

### 2. Starting the Development Server

```powershell
# Start Next.js dev server (runs on port 3001)
npm run dev

# Wait for server to start (usually 2-5 seconds)
# Look for: "Ready in X ms" or "Local: http://localhost:3001"
```

### 3. Running Tests

```powershell
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test e2e/books.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests in debug mode
npx playwright test --debug

# Run specific test by name
npx playwright test -g "should display book cards"

# Generate test report
npx playwright test --reporter=html
npx playwright show-report
```

## Test Files

### E2E Tests

Located in `e2e/` directory:

1. **`books.spec.ts`** - Book page tests
   - Book card display
   - Filtering functionality
   - Search and sort
   - Goodreads integration

2. **`scraper.spec.ts`** - Scraper validation
   - Configuration file checks
   - Metadata structure validation
   - Data integrity tests

3. **`book-display.spec.ts`** - UI rendering tests
   - Card layout
   - Cover images
   - Responsive design
   - Link validation

4. **`book-filters.spec.ts`** - Filter functionality
   - Search input
   - Genre filtering
   - Sort options
   - Reset filters

5. **`exploratory.spec.ts`** - Exploratory tests
   - Navigation
   - Performance checks
   - Accessibility
   - Error handling
   - Responsive design

### Running the Scraper

```powershell
# Run Goodreads scraper
npm run scrape-goodreads

# Configuration file (add book URLs here):
src/features/books/data/books-config.ts

# Output file (generated metadata):
src/features/books/data/books-metadata.json
```

## Common Testing Scenarios

### Scenario 1: Test Book Display

```powershell
# 1. Start dev server
npm run dev

# 2. In another terminal, run book tests
npx playwright test e2e/books.spec.ts e2e/book-display.spec.ts

# Expected: All tests pass, books display correctly
```

### Scenario 2: Add and Test New Book

```powershell
# 1. Add Goodreads URL to config
# Edit: src/features/books/data/books-config.ts
# Add URL to bookUrls array

# 2. Run scraper
npm run scrape-goodreads

# 3. Verify metadata
# Check: src/features/books/data/books-metadata.json

# 4. Start dev server and test
npm run dev
npx playwright test e2e/books.spec.ts
```

### Scenario 3: Test Filters

```powershell
# 1. Ensure dev server is running
npm run dev

# 2. Run filter tests
npx playwright test e2e/book-filters.spec.ts

# 3. Run exploratory tests for edge cases
npx playwright test e2e/exploratory.spec.ts
```

### Scenario 4: Validate Scraper Output

```powershell
# 1. Run scraper
npm run scrape-goodreads

# 2. Run validation tests
npx playwright test e2e/scraper.spec.ts

# Expected: All metadata validates correctly
```

## Test Writing Guidelines

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to page before each test
    await page.goto('/books');
    await page.waitForTimeout(1000); // Wait for content
  });

  test('should test specific behavior', async ({ page }) => {
    // Test implementation
    const element = page.locator('[data-testid="my-element"]');
    await expect(element).toBeVisible();
  });
});
```

### Common Playwright Patterns

```typescript
// Navigation
await page.goto('/path');
await page.waitForLoadState('networkidle');

// Locators (prefer data-testid)
page.locator('[data-testid="book-card"]')
page.locator('.class-name')
page.locator('text=/pattern/i')
page.locator('button:has-text("Click")')

// Assertions
await expect(element).toBeVisible();
await expect(element).toHaveText('Expected');
await expect(element).toHaveAttribute('href', '/path');

// Interactions
await element.click();
await input.fill('text');
await select.selectOption('value');
await page.keyboard.press('Enter');

// Waiting
await page.waitForTimeout(1000); // Time-based
await page.waitForSelector('.element'); // Element-based
await page.waitForLoadState('load'); // Load state
```

### Debugging Tests

```powershell
# Run with debug UI
npx playwright test --debug

# Run with trace
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip

# Take screenshots on failure (automatic)
# Screenshots saved to: test-results/

# Generate HTML report
npx playwright test --reporter=html
npx playwright show-report
```

## Project Structure

```
deedlit.dev/
├── src/
│   ├── app/
│   │   ├── books/page.tsx           # Books page
│   │   ├── gallery/page.tsx         # Gallery page
│   │   └── services/page.tsx        # Services page
│   ├── components/                  # Shared components
│   ├── features/
│   │   ├── books/
│   │   │   ├── components/
│   │   │   │   ├── BooksSection.tsx
│   │   │   │   └── BookFilters.tsx
│   │   │   ├── data/
│   │   │   │   ├── books-config.ts      # Configuration
│   │   │   │   ├── books-metadata.json  # Generated data
│   │   │   │   └── books.ts
│   │   │   ├── hooks/
│   │   │   │   └── useBookFilters.ts
│   │   │   └── lib/
│   │   │       └── filtering.ts
│   │   ├── gallery/                # Gallery feature
│   │   └── services/              # Services feature
│   ├── lib/
│   │   ├── logger.ts              # Server-side logger
│   │   └── client-logger.ts       # Client-side logger
│   └── proxy.ts
├── scripts/
│   └── scrape-goodreads.ts        # Goodreads scraper
├── e2e/
│   ├── books.spec.ts
│   ├── scraper.spec.ts
│   ├── book-display.spec.ts
│   ├── book-filters.spec.ts
│   └── exploratory.spec.ts
├── docs/
│   ├── LOGGING.md                  # Logging documentation
│   └── AGENTS.md                   # This file
├── playwright.config.ts            # Playwright configuration
└── package.json
```

## Key Files for Testing

### Configuration Files

- `playwright.config.ts` - Playwright settings
- `src/features/books/data/books-config.ts` - Book URLs
- `next.config.ts` - Next.js configuration

### Data Files

- `src/features/books/data/books-metadata.json` - Scraped book data
- `public/images/` - Gallery images

### Log Files

Development logs appear in:
- Terminal running `npm run dev` - Server logs
- Browser console - Client logs
- `npm run scrape-goodreads` output - Scraper logs

## Troubleshooting

### Server Won't Start

```powershell
# Check if port 3001 is in use
netstat -ano | findstr :3001

# Kill process if needed
taskkill /PID <process_id> /F

# Try starting again
npm run dev
```

### Tests Failing

```powershell
# 1. Verify dev server is running
# Check http://localhost:3001

# 2. Clear Playwright cache
npx playwright install --force

# 3. Run single test in debug mode
npx playwright test --debug -g "test name"

# 4. Check test-results/ folder for screenshots
```

### Scraper Not Working

```powershell
# 1. Check configuration
# Verify src/features/books/data/books-config.ts has valid URLs

# 2. Run with verbose logging
npm run scrape-goodreads

# 3. Check output file was created
# Look at src/features/books/data/books-metadata.json

# Note: Goodreads may block scraping, use manual data if needed
```

### Playwright Not Installed

```powershell
# Install Playwright and browsers
npm install @playwright/test --save-dev
npx playwright install

# Verify installation
npx playwright --version
npx playwright test --list
```

## Test Execution Checklist

Before running tests:
- [ ] Dependencies installed (`npm install`)
- [ ] Playwright browsers installed (`npx playwright install`)
- [ ] Dev server running (`npm run dev`)
- [ ] Server is responsive (visit http://localhost:3001)
- [ ] Metadata file exists (run scraper if needed)

Running tests:
- [ ] All tests: `npm run test:e2e`
- [ ] Specific suite: `npx playwright test e2e/books.spec.ts`
- [ ] Debug mode: `npx playwright test --debug`
- [ ] Generate report: `npx playwright test --reporter=html`

After tests:
- [ ] Review test output in terminal
- [ ] Check `test-results/` for failures
- [ ] View HTML report: `npx playwright show-report`
- [ ] Review screenshots if tests failed

## Performance Expectations

- **Page Load:** < 5 seconds
- **Test Execution:** 30-60 seconds for full suite
- **Scraper:** 20-40 seconds per book
- **Dev Server Startup:** 2-5 seconds

## Resources

- **Playwright Docs:** https://playwright.dev
- **Next.js Docs:** https://nextjs.org/docs
- **Project Logging:** See `docs/LOGGING.md`
- **GitHub Issues:** Report problems in repository

## Quick Reference Commands

```powershell
# Development
npm run dev                          # Start dev server
npm run build                       # Build for production
npm start                           # Start production server

# Testing
npm run test:e2e                    # Run all E2E tests
npx playwright test                 # Run tests
npx playwright test --headed        # Run with visible browser
npx playwright test --debug         # Debug mode
npx playwright show-report          # View HTML report

# Scraping
npm run scrape-goodreads            # Run book scraper

# Utilities
npx playwright codegen localhost:3001  # Generate test code
npx playwright install              # Install browsers
```

## Agent-Specific Tips

1. **Always check if dev server is running** before executing tests
2. **Wait for page load** - use `waitForTimeout` or `waitForLoadState`
3. **Prefer data-testid** over class names for selectors
4. **Run exploratory tests** to discover application behavior
5. **Check console logs** - both server and browser
6. **Use debug mode** (`--debug`) when investigating failures
7. **Take screenshots** at key points for visual verification
8. **Test responsiveness** across device sizes
9. **Verify accessibility** - keyboard navigation, alt text, headings
10. **Handle async operations** - data loading, navigation, interactions

## Success Criteria

Tests are passing when:
- ✅ All test suites complete without errors
- ✅ No failed assertions
- ✅ Pages load within acceptable time
- ✅ Interactive elements are responsive
- ✅ Data displays correctly
- ✅ Filters and search work as expected
- ✅ No console errors (warnings are OK)
- ✅ Responsive design works on all viewport sizes
- ✅ Accessibility checks pass

---

**Last Updated:** February 7, 2026  
**For Questions:** Check project README.md or open an issue

