import { chromium } from '@playwright/test';

(async () => {
  console.log('\n🚀 Starting browser...\n');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔍 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { timeout: 60000 });
    
    console.log('⏳ Waiting for gallery to load (up to 30 seconds)...');
    try {
      await page.waitForSelector('[data-testid="gallery-grid"]', { timeout: 30000 });
      console.log('✅ Gallery grid found!');
    } catch (e) {
      console.log('⚠️  Gallery grid not found yet. Checking page state...');
      await page.screenshot({ path: 'screenshots/timeout-state.png', fullPage: true });
    }
    
    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'screenshots/gallery-verification.png', fullPage: true });
    
    console.log('\n🔍 Analyzing gallery...');
    const analysis = await page.evaluate(() => {
      const galleryGrid = document.querySelector('[data-testid="gallery-grid"]') || document.querySelector('#gallery-grid');
      const galleryPage = document.querySelector('[data-testid="gallery-page"]');
      
      if (!galleryGrid) {
        const isLoading = document.body.textContent.includes('Scanning');
        const isEmpty = document.body.textContent.includes('No PNG images');
        return {
          found: false,
          isLoading,
          isEmpty,
          pageFound: !!galleryPage
        };
      }
      
      const computed = window.getComputedStyle(galleryGrid);
      const pageHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      
      return {
        found: true,
        maxHeight: computed.maxHeight,
        overflowY: computed.overflowY,
        height: galleryGrid.offsetHeight,
        scrollHeight: galleryGrid.scrollHeight,
        clientHeight: galleryGrid.clientHeight,
        canScrollPage: pageHeight > viewportHeight,
        pageScrollHeight: pageHeight,
        viewportHeight: viewportHeight
      };
    });
    
    if (!analysis.found) {
      console.log('\n📊 Gallery grid not found:');
      console.log('   Page exists:', analysis.pageFound ? '✅' : '❌');
      console.log('   Is loading:', analysis.isLoading ? 'Yes (wait for scan to complete)' : 'No');
      console.log('   Is empty:', analysis.isEmpty ? 'Yes (no images match filters)' : 'No');
    } else {
      console.log('\n📊 Gallery Grid Styles:');
      console.log('   Max Height:', analysis.maxHeight, analysis.maxHeight === 'none' ? '✅' : (analysis.maxHeight.includes('vh') ? '❌' : '⚠️'));
      console.log('   Overflow Y:', analysis.overflowY, analysis.overflowY === 'visible' ? '✅' : (analysis.overflowY === 'auto' ? '❌' : '✅'));
      console.log('   Height:', analysis.height, 'px');
      console.log('   Scroll Height:', analysis.scrollHeight, 'px');
      console.log('   Client Height:', analysis.clientHeight, 'px');
      
      console.log('\n📊 Page Scroll:');
      console.log('   Can scroll page:', analysis.canScrollPage ? 'Yes ✅' : 'No');
      console.log('   Page height:', analysis.pageScrollHeight, 'px');
      console.log('   Viewport height:', analysis.viewportHeight, 'px');
      
      console.log('\n🎯 Verification Results:');
      const hasProperOverflow = analysis.overflowY !== 'auto';
      const hasProperMaxHeight = !analysis.maxHeight.includes('vh');
      
      if (hasProperOverflow && hasProperMaxHeight) {
        console.log('✅ SUCCESS: Gallery overflow fix is working!');
        console.log('   - Gallery is not constrained by max-height');
        console.log('   - Gallery does not have internal scrolling');
        console.log('   - Page scrolls naturally instead');
      } else {
        console.log('❌ Issues found:');
        if (!hasProperOverflow) console.log('   - Gallery still has overflow-y: auto');
        if (!hasProperMaxHeight) console.log('   - Gallery still constrained by:', analysis.maxHeight);
      }
    }
    
    console.log('\n💤 Keeping browser open for 5 seconds for inspection...\n');
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: 'screenshots/error-state.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('✅ Done!\n');
  }
})();
