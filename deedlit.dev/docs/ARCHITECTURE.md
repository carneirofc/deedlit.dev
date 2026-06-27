# Architecture Overview

## System Design

This is a Next.js 15 App Router application with a feature-based architecture, server-first rendering, and comprehensive E2E testing.

## Core Principles

1. **Server-first rendering** - Leverage React Server Components for optimal performance
2. **Feature isolation** - Each feature is self-contained with its own components, logic, and data
3. **Progressive enhancement** - Core functionality works without JavaScript
4. **Type safety** - Strict TypeScript throughout the application
5. **Testing-first** - Comprehensive E2E tests validate user workflows

## Directory Structure

```
deedlit.dev/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout with metadata
│   │   ├── page.tsx            # Home page (landing hub)
│   │   ├── books/              # Books route
│   │   ├── gallery/            # Gallery route
│   │   ├── services/           # Services route
│   │   └── api/                # API routes
│   │
│   ├── features/               # Feature modules
│   │   ├── books/              # Books feature
│   │   │   ├── components/     # Book-specific components
│   │   │   ├── hooks/          # Custom hooks
│   │   │   ├── lib/            # Business logic
│   │   │   ├── data/           # Static data & config
│   │   │   └── types.ts        # Type definitions
│   │   │
│   │   ├── gallery/            # Gallery feature
│   │   ├── services/           # Services feature
│   │   └── home/               # Home page feature
│   │
│   ├── components/             # Shared components
│   │   ├── layout/             # Layout components
│   │   └── pwa/                # PWA components
│   │
│   ├── lib/                    # Shared utilities
│   │   ├── logger.ts           # Server-side logging
│   │   └── client-logger.ts    # Client-side logging
│   │
│   └── proxy.ts                # Next.js proxy
│
├── e2e/                        # End-to-end tests
│   ├── books.spec.ts           # Books feature tests
│   ├── book-display.spec.ts    # UI rendering tests
│   ├── book-filters.spec.ts    # Filter functionality tests
│   ├── scraper.spec.ts         # Scraper validation
│   ├── security.spec.ts        # Security tests
│   └── exploratory.spec.ts     # Edge cases & discovery
│
├── scripts/                    # Build & automation scripts
│   ├── scrape-goodreads.ts     # Goodreads metadata scraper
│   └── playwright-examples.ts  # Test examples
│
├── public/                     # Static assets
│   ├── sw.js                   # Service worker
│   ├── icons/                  # PWA icons
│   └── images/                 # Static images
│
└── docs/                       # Documentation
    ├── AGENTS.md               # AI agent guide
    ├── ARCHITECTURE.md         # This file
    ├── TESTING.md              # Testing reference
    ├── LOGGING.md              # Logging documentation
    └── GLOSSARY.md             # Terminology
```

## Feature Architecture

Each feature follows a consistent structure for maintainability:

```
src/features/[feature]/
├── components/          # React components for this feature
│   ├── [Feature]Section.tsx    # Main section component
│   ├── [Feature]Card.tsx       # Card/item component
│   └── [Feature]Filters.tsx    # Filter controls
│
├── hooks/              # Custom React hooks
│   └── use[Feature]Filters.ts  # Filter state management
│
├── lib/                # Business logic & utilities
│   └── filtering.ts            # Pure functions for filtering/sorting
│
├── data/               # Static data & configuration
│   ├── [feature].ts            # Data definitions
│   ├── [feature]-config.ts     # Configuration
│   └── [feature]-metadata.json # Generated/fetched data
│
├── server/             # Server-side only code (optional)
│   └── [feature]-data.ts       # Data fetching logic
│
├── types.ts            # TypeScript type definitions
└── README.md           # Feature documentation
```

## Design Patterns

### 1. Server Components (Default)

Server Components are the default and handle:
- Data fetching
- Static rendering
- SEO optimization
- Initial page load

```typescript
// app/books/page.tsx
import { BooksSection } from '@/features/books/components/BooksSection';
import { books } from '@/features/books/data/books';

export default function BooksPage() {
  return <BooksSection books={books} />;
}
```

### 2. Client Components (Explicit)

Client Components use `"use client"` directive for:
- Interactive state (useState, useReducer)
- Browser APIs (localStorage, window)
- Event handlers
- Effects (useEffect)

```typescript
// features/books/components/BookFilters.tsx
"use client";
import { useState } from 'react';

export function BookFilters() {
  const [query, setQuery] = useState('');
  // ... interactive logic
}
```

### 3. Custom Hooks

Encapsulate reusable stateful logic:

```typescript
// features/books/hooks/useBookFilters.ts
export function useBookFilters(books: Book[]) {
  const [filters, setFilters] = useState<FilterState>({
    query: '',
    genres: [],
    sortBy: 'title'
  });
  
  const filtered = useMemo(
    () => filterBooks(books, filters),
    [books, filters]
  );
  
  return { filters, setFilters, filtered };
}
```

### 4. Pure Business Logic

Keep business logic in separate functions for testability:

```typescript
// features/books/lib/filtering.ts
export function filterBooks(
  books: Book[],
  filters: FilterState
): Book[] {
  return books
    .filter(book => matchesQuery(book, filters.query))
    .filter(book => matchesGenres(book, filters.genres))
    .sort(getSortComparator(filters.sortBy));
}
```

## Data Flow

### Books Feature Data Flow

```
1. Configuration
   books-config.ts (URLs) → User edits to add books

2. Scraping (Build-time)
   scrape-goodreads.ts → Playwright scraper → books-metadata.json

3. Runtime Loading
   books.ts imports metadata → books array

4. Rendering
   Server Component passes data → Client Component filters → UI
```

### Gallery Feature Data Flow

```
1. File System
   public/images/gallery/*.{jpg,png,webp}

2. Build-time Index
   gallery-data.ts scans directory → generates image list

3. API Route
   /api/gallery → returns image metadata

4. Client Rendering
   Gallery page → fetch() → filter → display
```

## Component Composition

### Composition Pattern

```
Page (Server Component)
  └─> Feature Section (Server Component)
      ├─> Filters (Client Component)
      │   └─> uses custom hook for state
      └─> List (Server Component)
          └─> Card (Server Component)
              └─> Interactive Button (Client Component)
```

### Example: Books Page

```
BooksPage (server)
  └─> BooksSection (client - needs filtering state)
      ├─> BookFilters (client)
      └─> BookCard[] (server, passed as children)
```

## State Management

### Local State
- `useState` for simple component state
- `useReducer` for complex state machines
- Custom hooks for shared logic

### Server State
- React Server Components for initial data
- No separate state management library needed
- API routes for dynamic data

### Client State Persistence
- `localStorage` for user preferences
- Service worker for offline support
- URL state for shareable filters

## Testing Architecture

### Test Pyramid

```
E2E Tests (e2e/*.spec.ts)
├── Feature tests - User workflows
├── Display tests - UI rendering  
├── Filter tests - Interactions
└── Exploratory tests - Edge cases
```

### Test Strategy

1. **Feature Tests** - High-level user workflows
   - Navigation between pages
   - Complete user journeys
   - Integration of multiple features

2. **Display Tests** - UI rendering validation
   - Elements appear correctly
   - Images load properly
   - Responsive behavior

3. **Filter Tests** - Interactive functionality
   - Search and filter operations
   - Sort functionality
   - State management

4. **Scraper Tests** - Data validation
   - Configuration integrity
   - Metadata structure
   - Data quality

## Performance Optimizations

### Build-time Optimizations
- Static page generation where possible
- Image optimization with Next.js Image
- CSS tree-shaking with Tailwind
- TypeScript type checking

### Runtime Optimizations
- React Server Components reduce bundle size
- Lazy loading for routes
- Image lazy loading
- Service worker caching

### Developer Experience
- Fast Refresh for instant feedback
- TypeScript for type safety
- ESLint for code quality
- Playwright for reliable testing

## Security Considerations

### Content Security
- Input sanitization for user-generated content
- XSS prevention with React's default escaping
- HTTPS only in production

### Data Security
- No sensitive data in client bundles
- Environment variables for secrets
- Rate limiting on API routes

### Dependencies
- Regular security audits with `npm audit`
- Dependency updates via Dependabot
- Security testing in E2E suite

## Build & Deployment

### Development
```bash
npm run dev           # Start on localhost:3001
npm run test:e2e      # Run tests
```

### Production
```bash
npm run build         # Create optimized build
npm run start         # Start production server
```

### Environment Variables
None required for core functionality. Optional:
- `NODE_ENV` - Set by Next.js
- Custom vars for external services

## Extension Points

### Adding a New Feature

1. Create feature directory: `src/features/new-feature/`
2. Add components, hooks, lib as needed
3. Create types.ts for type definitions
4. Add E2E tests in `e2e/new-feature.spec.ts`
5. Create route in `src/app/new-feature/page.tsx`
6. Document in feature README.md

### Adding a New API Route

1. Create in `src/app/api/[route]/route.ts`
2. Export HTTP method handlers (GET, POST, etc.)
3. Use TypeScript for request/response types
4. Add error handling
5. Test with E2E tests

### Adding a New Test Suite

1. Create `e2e/feature-name.spec.ts`
2. Follow existing test patterns
3. Use descriptive test names
4. Add to docs/TESTING.md reference

## Technology Decisions

### Why Next.js App Router?
- Server Components reduce bundle size
- Built-in routing and layouts
- Excellent TypeScript support
- Great developer experience

### Why Playwright?
- Cross-browser testing
- Reliable auto-waiting
- Excellent debugging tools
- TypeScript first-class support

### Why Feature-based Architecture?
- Scales well with team size
- Clear boundaries between features
- Easy to test in isolation
- Reduces cognitive load

### Why TypeScript Strict Mode?
- Catches errors at compile time
- Better IDE experience
- Self-documenting code
- Safer refactoring

## Future Considerations

### Potential Enhancements
- Database integration for dynamic content
- User authentication and personalization
- Real-time updates with WebSockets
- Advanced caching strategies
- Internationalization (i18n)

### Scalability
- Current architecture supports small-to-medium sites
- Can add database layer without major refactoring
- Feature modules can be extracted to microservices
- Static generation ensures good performance at scale

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Server Components](https://react.dev/reference/react/use-server)
- [Playwright Testing](https://playwright.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

