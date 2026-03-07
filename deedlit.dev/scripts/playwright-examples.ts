import { chromium, devices } from 'playwright';

/**
 * Example 1: Basic page navigation and content extraction
 */
async function example1_BasicNavigation() {
  console.log('\n=== Example 1: Basic Navigation ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://example.com');
  const title = await page.title();
  const heading = await page.textContent('h1');
  
  console.log('Page title:', title);
  console.log('Main heading:', heading);
  
  await browser.close();
}

/**
 * Example 2: Taking screenshots
 */
async function example2_Screenshots() {
  console.log('\n=== Example 2: Screenshots ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://playwright.dev');
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  
  console.log('Screenshot saved to screenshot.png');
  
  await browser.close();
}

/**
 * Example 3: Form interaction
 */
async function example3_FormInteraction() {
  console.log('\n=== Example 3: Form Interaction ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.google.com');
  
  // Type in search box
  await page.fill('input[name="q"]', 'Playwright automation');
  
  // Press Enter
  await page.press('input[name="q"]', 'Enter');
  
  // Wait for navigation
  await page.waitForLoadState('networkidle');
  
  const searchResults = await page.$$('h3');
  console.log(`Found ${searchResults.length} search results`);
  
  await browser.close();
}

/**
 * Example 4: Multiple pages and tabs
 */
async function example4_MultiplePagesAsync() {
  console.log('\n=== Example 4: Multiple Pages ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  // Open multiple pages
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  
  await Promise.all([
    page1.goto('https://example.com'),
    page2.goto('https://example.org'),
  ]);
  
  const title1 = await page1.title();
  const title2 = await page2.title();
  
  console.log('Page 1:', title1);
  console.log('Page 2:', title2);
  
  await browser.close();
}

/**
 * Example 5: Waiting for elements
 */
async function example5_WaitingForElements() {
  console.log('\n=== Example 5: Waiting for Elements ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://example.com');
  
  // Wait for a specific element
  await page.waitForSelector('h1', { timeout: 5000 });
  console.log('H1 element found');
  
  // Wait for a specific state
  await page.waitForLoadState('domcontentloaded');
  console.log('DOM content loaded');
  
  await browser.close();
}

/**
 * Example 6: Extracting structured data
 */
async function example6_StructuredData() {
  console.log('\n=== Example 6: Extracting Structured Data ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://news.ycombinator.com');
  
  // Extract multiple items
  const stories = await page.$$eval('.athing', (elements) => {
    return elements.slice(0, 5).map((el) => {
      const titleElement = el.querySelector('.titleline > a');
      return {
        title: titleElement?.textContent || '',
        url: titleElement?.getAttribute('href') || '',
      };
    });
  });
  
  console.log('Top 5 Hacker News stories:');
  stories.forEach((story, i) => {
    console.log(`${i + 1}. ${story.title}`);
  });
  
  await browser.close();
}

/**
 * Example 7: Mobile emulation
 */
async function example7_MobileEmulation() {
  console.log('\n=== Example 7: Mobile Emulation ===');
  const browser = await chromium.launch({ headless: true });
  
  // Emulate iPhone 12
  const context = await browser.newContext({
    ...devices['iPhone 12'],
  });
  
  const page = await context.newPage();
  await page.goto('https://example.com');
  
  const viewportSize = page.viewportSize();
  console.log('Viewport:', viewportSize);
  
  await browser.close();
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_BasicNavigation();
    // await example2_Screenshots(); // Uncomment to generate screenshot
    // await example3_FormInteraction(); // Uncomment to test form interaction
    await example4_MultiplePagesAsync();
    await example5_WaitingForElements();
    await example6_StructuredData();
    await example7_MobileEmulation();
    
    console.log('\n✓ All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run all examples when script is executed
runAllExamples();

export {
  example1_BasicNavigation,
  example2_Screenshots,
  example3_FormInteraction,
  example4_MultiplePagesAsync,
  example5_WaitingForElements,
  example6_StructuredData,
  example7_MobileEmulation,
};
