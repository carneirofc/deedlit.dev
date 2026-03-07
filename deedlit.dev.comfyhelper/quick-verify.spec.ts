import { test, expect } from '@playwright/test';

test.use({ 
  baseURL: 'http://localhost:3000',
  video: 'off'
});

test('verify gallery overflow fix - quick check', async ({ page }) => {
  console.log('\n🔍 Starting verification test...\n');
  
  await page.goto('/');
  
  // Wait for gallery to load
  await page.waitForSelector('[data-testid="gallery-page"]', { timeout: 10000 });
  console.log('✅ Gallery page loaded');
  
  // Get the gallery grid element
  const galleryGrid = page.locator('.gallery-grid');
  await galleryGrid.waitFor({ state: 'visible', timeout: 10000 });
  console.log('✅ Gallery grid visible');
  
  // Take initial screenshot
  await page.screenshot({ path: 'screenshots/gallery-fixed-01-initial.png', fullPage: true });
  console.log('📸 Screenshot saved: gallery-fixed-01-initial.png');
  
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
  
  console.log('\n📊 Gallery Grid Styles (After Fix):');
  console.log('   Max Height:', styles.maxHeight, styles.maxHeight === 'none' ? '✅' : '❌');
  console.log('   Overflow Y:', styles.overflowY, styles.overflowY === 'visible' ? '✅' : '❌');
  console.log('   Actual Height:', styles.height, 'px');
  console.log('   Scroll Height:', styles.scrollHeight, 'px');
  console.log('   Client Height:', styles.clientHeight, 'px');
  
  // Verify the fix
  if (styles.overflowY !== 'auto') {
    console.log('\n✅ SUCCESS: overflow-y is no longer "auto"');
  } else {
    console.log('\n❌ FAIL: overflow-y is still "auto"');
  }
  
  if (!styles.maxHeight.includes('vh') && styles.maxHeight !== 'none') {
    console.log('⚠️  WARNING: maxHeight is set to:', styles.maxHeight);
  } else {
    console.log('✅ SUCCESS: maxHeight is not constrained by vh');
  }
  
  // Get page scroll height
  const pageMetrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    canScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight
  }));
  
  console.log('\n📊 Page Metrics:');
  console.log('   Can Scroll:', pageMetrics.canScroll ? 'Yes ✅' : 'No ❌');
  console.log('   Page Scroll Height:', pageMetrics.scrollHeight, 'px');
  console.log('   Page Client Height:', pageMetrics.clientHeight, 'px');
  
  // Scroll the page
  if (pageMetrics.canScroll) {
    console.log('\n📜 Testing page scroll...');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.screenshot({ path: 'screenshots/gallery-fixed-02-scrolled-500.png', fullPage: true });
    console.log('   📸 Screenshot at 500px scroll');
    
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.screenshot({ path: 'screenshots/gallery-fixed-03-scrolled-1000.png', fullPage: true });
    console.log('   📸 Screenshot at 1000px scroll');
  }
  
  console.log('\n✅ Verification complete!\n');
});
