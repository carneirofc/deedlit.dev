# deedlit.dev — Monorepo

An npm workspace monorepo containing the deedlit.dev landing site, the ComfyHelper image management app, and a shared UI component library.

## Packages

| Package | Description |
|---|---|
| [`deedlit.dev`](./deedlit.dev/) | Public-facing Next.js site — home, books, gallery, and services |
| [`deedlit.dev.comfyhelper`](./deedlit.dev.comfyhelper/) | Next.js app for managing ComfyUI image libraries, metadata, notes, and scan workflows |
| [`deedlit.dev.ui`](./deedlit.dev.ui/) | Shared React UI component library (`@deedlit.dev/ui`) consumed by both apps |

## Contributing

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)**. All commit messages must follow the format:

```
<type>(optional scope): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`.

## Prerequisites

- [Node.js](https://nodejs.org/) (check `.nvmrc` or `engines` field in each package for the required version)
- npm 10+

## Getting Started

Install all workspace dependencies from the repo root:

```bash
npm install
```

## Development

Run each app in dev mode (the shared UI package does not have its own dev server):

```bash
# Landing site (port 3001)
npm run dev:dev

# ComfyHelper app (default Next.js port)
npm run dev:comfyhelper
```

## Building

```bash
# Build shared UI only
npm run build:ui

# Build landing site (includes UI build)
npm run build:dev

# Build ComfyHelper (includes UI build)
npm run build:comfyhelper

# Build everything
npm run build
```

## Project Structure

```
deedlit.dev/              ← landing site (Next.js)
  src/app/                ← Next.js App Router pages
  src/features/           ← feature modules
  scripts/                ← build and data scripts

deedlit.dev.comfyhelper/  ← ComfyHelper app (Next.js + Prisma/SQLite)
  app/                    ← Next.js App Router pages
  lib/                    ← server utilities, scan logic, SSE
  prisma/                 ← schema and migrations

deedlit.dev.ui/           ← shared component library
  src/                    ← component source and exports
  styles/                 ← global CSS variables and base styles
```
