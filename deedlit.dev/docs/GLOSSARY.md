# Project Glossary

This document defines key terms and concepts used throughout the project.

## General Terms

**Agent** / **AI Assistant**
AI-powered development assistant (like GitHub Copilot, Cursor, or Claude) that helps with code generation, testing, and documentation.

**E2E** (End-to-End)
Testing that validates complete user workflows from start to finish, simulating real user interactions in a browser.

**PWA** (Progressive Web App)
Web application that can be installed on devices and works offline using service workers and manifests.

## Project-Specific Terms

**Books Feature**
A curated book collection with metadata scraped from Goodreads, including covers, ratings, genres, and descriptions.

**Gallery Feature**
Image browsing feature with filtering capabilities for displaying photos and artwork.

**Services Feature**
Directory of local services, originally designed for subdomain-based services (*.local.deedlit.dev).

**Home Feature**
Landing page/hub that showcases featured content and provides navigation to other sections.

## Technical Terms

**App Router**
Next.js 13+ routing system based on the file system, using the `app/` directory instead of `pages/`.

**Server Component**
React component that renders on the server, reducing client-side JavaScript and improving performance. Default in Next.js 15.

**Client Component**
React component marked with `"use client"` that renders in the browser and can use client-side features like state, effects, and browser APIs.

**Feature Module**
Self-contained directory containing all code related to a specific feature (components, hooks, utilities, data, types).

**Path Alias**
TypeScript/JavaScript import shortcut. In this project, `@/*` maps to `src/*` for cleaner imports.

## Architecture Terms

**Collocation**
Practice of keeping related files together in the same directory (e.g., component, styles, tests, types).

**Composition**
Building complex components by combining simpler ones, rather than using inheritance.

**Pure Function**
Function that always returns the same output for the same input and has no side effects.

**Business Logic**
Core functionality and rules that define how data is processed, separate from UI concerns.

## Testing Terms

**Test Suite**
Collection of related tests in a single file (e.g., `books.spec.ts`).

**Test Case** / **Test**
Individual test that validates a specific behavior (e.g., "should display book cards").

**Spec** / **Specification**
File containing tests, typically with `.spec.ts` extension.

**Headed Mode**
Running tests with the browser window visible, useful for debugging.

**Headless Mode**
Running tests without a visible browser window, faster and used in CI/CD.

**Selector**
String that identifies an element in the DOM, used to interact with elements in tests.

**Assertion**
Statement that checks if an expected condition is true (e.g., `expect(element).toBeVisible()`).

**Fixture**
Test data or setup code that provides a known starting state for tests.

**Page Object**
Design pattern that encapsulates page interactions in a reusable object.

## Data Terms

**Metadata**
Descriptive information about content (e.g., book titles, authors, ratings, publication dates).

**Scraper**
Automated tool that extracts data from websites. This project uses Playwright to scrape Goodreads.

**Seed Data**
Initial data used to populate the application, stored in JSON files or configuration.

**Configuration File**
File containing settings and data that control application behavior (e.g., `books-config.ts`).

## Books Feature Specific

**Books Config** (`books-config.ts`)
Configuration file containing Goodreads URLs for books to scrape.

**Books Metadata** (`books-metadata.json`)
Generated JSON file containing scraped data from Goodreads for all configured books.

**Goodreads ID**
Unique identifier for a book on Goodreads (e.g., the number in `/book/show/123456`).

**Genre / Tag**
Category or label describing a book's content (e.g., Fantasy, Science Fiction, Thriller).

**Rating**
Numerical score from 0-5 representing average reader rating on Goodreads.

**Cover Image**
Book cover artwork, typically fetched from Goodreads CDN.

## Gallery Feature Specific

**Image Index**
Build-time generated list of available images in the gallery.

**Gallery Card**
Component displaying a single image with metadata in the gallery grid.

**Image Modal**
Full-screen overlay for viewing enlarged images.

## Component Terms

**Section Component**
Main feature component that orchestrates layout and data flow (e.g., `BooksSection`).

**Card Component**
Reusable component for displaying individual items in a grid or list (e.g., `BookCard`).

**Filter Component**
UI controls for filtering and sorting data (e.g., `BookFilters`).

**Layout Component**
Components that define page structure (e.g., `Header`, `Footer`).

## Hook Terms

**Custom Hook**
Reusable function starting with "use" that encapsulates stateful logic (e.g., `useBookFilters`).

**State Hook** (`useState`)
React hook for managing component state.

**Effect Hook** (`useEffect`)
React hook for side effects like data fetching or subscriptions.

**Memo Hook** (`useMemo`)
React hook for memoizing expensive computations.

## Development Terms

**Dev Server**
Local development server that provides hot reloading and fast refresh (runs on port 3001).

**Hot Reload** / **Fast Refresh**
Automatic update of the browser when code changes, preserving component state.

**Build**
Process of compiling and optimizing code for production deployment.

**Type Checking**
Process of verifying TypeScript types are correct throughout the codebase.

**Linting**
Static code analysis to find and fix code style and quality issues.

## File Types

**`.tsx`** - TypeScript + JSX (React components)
**`.ts`** - TypeScript (utilities, types, server code)
**`.json`** - JSON data files (configuration, metadata)
**`.spec.ts`** - Test specification files (Playwright tests)
**`.config.ts`** - Configuration files (Next.js, TypeScript, Playwright)

## Directories

**`src/`** - Source code (application code)
**`e2e/`** - End-to-end tests (Playwright tests)
**`public/`** - Static assets (images, service worker)
**`docs/`** - Documentation (guides, references)
**`scripts/`** - Automation scripts (scraper, build tools)

## Special Files

**`page.tsx`** - Next.js route page component
**`layout.tsx`** - Next.js layout wrapper
**`route.ts`** - Next.js API route handler
**`proxy.ts`** - Next.js proxy for request/response processing
**`manifest.ts`** - PWA manifest generator
**`sw.js`** - Service worker for offline support

## Commands

**`npm run dev`** - Start development server
**`npm run build`** - Build for production
**`npm run test:e2e`** - Run end-to-end tests
**`npm run scrape-goodreads`** - Scrape Goodreads metadata
**`npx playwright test`** - Run Playwright tests

## Acronyms

- **API** - Application Programming Interface
- **CDN** - Content Delivery Network
- **CI/CD** - Continuous Integration / Continuous Deployment
- **CSS** - Cascading Style Sheets
- **DOM** - Document Object Model
- **E2E** - End-to-End
- **HTTP** - Hypertext Transfer Protocol
- **HTTPS** - HTTP Secure
- **JSX** - JavaScript XML
- **PWA** - Progressive Web App
- **SEO** - Search Engine Optimization
- **SSR** - Server-Side Rendering
- **TDD** - Test-Driven Development
- **UI** - User Interface
- **URL** - Uniform Resource Locator
- **UX** - User Experience
- **XSS** - Cross-Site Scripting

## Status Terms

**✅ Completed** - Feature or task fully implemented and tested
**🚧 In Progress** - Currently being worked on
**⏱️ Planned** - Scheduled for future implementation
**🐛 Bug** - Issue that needs to be fixed
**⚠️ Warning** - Caution or important note

## Quality Terms

**Code Coverage**
Percentage of code executed by tests.

**Type Safety**
Assurance that values match their declared types at compile time.

**Tech Debt**
Code that needs refactoring or improvement for maintainability.

**Breaking Change**
Modification that requires updates to dependent code.

**Backward Compatible**
Change that doesn't break existing functionality or APIs.

## Performance Terms

**Bundle Size**
Size of JavaScript files sent to the browser.

**Code Splitting**
Breaking JavaScript into smaller chunks that load on demand.

**Lazy Loading**
Deferring loading of resources until they're needed.

**Hydration**
Process of attaching JavaScript to server-rendered HTML.

**Optimization**
Improving performance, bundle size, or user experience.

---

_For more detailed explanations, see:_
- _[ARCHITECTURE.md](ARCHITECTURE.md) for system design_
- _[AGENTS.md](AGENTS.md) for development workflows_
- _[TESTING.md](TESTING.md) for testing patterns_
