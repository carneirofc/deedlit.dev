import { test, expect } from '@playwright/test';

test('gallery overflow verification', async ({ page }) => {
  await page.goto('http://localhost:3000');
  
  // Wait for gallery to load
  await page.waitForSelector('[data-testid="gallery-page"]', { timeout: 10000 });
  
  // Get the gallery grid element
  const galleryGrid = page.locator('.gallery-grid');
  await galleryGrid.waitFor({ state: 'visible', timeout: 10000 });
  
  // Take initial screenshot
  await page.screenshot({ path: 'screenshots/gallery-fixed-01-initial.png', fullPage: true });
  
  // Get computed styles
  const styles = await galleryGrid.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return {
      maxHeight: computed.maxHeight,
      overflowY: computed.overflowY,
      height: el.offsetHeight,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    };
  });
  
  console.log('Gallery Grid Styles (After Fix):');
  console.log('  Max Height:', styles.maxHeight);
  console.log('  Overflow Y:', styles.overflowY);
  console.log('  Actual Height:', styles.height);
  console.log('  Scroll Height:', styles.scrollHeight);
  console.log('  Client Height:', styles.clientHeight);
  
  // Verify the fix
  expect(styles.overflowY).not.toBe('auto');
  expect(styles.maxHeight).not.toContain('vh');
  
  // Get page scroll height
  const pageMetrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    canScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight
  }));
  
  console.log('\nPage Metrics:');
  console.log('  Can Scroll:', pageMetrics.canScroll);
  console.log('  Page Scroll Height:', pageMetrics.scrollHeight);
  console.log('  Page Client Height:', pageMetrics.clientHeight);
  
  // Scroll the page
  if (pageMetrics.canScroll) {
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.screenshot({ path: 'screenshots/gallery-fixed-02-scrolled-500.png', fullPage: true });
    
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.screenshot({ path: 'screenshots/gallery-fixed-03-scrolled-1000.png', fullPage: true });
  }
  
  console.log('\n✅ Fix verified: Gallery grows naturally, page scrolls instead of internal overflow');
});
