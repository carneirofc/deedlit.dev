import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Gallery Page Overflow Investigation', () => {
  const screenshotsDir = path.join(__dirname, '../../screenshots/gallery-overflow');

  test.beforeAll(() => {
    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test('investigate gallery overflow and scrolling behavior', async ({ page }) => {
    // Set viewport to a reasonable desktop size
    await page.setViewportSize({ width: 1920, height: 1080 });

    console.log('\n=== Step 1: Navigate to gallery page ===');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // Wait for page to be visible and initial content to load
    await page.waitForTimeout(3000);

    console.log('Page loaded, waiting for any images or content...');
    // Try to wait for some content, but don't fail if not found
    try {
      await page.waitForSelector('body', { timeout: 5000 });
    } catch (e) {
      console.log('Body selector wait timed out, continuing anyway...');
    }

    console.log('\n=== Step 2: Take screenshots of initial state ===');
    await page.screenshot({
      path: path.join(screenshotsDir, '01-initial-state-full-page.png'),
      fullPage: true
    });
    await page.screenshot({
      path: path.join(screenshotsDir, '02-initial-state-viewport.png'),
      fullPage: false
    });

    console.log('\n=== Step 3: Investigate gallery-page component overflow behavior ===');

    // Get the gallery-page element
    const galleryPage = page.locator('[class*="gallery-page"]').first();
    const galleryPageExists = await galleryPage.count() > 0;

    console.log(`Gallery-page element found: ${galleryPageExists}`);

    if (galleryPageExists) {
      // Get computed styles and dimensions
      const galleryPageInfo = await galleryPage.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          overflow: styles.overflow,
          overflowY: styles.overflowY,
          overflowX: styles.overflowX,
          height: styles.height,
          maxHeight: styles.maxHeight,
          position: styles.position,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          offsetHeight: el.offsetHeight,
          boundingHeight: rect.height,
          hasVerticalScroll: el.scrollHeight > el.clientHeight,
        };
      });

      console.log('\nGallery-page element info:');
      console.log(JSON.stringify(galleryPageInfo, null, 2));

      // Check document scroll height
      const documentInfo = await page.evaluate(() => {
        return {
          documentScrollHeight: document.documentElement.scrollHeight,
          documentClientHeight: document.documentElement.clientHeight,
          windowInnerHeight: window.innerHeight,
          hasDocumentScroll: document.documentElement.scrollHeight > window.innerHeight,
        };
      });

      console.log('\nDocument scroll info:');
      console.log(JSON.stringify(documentInfo, null, 2));

      // Take a screenshot highlighting the gallery-page element
      await galleryPage.screenshot({
        path: path.join(screenshotsDir, '03-gallery-page-element.png')
      });
    } else {
      // If specific gallery-page not found, let's look for the main content
      console.log('Gallery-page element not found with class selector, checking page structure...');

      const pageStructure = await page.evaluate(() => {
        const getElementInfo = (el: Element) => {
          const styles = window.getComputedStyle(el);
          return {
            tagName: el.tagName.toLowerCase(),
            classes: el.className,
            overflow: styles.overflow,
            overflowY: styles.overflowY,
            height: styles.height,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          };
        };

        // Get info about main layout elements
        const body = document.body;
        const main = document.querySelector('main');
        const gallery = document.querySelector('[class*="gallery"]');

        return {
          body: getElementInfo(body),
          main: main ? getElementInfo(main) : null,
          gallery: gallery ? getElementInfo(gallery) : null,
        };
      });

      console.log('\nPage structure:');
      console.log(JSON.stringify(pageStructure, null, 2));
    }

    console.log('\n=== Step 4: Get initial scroll position and image count ===');

    const initialImageCount = await page.locator('img[src*="/api/images"]').count();
    console.log(`Initial image count: ${initialImageCount}`);

    const initialScrollY = await page.evaluate(() => window.scrollY);
    console.log(`Initial scroll position: ${initialScrollY}px`);

    console.log('\n=== Step 5: Scroll down to trigger loading more images ===');

    // Scroll down in increments, taking measurements
    const scrollSteps = 5;
    for (let i = 1; i <= scrollSteps; i++) {
      console.log(`\nScroll step ${i}/${scrollSteps}`);

      // Scroll by viewport height
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      });

      // Wait for any loading to occur
      await page.waitForTimeout(1500);

      // Get current state
      const currentState = await page.evaluate(() => {
        const galleryElement = document.querySelector('[class*="gallery-page"]') ||
                             document.querySelector('main') ||
                             document.body;
        const styles = window.getComputedStyle(galleryElement);

        return {
          scrollY: window.scrollY,
          documentScrollHeight: document.documentElement.scrollHeight,
          windowInnerHeight: window.innerHeight,
          galleryScrollHeight: galleryElement.scrollHeight,
          galleryClientHeight: galleryElement.clientHeight,
          galleryHasScroll: galleryElement.scrollHeight > galleryElement.clientHeight,
          galleryOverflowY: styles.overflowY,
        };
      });

      const currentImageCount = await page.locator('img[src*="/api/images"]').count();

      console.log(`  Scroll Y: ${currentState.scrollY}px`);
      console.log(`  Document scroll height: ${currentState.documentScrollHeight}px`);
      console.log(`  Gallery scroll height: ${currentState.galleryScrollHeight}px`);
      console.log(`  Gallery client height: ${currentState.galleryClientHeight}px`);
      console.log(`  Gallery has internal scroll: ${currentState.galleryHasScroll}`);
      console.log(`  Gallery overflow-y: ${currentState.galleryOverflowY}`);
      console.log(`  Current image count: ${currentImageCount}`);

      // Take screenshot at this scroll position
      await page.screenshot({
        path: path.join(screenshotsDir, `04-after-scroll-step-${i}.png`),
        fullPage: false
      });
    }

    console.log('\n=== Step 6: Take final full-page screenshot ===');
    await page.screenshot({
      path: path.join(screenshotsDir, '05-final-state-full-page.png'),
      fullPage: true
    });

    console.log('\n=== Step 7: Final analysis ===');

    const finalAnalysis = await page.evaluate(() => {
      const galleryElement = document.querySelector('[class*="gallery-page"]') ||
                           document.querySelector('main') ||
                           document.body;
      const styles = window.getComputedStyle(galleryElement);

      return {
        pageTitle: document.title,
        url: window.location.href,
        documentScrollHeight: document.documentElement.scrollHeight,
        documentClientHeight: document.documentElement.clientHeight,
        windowInnerHeight: window.innerHeight,
        galleryElement: {
          tagName: galleryElement.tagName.toLowerCase(),
          className: galleryElement.className,
          overflow: styles.overflow,
          overflowY: styles.overflowY,
          overflowX: styles.overflowX,
          height: styles.height,
          maxHeight: styles.maxHeight,
          minHeight: styles.minHeight,
          display: styles.display,
          position: styles.position,
          scrollHeight: galleryElement.scrollHeight,
          clientHeight: galleryElement.clientHeight,
          offsetHeight: galleryElement.offsetHeight,
        },
        scrollingBehavior: {
          documentHasScroll: document.documentElement.scrollHeight > window.innerHeight,
          galleryHasInternalScroll: galleryElement.scrollHeight > galleryElement.clientHeight,
          scrollableElement: document.documentElement.scrollHeight > window.innerHeight ? 'document' :
                            galleryElement.scrollHeight > galleryElement.clientHeight ? 'gallery' : 'none',
        },
      };
    });

    console.log('\nFinal analysis:');
    console.log(JSON.stringify(finalAnalysis, null, 2));

    const finalImageCount = await page.locator('img[src*="/api/images"]').count();
    console.log(`\nFinal image count: ${finalImageCount}`);
    console.log(`Images loaded during test: ${finalImageCount - initialImageCount}`);

    console.log(`\n=== All screenshots saved to: ${screenshotsDir} ===\n`);

    // Assertion to check the expected behavior
    const hasInternalScroll = finalAnalysis.scrollingBehavior.galleryHasInternalScroll;
    const hasDocumentScroll = finalAnalysis.scrollingBehavior.documentHasScroll;

    console.log('\n=== OVERFLOW BEHAVIOR SUMMARY ===');
    console.log(`Gallery has internal scroll: ${hasInternalScroll ? 'YES (ISSUE!)' : 'NO (CORRECT)'}`);
    console.log(`Document has scroll: ${hasDocumentScroll ? 'YES (CORRECT)' : 'NO'}`);
    console.log(`Gallery overflow-y: ${finalAnalysis.galleryElement.overflowY}`);

    if (hasInternalScroll) {
      console.log('\n⚠️  ISSUE DETECTED: Gallery has internal scrolling!');
      console.log('Expected: Gallery should grow vertically and document should scroll');
      console.log('Actual: Gallery has internal overflow');
    } else {
      console.log('\n✓ CORRECT: Gallery grows vertically, document scrolls');
    }
  });
});
