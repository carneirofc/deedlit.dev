import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { section, info, debug, warn, error, success, progress, separator } from '../src/lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BookMetadata {
  id: string;
  title: string;
  author: string;
  rating: number;
  ratingsCount: number;
  reviewsCount: number;
  genres: string[];
  pages: number;
  description: string;
  goodreadsUrl: string;
  coverUrl: string;
}

interface ScrapeStats {
  attempted: number;
  successful: number;
  failed: number;
  startTime: number;
  endTime?: number;
  errors: string[];
}

function generateBookId(url: string): string {
  const match = url.match(/\/show\/(\d+)/);
  return match ? `book-${match[1]}` : `book-${Date.now()}`;
}

async function scrapeGoodreadsBook(url: string, stats: ScrapeStats): Promise<BookMetadata | null> {
  const bookId = generateBookId(url);
  info(`Starting scrape for ${bookId}`, { url }, { prefix: 'SCRAPER' });
  
  let browser;
  try {
    debug('Launching browser (headed mode for better compatibility)...', {}, { prefix: 'BROWSER' });
    browser = await chromium.launch({ 
      headless: false, // Use headed mode to avoid bot detection
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
    });
    
    const page = await context.newPage();
    
    // Remove automation indicators
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    
    debug('Browser launched successfully', {}, { prefix: 'BROWSER' });

    // Navigate to the page
    info(`Navigating to URL...`, { url }, { prefix: 'NAV' });
    const startTime = Date.now();
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000); // Wait for dynamic content to load
      
      const loadTime = Date.now() - startTime;
      success(`Page loaded in ${loadTime}ms`, {}, { prefix: 'NAV' });
      
      // Take screenshot for debugging
      await page.screenshot({ path: 'debug-goodreads.png', fullPage: false });
      debug('Screenshot saved to debug-goodreads.png', {}, { prefix: 'DEBUG' });
      
    } catch (navError) {
      warn(`Navigation warning: ${navError}`, {}, { prefix: 'NAV' });
      await page.screenshot({ path: 'debug-goodreads-error.png' });
      debug('Error screenshot saved', {}, { prefix: 'DEBUG' });
    }
    
    // Create metadata object
    const metadata: BookMetadata = {
      id: bookId,
      title: '',
      author: '',
      rating: 0,
      ratingsCount: 0,
      reviewsCount: 0,
      genres: [],
      pages: 0,
      description: '',
      goodreadsUrl: url,
      coverUrl: ''
    };
    
    // Extract ALL data using page.evaluate() to run JavaScript in browser context
    debug('Extracting data using browser evaluation...', {}, { prefix: 'EXTRACT' });
    
    const extractedData = await page.evaluate(() => {
      const extract = {
        title: '',
        author: '',
        rating: 0,
        ratingsCount: 0,
        reviewsCount: 0,
        genres: [] as string[],
        pages: 0,
        description: '',
        coverUrl: '',
        pageTextLength: 0
      };
      
      // Get page text for parsing
      const bodyText = document.body?.innerText || '';
      extract.pageTextLength = bodyText.length;
      
      // Title - find the main heading
      const h1Elements = document.querySelectorAll('h1');
      for (const h1 of Array.from(h1Elements)) {
        const text = h1.textContent?.trim();
        if (text && text.length > 3 && text.length < 200 && 
            !text.toLowerCase().includes('sign in') &&
            !text.toLowerCase().includes('join') &&
            !text.toLowerCase().includes('goodreads')) {
          extract.title = text;
          break;
        }
      }
      
      // Author - look for author links
      const authorLinks = document.querySelectorAll('a[href*="/author/"], [class*="author"] a, [class*="Author"] a, [class*="Contributor"] a');
      for (const link of Array.from(authorLinks)) {
        const text = link.textContent?.trim();
        if (text && text.length > 2 && text.length < 50 && 
            !text.includes('reviews') && 
            !text.includes('Follow') &&
            !text.includes('...')) {
          extract.author = text;
          break;
        }
      }
      
      // Rating - find rating number in text
      const ratingPatterns = [
        /(\d\.\d+)\s*average rating/i,
        /rating:\s*(\d\.\d+)/i,
        /(\d\.\d+)\s*stars?/i,
        /(\d\.\d+)\s+out of 5/i
      ];
      for (const pattern of ratingPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          const rating = parseFloat(match[1]);
          if (rating > 0 && rating <= 5) {
            extract.rating = rating;
            break;
          }
        }
      }
      
      // Ratings count
      const ratingsMatch = bodyText.match(/(\d+(?:,\d+)*)\s+ratings?(?!\s+and)/i);
      if (ratingsMatch) {
        extract.ratingsCount = parseInt(ratingsMatch[1].replace(/,/g, ''));
      }
      
      // Reviews count
      const reviewsMatch = bodyText.match(/(\d+(?:,\d+)*)\s+reviews?/i);
      if (reviewsMatch) {
        extract.reviewsCount = parseInt(reviewsMatch[1].replace(/,/g, ''));
      }
      
      // Genres will be fetched separately from the shelves page
      // For now, just return empty array - we'll fetch it after
      extract.genres = [];
      
      // Pages - find page count in text
      const pagesMatch = bodyText.match(/(\d+)\s+pages?/i);
      if (pagesMatch) {
        const pages = parseInt(pagesMatch[1]);
        if (pages > 0 && pages < 10000) { // Reasonable page count
          extract.pages = pages;
        }
      }
      
      // Description - find description text
      const descSelectors = [
        '[data-testid*="description"]',
        '[class*="description"]',
        '[class*="Description"]',
        '.BookPageMetadataSection__description',
        '.DetailsLayoutRightParagraph'
      ];
      
      for (const selector of descSelectors) {
        try {
          const elem = document.querySelector(selector);
          const text = elem?.textContent?.trim();
          if (text && text.length > 50) {
            extract.description = text.substring(0, 500);
            break;
          }
        } catch {}
      }
      
      // Cover image - find book cover
      const images = document.querySelectorAll('img');
      for (const img of Array.from(images)) {
        const src = img.src;
        const alt = img.alt || '';
        const className = img.className || '';
        
        if (src && (
          src.includes('cover') || 
          src.includes('book') ||
          alt.toLowerCase().includes('cover') || 
          className.toLowerCase().includes('cover') ||
          className.toLowerCase().includes('book')
        )) {
          extract.coverUrl = src;
          break;
        }
      }
      
      // If no cover found, try the largest image that looks like a book cover
      if (!extract.coverUrl && images.length > 0) {
        let largestImg = null;
        let maxSize = 0;
        
        for (const img of Array.from(images)) {
          const size = img.width * img.height;
          if (size > maxSize && img.src && 
              !img.src.includes('icon') && 
              !img.src.includes('logo') &&
              !img.src.includes('avatar') &&
              img.width > 100 && img.height > 100) {
            maxSize = size;
            largestImg = img;
          }
        }
        
        if (largestImg && maxSize > 15000) { // At least 150x100
          extract.coverUrl = largestImg.src;
        }
      }
      
      return extract;
    });
    
    // Log extraction results
    debug(`Extracted data:`, extractedData, { prefix: 'EXTRACT' });
    debug(`Page text length: ${extractedData.pageTextLength} chars`, {}, { prefix: 'EXTRACT' });
    
    // Now fetch genres from the shelves page
    debug('Fetching genres from shelves page...', {}, { prefix: 'GENRES' });
    
    try {
      // Extract work ID from the page
      const workId = await page.evaluate(() => {
        // Look for work ID in various places
        const bodyText = document.body?.innerText || '';
        const htmlContent = document.documentElement?.innerHTML || '';
        
        // Try to find work ID in links or data attributes
        const workLinks = document.querySelectorAll('a[href*="/work/"], [data-work-id]');
        for (const link of Array.from(workLinks)) {
          const href = (link as HTMLAnchorElement).href || '';
          const match = href.match(/\/work\/(\d+)/);
          if (match) return match[1];
          
          const dataWorkId = link.getAttribute('data-work-id');
          if (dataWorkId) return dataWorkId;
        }
        
        // Try to find in HTML content
        const htmlMatch = htmlContent.match(/\/work\/(\d+)/);
        if (htmlMatch) return htmlMatch[1];
        
        return null;
      });
      
      if (workId) {
        debug(`Found work ID: ${workId}`, {}, { prefix: 'GENRES' });
        const shelvesUrl = `https://www.goodreads.com/work/shelves/${workId}`;
        
        // Navigate to shelves page
        debug(`Navigating to shelves page...`, { shelvesUrl }, { prefix: 'GENRES' });
        await page.goto(shelvesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // Extract genres from shelves page
        const genres = await page.evaluate(() => {
          const genreData: Array<{ name: string; count: number }> = [];
          
          // Common non-genre shelf names to exclude
          const excludeShelves = new Set([
            'to-read', 'currently-reading', 'owned', 'own', 'favorites', 
            'owned-books', 'my-books', 'library', 'kindle', 'ebook', 'audiobook',
            'audiobooks', 'ebooks', 'read', 'default', 'wish-list', 'wishlist',
            'books-i-own', 'my-library', 'physical', 'paperback', 'hardcover',
            'tbr', 'to-buy', 'want-to-read', 'want', 'maybe', 'abandoned',
            'did-not-finish', 'dnf', 'finished', 'reviewed', 're-read', 'reread',
            'unread', 'read-in', 'read-20', 'home', 'calibre'
          ]);
          
          const bodyText = document.body?.innerText || '';
          
          // Parse shelves from the page
          // Format: "fantasy 1,459 people" or "dark-fantasy 99 people"
          const shelfPattern = /([a-z0-9-]+)\s+([\d,]+)\s+people/gi;
          let match;
          
          while ((match = shelfPattern.exec(bodyText)) !== null) {
            const shelfName = match[1].toLowerCase().trim();
            const count = parseInt(match[2].replace(/,/g, ''));
            
            // Filter out non-genre shelves
            if (!excludeShelves.has(shelfName) && 
                count > 0 && 
                shelfName.length > 2 && 
                shelfName.length < 40) {
              genreData.push({ name: shelfName, count });
            }
          }
          
          // Sort by count and return top genres
          return genreData
            .sort((a, b) => b.count - a.count)
            .slice(0, 15)
            .map(g => g.name);
        });
        
        if (genres.length > 0) {
          extractedData.genres = genres;
          success(`Extracted ${genres.length} genres from shelves`, { genres }, { prefix: 'GENRES' });
        } else {
          warn('No genres found on shelves page', {}, { prefix: 'GENRES' });
        }
        
      } else {
        warn('Could not find work ID - skipping genre extraction', {}, { prefix: 'GENRES' });
      }
      
    } catch (genreError) {
      warn(`Failed to fetch genres: ${genreError}`, {}, { prefix: 'GENRES' });
    }
    
    // Update extracted data with genres
    debug(`Final extracted data:`, extractedData, { prefix: 'EXTRACT' });
    
    // Apply extracted data to metadata
    if (extractedData.title) {
      metadata.title = extractedData.title;
      success(`✓ Title: "${metadata.title}"`, {}, { prefix: 'EXTRACT' });
    } else {
      warn('✗ Title not found', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.author) {
      metadata.author = extractedData.author;
      success(`✓ Author: "${metadata.author}"`, {}, { prefix: 'EXTRACT' });
    } else {
      warn('✗ Author not found', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.rating > 0) {
      metadata.rating = extractedData.rating;
      success(`✓ Rating: ${metadata.rating}`, {}, { prefix: 'EXTRACT' });
    } else {
      warn('✗ Rating not found', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.ratingsCount > 0) {
      metadata.ratingsCount = extractedData.ratingsCount;
      success(`✓ Ratings count: ${metadata.ratingsCount.toLocaleString()}`, {}, { prefix: 'EXTRACT' });
    } else {
      warn('✗ Ratings count not found', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.reviewsCount > 0) {
      metadata.reviewsCount = extractedData.reviewsCount;
      success(`✓ Reviews count: ${metadata.reviewsCount.toLocaleString()}`, {}, { prefix: 'EXTRACT' });
    } else {
      debug('Reviews count not found (optional)', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.genres.length > 0) {
      metadata.genres = extractedData.genres;
      success(`✓ Genres: ${metadata.genres.length} found`, { genres: metadata.genres }, { prefix: 'EXTRACT' });
    } else {
      warn('✗ No genres extracted', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.pages > 0) {
      metadata.pages = extractedData.pages;
      success(`✓ Pages: ${metadata.pages}`, {}, { prefix: 'EXTRACT' });
    } else {
      debug('Page count not found (optional)', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.description) {
      metadata.description = extractedData.description;
      success(`✓ Description: ${metadata.description.length} chars`, {}, { prefix: 'EXTRACT' });
    } else {
      debug('Description not found (optional)', {}, { prefix: 'EXTRACT' });
    }
    
    if (extractedData.coverUrl) {
      metadata.coverUrl = extractedData.coverUrl;
      success(`✓ Cover URL extracted`, {}, { prefix: 'EXTRACT' });
    } else {
      debug('Cover URL not found (optional)', {}, { prefix: 'EXTRACT' });
    }
    
    // Determine success
    const hasRequiredFields = metadata.title && metadata.author;
    if (hasRequiredFields) {
      stats.successful++;
      success(`Scrape completed successfully`, {}, { prefix: 'SCRAPER' });
    } else {
      stats.failed++;
      stats.errors.push(`Missing required fields: ${!metadata.title ? 'title' : ''} ${!metadata.author ? 'author' : ''}`);
      warn(`Scrape incomplete - missing required fields`, {}, { prefix: 'SCRAPER' });
    }
    
    await browser.close();
    debug('Browser closed', {}, { prefix: 'BROWSER' });
    
    return metadata;
    
  } catch (err) {
    error('Fatal error during scrape', err, { prefix: 'ERROR' });
    stats.failed++;
    stats.errors.push(String(err));
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

async function scrapeAllBooks() {
  section('📚 GOODREADS BOOK SCRAPER');
  
  const stats: ScrapeStats = {
    attempted: 0,
    successful: 0,
    failed: 0,
    startTime: Date.now(),
    errors: []
  };
  
  info('Initializing scraper...', {}, { prefix: 'INIT' });
  
  // Load configuration
  const configPath = join(__dirname, '..', 'src', 'features', 'books', 'data', 'books-config.ts');
  debug(`Config path: ${configPath}`, {}, { prefix: 'CONFIG' });
  
  if (!existsSync(configPath)) {
    error('Configuration file not found!', { configPath }, { prefix: 'CONFIG' });
    return;
  }
  
  info('Loading configuration...', {}, { prefix: 'CONFIG' });
  const configContent = readFileSync(configPath, 'utf-8');
  debug(`Config file size: ${(configContent.length / 1024).toFixed(2)} KB`, {}, { prefix: 'CONFIG' });
  
  // Extract URLs from bookUrls array
  debug('Parsing bookUrls from configuration...', {}, { prefix: 'CONFIG' });
  const urlsMatch = configContent.match(/export const bookUrls = \[([\s\S]*?)\];/);
  if (!urlsMatch) {
    error('Could not find bookUrls export in config file', {}, { prefix: 'CONFIG' });
    warn('Expected format: export const bookUrls = ["url1", "url2"];', {}, { prefix: 'CONFIG' });
    return;
  }
  
  const urlsContent = urlsMatch[1];
  const bookUrls = urlsContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('"') || line.startsWith("'"))
    .map(line => {
      const match = line.match(/["'](.*?)["']/);
      return match ? match[1] : null;
    })
    .filter(Boolean) as string[];
  
  success(`Found ${bookUrls.length} books to scrape`, { urls: bookUrls }, { prefix: 'CONFIG' });
  
  if (bookUrls.length === 0) {
    warn('No books found in configuration', {}, { prefix: 'CONFIG' });
    info('Add Goodreads URLs to books-config.ts to get started', {}, { prefix: 'CONFIG' });
    return;
  }
  
  separator();
  section('🔄 SCRAPING BOOKS');
  
  const metadata: BookMetadata[] = [];
  stats.attempted = bookUrls.length;
  
  for (let i = 0; i < bookUrls.length; i++) {
    const url = bookUrls[i];
    const bookNum = i + 1;
    
    separator('-');
    info(`Book ${bookNum}/${bookUrls.length}`, { url }, { prefix: 'PROGRESS' });
    progress(bookNum, bookUrls.length, url);
    
    const bookData = await scrapeGoodreadsBook(url, stats);
    if (bookData) {
      metadata.push(bookData);
      success(`Book ${bookNum} completed`, { title: bookData.title }, { prefix: 'PROGRESS' });
    } else {
      error(`Book ${bookNum} failed`, { url }, { prefix: 'PROGRESS' });
    }
    
    // Be polite to Goodreads servers
    if (i < bookUrls.length - 1) {
      const delayMs = 2000;
      debug(`Waiting ${delayMs}ms before next request...`, {}, { prefix: 'THROTTLE' });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  stats.endTime = Date.now();
  const totalTime = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
  
  separator();
  section('📊 SCRAPING RESULTS');
  
  info(`Total attempted: ${stats.attempted}`, {}, { prefix: 'STATS' });
  success(`Successful: ${stats.successful}`, {}, { prefix: 'STATS' });
  if (stats.failed > 0) {
    error(`Failed: ${stats.failed}`, {}, { prefix: 'STATS' });
  }
  info(`Total time: ${totalTime}s`, {}, { prefix: 'STATS' });
  
  if (stats.errors.length > 0) {
    separator();
    warn('Errors encountered:', {}, { prefix: 'ERRORS' });
    stats.errors.forEach((err, idx) => {
      error(`${idx + 1}. ${err}`, {}, { prefix: 'ERROR' });
    });
  }
  
  // Save metadata to file
  separator();
  section('💾 SAVING METADATA');
  
  const outputPath = join(__dirname, '..', 'src', 'features', 'books', 'data', 'books-metadata.json');
  debug(`Output path: ${outputPath}`, {}, { prefix: 'SAVE' });
  
  try {
    const jsonContent = JSON.stringify(metadata, null, 2);
    writeFileSync(outputPath, jsonContent, 'utf-8');
    success(`Metadata saved to books-metadata.json`, {}, { prefix: 'SAVE' });
    info(`Saved ${metadata.length} book records`, {}, { prefix: 'SAVE' });
    debug(`File size: ${(jsonContent.length / 1024).toFixed(2)} KB`, {}, { prefix: 'SAVE' });
  } catch (saveError) {
    error('Failed to save metadata', saveError, { prefix: 'SAVE' });
  }
  
  separator();
  section('✨ SCRAPING COMPLETE');
}

// Run the scraper
scrapeAllBooks().catch(err => {
  error('Unhandled error in scraper', err, { prefix: 'FATAL' });
  process.exit(1);
});
