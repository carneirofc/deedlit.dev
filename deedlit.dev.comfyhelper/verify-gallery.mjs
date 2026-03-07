import { chromium } from '@playwright/test';

(async () => {
  console.log('\n🚀 Starting browser...\n');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔍 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    
    console.log('⏳ Waiting for page to stabilize...');
    await page.waitForTimeout(3000);
    
    console.log('📸 Taking initial screenshot...');
    await page.screenshot({ path: 'screenshots/gallery-current-state.png', fullPage: true });
    
    console.log('🔍 Checking for gallery elements...');
    const elements = await page.evaluate(() => {
      const galleryPage = document.querySelector('[data-testid="gallery-page"]');
      const galleryGrid = document.querySelector('.gallery-grid');
      const galleryImageGrid = document.querySelector('[data-testid="gallery-image-grid"]');
      
      return {
        galleryPageExists: !!galleryPage,
        galleryGridExists: !!galleryGrid,
        galleryImageGridExists: !!galleryImageGrid,
        galleryGridStyles: galleryGrid ? {
          maxHeight: window.getComputedStyle(galleryGrid).maxHeight,
          overflowY: window.getComputedStyle(galleryGrid).overflowY,
          height: galleryGrid.offsetHeight,
          scrollHeight: galleryGrid.scrollHeight,
        } : null
      };
    });
    
    console.log('\n📊 Results:');
    console.log('   Gallery Page exists:', elements.galleryPageExists ? '✅' : '❌');
    console.log('   Gallery Grid exists:', elements.galleryGridExists ? '✅' : '❌');
    console.log('   Gallery Image Grid exists:', elements.galleryImageGridExists ? '✅' : '❌');
    
    if (elements.galleryGridStyles) {
      console.log('\n   Gallery Grid Styles:');
      console.log('     Max Height:', elements.galleryGridStyles.maxHeight);
      console.log('     Overflow Y:', elements.galleryGridStyles.overflowY);
      console.log('     Height:', elements.galleryGridStyles.height, 'px');
      console.log('     Scroll Height:', elements.galleryGridStyles.scrollHeight, 'px');
      
      if (elements.galleryGridStyles.overflowY !== 'auto') {
        console.log('\n✅ SUCCESS: Gallery no longer has internal overflow!');
      } else {
        console.log('\n❌ Gallery still has overflow-y: auto');
      }
      
      if (!elements.galleryGridStyles.maxHeight.includes('vh')) {
        console.log('✅ SUCCESS: Gallery is not constrained by viewport height!');
      } else {
        console.log('❌ Gallery is still constrained by:', elements.galleryGridStyles.maxHeight);
      }
    }
    
    console.log('\n💤 Keeping browser open for 5 seconds so you can inspect...\n');
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'screenshots/error-state.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('✅ Done!\n');
  }
})();
