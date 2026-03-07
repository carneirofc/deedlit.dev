import { test } from '@playwright/test';

test('debug page state', async ({ page }) => {
  console.log('\n🔍 Navigating to page...');
  await page.goto('http://localhost:3000');
  
  console.log('⏳ Waiting 3 seconds for page to load...');
  await page.waitForTimeout(3000);
  
  console.log('📸 Taking screenshot...');
  await page.screenshot({ path: 'screenshots/debug-page-state.png', fullPage: true });
  
  console.log('🔍 Looking for gallery-related elements...');
  const galleryPage = await page.locator('[data-testid="gallery-page"]').count();
  const galleryGrid = await page.locator('.gallery-grid').count();  
  const galleryImageGrid = await page.locator('[data-testid="gallery-image-grid"]').count();
  
  console.log('   [data-testid="gallery-page"]:', galleryPage);
  console.log('   .gallery-grid:', galleryGrid);
  console.log('   [data-testid="gallery-image-grid"]:', galleryImageGrid);
  
  const html = await page.content();
  const hasGalleryText = html.includes('gallery');
  console.log('   Page contains "gallery":', hasGalleryText);
  
  console.log('\n✅ Debug complete!');
});
