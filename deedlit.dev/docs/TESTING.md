# Testing Quick Reference

## ⚡ Quick Start

```powershell
# Install dependencies
npm install
npx playwright install

# Start dev server
npm run dev

# Run all tests (in another terminal)
npm run test:e2e

# Run specific test file
npx playwright test e2e/books.spec.ts
```

## 📋 Test Suites

| File | Purpose | Tests |
|------|---------|-------|
| `scraper.spec.ts` | Validates scraper output | 6 tests |
| `books.spec.ts` | Book page functionality | 9 tests |
| `book-display.spec.ts` | UI rendering & layout | 8 tests |
| `book-filters.spec.ts` | Filter functionality | 9 tests |
| `exploratory.spec.ts` | Edge cases & discovery | 25+ tests |

## 🎯 Common Commands

### Running Tests

```powershell
# All tests
npm run test:e2e

# Specific file
npx playwright test e2e/books.spec.ts

# Specific test
npx playwright test -g "should display book cards"

# Headed mode (see browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug

# UI mode (interactive)
npx playwright test --ui
```

### Test Reports

```powershell
# HTML report
npx playwright test --reporter=html
npx playwright show-report

# List format
npx playwright test --reporter=list

# JSON output
npx playwright test --reporter=json
```

### Debugging

```powershell
# Debug specific test
npx playwright test --debug -g "test name"

# With trace
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip

# Generate test code
npx playwright codegen http://localhost:3001
```

## 🔍 Selector Guide

### Best Practices (in order of preference)

1. **data-testid** (most stable)
   ```typescript
   page.locator('[data-testid="book-card"]')
   ```

2. **Semantic HTML** (accessible)
   ```typescript
   page.locator('button:has-text("Submit")')
   page.locator('article')
   page.locator('nav a')
   ```

3. **Text content** (readable)
   ```typescript
   page.locator('text=/pattern/i')
   page.locator('button:has-text("Click")')
   ```

4. **Class names** (use sparingly)
   ```typescript
   page.locator('.book-card')
   ```

### Locator Examples

```typescript
// By test ID
page.locator('[data-testid="book-card"]')

// By role
page.locator('button[role="submit"]')
page.locator('[role="navigation"]')

// By text
page.locator('text=Exact Match')
page.locator('text=/regex/i')
page.locator('button:has-text("Partial")')

// By attribute
page.locator('[href="/books"]')
page.locator('input[name="search"]')
page.locator('img[alt*="cover"]')

// Combined
page.locator('article:has-text("Fantasy")')
page.locator('.book-card >> text=/5 stars/i')

// Nth element
page.locator('.book-card').nth(0)
page.locator('.book-card').first()
page.locator('.book-card').last()

// All elements
page.locator('.book-card').all()
```

## ✅ Assertion Cheatsheet

```typescript
// Visibility
await expect(element).toBeVisible()
await expect(element).toBeHidden()

// Text content
await expect(element).toHaveText('text')
await expect(element).toContainText('partial')
await expect(element).toHaveText(/regex/i)

// Attributes
await expect(element).toHaveAttribute('href', '/path')
await expect(element).toHaveClass(/class-name/)

// State
await expect(element).toBeEnabled()
await expect(element).toBeDisabled()
await expect(element).toBeChecked()
await expect(element).toBeEditable()

// Count
await expect(page.locator('.item')).toHaveCount(5)

// URL
await expect(page).toHaveURL(/books/)
await expect(page).toHaveTitle(/Books/)

// Value
await expect(input).toHaveValue('text')
await expect(select).toHaveValue('option')

// Negation
await expect(element).not.toBeVisible()
```

## 🎬 Interaction Examples

```typescript
// Click
await button.click()
await button.click({ button: 'right' })
await button.dblclick()

// Type
await input.fill('text')
await input.type('text', { delay: 100 })
await input.clear()

// Select
await select.selectOption('value')
await select.selectOption({ label: 'Option' })
await select.selectOption({ index: 2 })

// Check/Uncheck
await checkbox.check()
await checkbox.uncheck()

// Hover
await element.hover()

// Drag and drop
await source.dragTo(target)

// Keyboard
await page.keyboard.press('Enter')
await page.keyboard.type('text')
await page.keyboard.down('Shift')
await page.keyboard.up('Shift')

// Mouse
await page.mouse.click(100, 200)
await page.mouse.wheel(0, 100)

// Screenshot
await page.screenshot({ path: 'screenshot.png' })
await element.screenshot({ path: 'element.png' })
```

## ⏱️ Waiting Strategies

```typescript
// Wait for element
await page.waitForSelector('.element')
await page.waitForSelector('.element', { state: 'visible' })
await page.waitForSelector('.element', { state: 'hidden' })

// Wait for load state
await page.waitForLoadState('load')
await page.waitForLoadState('domcontentloaded')
await page.waitForLoadState('networkidle')

// Wait for time
await page.waitForTimeout(1000) // milliseconds

// Wait for function
await page.waitForFunction(() => window.myVar === true)

// Wait for response
await page.waitForResponse(resp => resp.url().includes('/api/'))

// Auto-waiting (built-in for most actions)
await button.click() // Waits for element to be actionable
```

## 📱 Responsive Testing

```typescript
// Set viewport
await page.setViewportSize({ width: 375, height: 667 })

// Common devices
const devices = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1920, height: 1080 },
  wide: { width: 2560, height: 1440 }
}

// Use device preset
import { devices } from '@playwright/test'
await page.emulate(devices['iPhone 13'])
```

## 🐛 Debugging Tips

### Console Logging

```typescript
// Log to test output
console.log('Debug info:', await element.textContent())

// Capture page console
page.on('console', msg => console.log(msg.text()))
page.on('pageerror', err => console.log(err.message))
```

### Breakpoints

```typescript
// Pause execution
await page.pause()

// Debug step
await page.locator('button').click()
await page.pause() // Pause after click
```

### Screenshots

```typescript
// On test failure (automatic)
// Saved to: test-results/

// Manual screenshot
await page.screenshot({ 
  path: 'debug.png', 
  fullPage: true 
})
```

### Traces

```typescript
// Enable tracing
npx playwright test --trace on

// View trace
npx playwright show-trace trace.zip
```

## 📊 Test Structure

### Basic Test

```typescript
import { test, expect } from '@playwright/test'

test('should do something', async ({ page }) => {
  await page.goto('/path')
  await expect(page.locator('.element')).toBeVisible()
})
```

### Test Suite

```typescript
test.describe('Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/path')
  })

  test.afterEach(async ({ page }) => {
    // Cleanup
  })

  test('test 1', async ({ page }) => {
    // Test code
  })

  test('test 2', async ({ page }) => {
    // Test code
  })
})
```

### Hooks

```typescript
test.beforeAll(async () => {
  // Runs once before all tests
})

test.afterAll(async () => {
  // Runs once after all tests
})

test.beforeEach(async ({ page }) => {
  // Runs before each test
  await page.goto('/setup')
})

test.afterEach(async ({ page }) => {
  // Runs after each test
  await page.close()
})
```

### Skip/Only

```typescript
// Skip test
test.skip('not ready yet', async ({ page }) => {
  // ...
})

// Only run this test
test.only('focus on this', async ({ page }) => {
  // ...
})

// Conditional skip
test('mobile only', async ({ page, playwright }) => {
  test.skip(playwright.name === 'webkit', 'Not on webkit')
  // ...
})
```

## 🎨 Page Object Pattern

```typescript
// pages/BookPage.ts
export class BookPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/books')
  }

  async searchBooks(query: string) {
    await this.page.locator('input[type="search"]').fill(query)
  }

  async getBookCount() {
    return await this.page.locator('.book-card').count()
  }

  bookCard(index: number) {
    return this.page.locator('.book-card').nth(index)
  }
}

// In test
import { BookPage } from './pages/BookPage'

test('search books', async ({ page }) => {
  const bookPage = new BookPage(page)
  await bookPage.goto()
  await bookPage.searchBooks('fantasy')
  expect(await bookPage.getBookCount()).toBeGreaterThan(0)
})
```

## 🔥 Pro Tips

1. **Use auto-waiting** - Playwright waits automatically for most actions
2. **Prefer semantic selectors** - More stable than CSS classes
3. **Test user behavior** - Not implementation details
4. **Keep tests independent** - Each test should work alone
5. **Use fixtures** - Share setup between tests
6. **Enable parallelization** - Faster test execution
7. **Use soft assertions** - Continue test after assertion failure
8. **Mock API calls** - For consistent test data
9. **Test accessibility** - Keyboard navigation, screen readers
10. **Use trace viewer** - Visual debugging of test runs

## 📚 Additional Resources

- [Playwright Docs](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
- [Examples](https://playwright.dev/docs/examples)

---

**Project:** Deedlit Dev  
**Testing Framework:** Playwright 1.58.2  
**Last Updated:** February 7, 2026
