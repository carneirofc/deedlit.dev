# Logging System Documentation

## Overview

The project includes comprehensive logging throughout the application to track operations, performance, and debugging information. Logging is only active in development mode (`NODE_ENV === 'development'`) to keep production clean.

## Logging Utilities

### Server-Side Logger (`src/lib/logger.ts`)

A powerful singleton logger for Node.js/server-side code with rich formatting capabilities.

**Features:**
- Colored console output (red, green, yellow, blue, cyan, gray)
- Timestamp formatting
- Log levels (debug, info, warn, error, success)
- Prefixes for categorization
- Progress bars
- Table output
- Section separators and grouping

**Usage:**

```typescript
import { Logger } from '@/lib/logger';

const logger = Logger.getInstance();

// Basic logging with levels
logger.debug('Detailed debugging information');
logger.info('General information');
logger.warn('Warning message');
logger.error('Error message');
logger.success('Success message');

// Custom prefix
logger.log('CUSTOM', 'Message with custom prefix', 'blue');

// Visual separators
logger.separator();
logger.section('Section Title');

// Progress bars
logger.progress(60, 100); // Shows: [████████████░░░░░░░░] 60%

// Tables
logger.table([
  { id: 1, name: 'Item 1', value: 100 },
  { id: 2, name: 'Item 2', value: 200 }
]);

// Grouping
logger.group('Group Title', () => {
  logger.info('Nested message 1');
  logger.info('Nested message 2');
});
```

### Client-Side Logger (`src/lib/client-logger.ts`)

A browser-safe logger for React components with styled console output.

**Features:**
- SSR-safe (checks for browser environment)
- Styled console messages
- Log levels with emoji indicators
- Grouping support
- Collapsible groups

**Usage:**

```typescript
import { clientLogger } from '@/lib/client-logger';

// Basic logging
clientLogger.log('Message');
clientLogger.debug('Debug info');
clientLogger.info('Information');
clientLogger.warn('Warning');
clientLogger.error('Error');

// Grouping
clientLogger.group('Filter Updates', () => {
  clientLogger.debug('Genre:', ['Fantasy', 'Sci-Fi']);
  clientLogger.debug('Rating:', 4.5);
});
```

## Logged Components

### Books Feature

**Files with logging:**
- `src/features/books/data/books.ts` - Book data loading and metadata merging
- `src/features/books/hooks/useBookFilters.ts` - Filter state management and timing

**What's logged:**
- Number of books loaded from metadata
- Book overrides applied
- Unique genres and tags discovered
- Filter initialization
- Filter changes (query, sort, genres, tags, ratings)
- Filtering performance (duration, input/output counts)

**Example output:**
```
[BOOKS] 📚 Loading books from metadata...
[BOOKS] Found 7 books in metadata
[BOOKS] Applying overrides to book 1: { url: '...', overrides: { tags: [...] } }
[BOOKS] ✅ Loaded 7 books successfully
[BOOKS] Found 15 unique genres: ['Fantasy', 'Adventure', ...]
[BOOKS] Found 5 unique tags: ['light-novel', 'anime', ...]

[BOOK_FILTERS] 🔍 Initializing book filters with 7 books
[BOOK_FILTERS] Setting query: sword art
[BOOK_FILTERS] Filtered 7 books → 2 results in 1.23ms
```

### Gallery Feature

**Files with logging:**
- `src/app/api/gallery/route.ts` - Gallery API endpoint
- `src/features/gallery/server/gallery-data.ts` - Gallery data aggregation
- `src/features/gallery/server/image-index.ts` - Image filesystem indexing
- `src/features/gallery/hooks/useGalleryFilters.ts` - Gallery filter management

**What's logged:**
- API request timing
- Image directory scanning (entries found, filtered count)
- Image indexing performance
- File system watcher events
- Snapshot caching (hits, misses, refresh timing)
- Filter operations and performance

**Example output:**
```
[IMAGE_INDEX] 📂 Image directory: /path/to/public/images
[IMAGE_INDEX] Supported extensions: ['.png', '.jpg', '.jpeg', ...]
[IMAGE_INDEX] 👁️ Starting file system watcher...
[IMAGE_INDEX] ✅ File system watcher started
[IMAGE_INDEX] 🔍 Scanning image directory...
[IMAGE_INDEX] Found 42 total entries in directory
[IMAGE_INDEX] Filtered to 40 valid image files
[IMAGE_INDEX] ✅ Indexed 40 images in 45.67ms
[IMAGE_INDEX] 💾 Snapshot cached with 40 images

[GALLERY_DATA] 🖼️ Loading gallery data...
[GALLERY_DATA] Found 40 indexed images
[GALLERY_DATA] ✅ Gallery data loaded in 52.34ms: { totalAssets: 40, pngCount: 35, ... }

[GALLERY_API] 📥 Gallery API request received
[GALLERY_API] ✅ Gallery data loaded in 55.12ms: { assets: 40, tags: 0, stats: {...} }
```

### Image Serving

**Files with logging:**
- `src/app/image/route.ts` - Image serving with metadata stripping

**What's logged:**
- Image requests (ID parameter)
- Image lookup results
- File reading (size in bytes)
- PNG metadata stripping (chunks removed, bytes saved)
- Request timing and response size

**Example output:**
```
[IMAGE_ROUTE] 📥 Image request: abc123def456
[IMAGE_ROUTE] 📄 Found image: image-001.png (ext: .png)
[IMAGE_ROUTE] 📖 Read file: 1245678 bytes
[IMAGE_ROUTE] 🗑️ Stripped 3 metadata chunks (saved 45623 bytes, 3.7%)
[IMAGE_ROUTE] ✅ Served image in 12.34ms (1200055 bytes, image/png)
```

### Goodreads Scraper

**Files with logging:**
- `scripts/scrape-goodreads.ts` - Web scraping with Playwright

**What's logged:**
- Configuration loading
- URL parsing and validation
- Browser initialization
- Page navigation timing
- Field extraction (title, author, rating, genres, pages, description, cover)
- Success/failure statistics
- Summary tables
- Error collection

**Example output:**
```
════════════════════════════════════════════════════════════════════
  🔍 GOODREADS METADATA SCRAPER
════════════════════════════════════════════════════════════════════

ℹ️ INFO: Loading configuration from books-config.ts...
✅ SUCCESS: Found 7 URLs to scrape
────────────────────────────────────────────────────────────────────

[████████████████████] 100%

scraped 7 books:
┌─────────┬───────────────────────────┬─────────────────┬────────┬────────┐
│ id      │ title                     │ author          │ rating │ genres │
├─────────┼───────────────────────────┼─────────────────┼────────┼────────┤
│ abc123  │ Sword Art Online          │ Reki Kawahara   │ 4.08   │ 10     │
│ def456  │ The Name of the Wind      │ Patrick Rothfuss│ 4.54   │ 8      │
└─────────┴───────────────────────────┴─────────────────┴────────┴────────┘

Statistics:
  • Total URLs: 7
  • Successfully scraped: 7
  • Failed: 0
  • Success rate: 100.0%
  • Total time: 45.23s

✅ Metadata saved to: src/features/books/data/books-metadata.json

Next steps:
  1. Review the scraped metadata in books-metadata.json
  2. Add any custom overrides in books-config.ts
  3. The book data will automatically update on next page load
```

## Configuration

### Enabling/Disabling Logs

Logging is automatically controlled by `NODE_ENV`:

```bash
# Development (logs enabled)
npm run dev

# Production (logs disabled)
npm run build
npm start
```

### Adjusting Log Levels

For the server-side logger, you can set the log level:

```typescript
import { Logger } from '@/lib/logger';

const logger = Logger.getInstance();
logger.setLogLevel('warn'); // Only show warn and error
logger.setLogLevel('debug'); // Show all logs (default)
```

## Log Output Conventions

### Emoji Indicators
- 🔍 - Search/lookup operations
- 📚 📖 📄 🖼️ 📂 - Data loading/reading
- ✅ - Success
- ❌ - Error/failure
- ⚠️ - Warning
- ℹ️ - Information
- 🔄 - Refresh/update
- 💾 - Caching operations
- 👁️ - Watching/monitoring
- ⏱️ - Timing/scheduling
- 📥 - Incoming request
- 🗑️ - Deletion/cleanup

### Prefixes
Each logging area uses a consistent prefix in square brackets:
- `[BOOKS]` - Book data loading
- `[BOOK_FILTERS]` - Book filtering
- `[GALLERY_API]` - Gallery API endpoint
- `[GALLERY_DATA]` - Gallery data loading
- `[GALLERY_FILTERS]` - Gallery filtering
- `[IMAGE_INDEX]` - Image indexing system
- `[IMAGE_ROUTE]` - Image serving endpoint
- `[SCRAPER]` - Goodreads scraper

### Performance Timing

Performance measurements are consistently formatted:
```
✅ Operation completed in 12.34ms (results: 42)
```

## Best Practices

1. **Use appropriate log levels:**
   - `debug()` - Detailed information for debugging
   - `info()` - General informational messages
   - `warn()` - Warning messages for non-critical issues
   - `error()` - Error messages for failures
   - `success()` - Success confirmations

2. **Include context:**
   ```typescript
   logger.info('Loading books', { count: books.length, source: 'metadata.json' });
   ```

3. **Measure performance:**
   ```typescript
   const startTime = performance.now();
   // ... operation ...
   const duration = (performance.now() - startTime).toFixed(2);
   logger.info(`Operation completed in ${duration}ms`);
   ```

4. **Use consistent prefixes:**
   ```typescript
   const log = (...args: any[]) => isDev && console.log('[YOUR_FEATURE]', ...args);
   ```

5. **Don't log sensitive data:**
   - Avoid logging passwords, tokens, or API keys
   - Sanitize user input before logging
   - Be mindful of PII (personally identifiable information)

## Troubleshooting

### Logs not appearing?

1. Check that you're in development mode:
   ```bash
   echo %NODE_ENV%  # Windows
   echo $NODE_ENV   # Linux/Mac
   ```

2. For server-side logs, check the terminal where `npm run dev` is running

3. For client-side logs, check the browser console (F12)

### Too many logs?

Adjust the log level or comment out specific logging calls:

```typescript
// Temporarily disable verbose logging
// log('Detailed debug info');
```

### Performance impact?

- Logging is disabled in production automatically
- Development logging has minimal impact
- Use `logger.setLogLevel()` to reduce verbosity
