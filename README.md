# Comicbooks

A comic book reader built with [Astro](https://astro.build). Every folder in
`public/comics/` is one book; a small `book.yaml` describes it and the order of
its pages. The site is fully static and works on desktop browsers and phones.

## Reading

| Action                   | Phone / tablet                     | Desktop                        |
| ------------------------ | ---------------------------------- | ------------------------------ |
| Next / previous page     | swipe left / right, or ◀ ▶ buttons | drag, ← →, Space, PageUp/Down  |
| All pages (overview)     | swipe up, or the **Pages** button  | ↑, `o`, `g`, or **Pages**      |
| Close overview           | swipe down, tap a page, or Close   | Esc, ↓, click a page, or Close |
| Hide / show the bars     | tap the page                       | click the page, or `h`         |
| First / last page        |                                    | Home / End                     |

The current page is kept in the URL hash (`/read/astro-cat/#4`) and remembered
per book in `localStorage`, so reopening a book continues where you left off.
Books with `direction: rtl` (manga) swap the swipe and arrow-key directions.

## Adding a book

1. Create a folder in `public/comics/`, e.g. `public/comics/my-book/`.
2. Drop the page images in it (`png`, `jpg`, `webp`, `gif`, `avif`, `svg`).
3. Add a `book.yaml`:

```yaml
title: "My Book"
subtitle: "An optional subtitle"
author: "Me"
issue: 1
description: "Shown on the shelf."
tags: [fun, short]
cover: cover.png        # optional; defaults to cover.* or the first image
direction: ltr          # ltr (default) or rtl

# Optional. Without "pages", every image in the folder (except the cover)
# is used, sorted naturally by file name (page-2 before page-10).
pages:
  - page-01.png
  - file: page-02.png
    caption: "Captions show up in the overview"
  - page-03.png
```

The build reads each manifest, measures the images, and generates one route
per book under `/read/<folder-name>/`. Files listed in `pages` that do not
exist are skipped with a warning.

## Development

```sh
npm install
npm run dev              # http://localhost:4321/comicbooks/
npm run build            # static site in dist/
npm run preview          # serve dist/
npm run generate:samples # regenerate the three sample books
```

The sample books (`astro-cat`, `pixel-knight`, `noodle-and-bolt`) are drawn
procedurally by `scripts/generate-samples.mjs`, which also writes their
`book.yaml` files. `noodle-and-bolt` uses descriptive file names and an explicit
`pages` list; the other two rely on alphabetical ordering.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site
and publishes `dist/` to GitHub Pages at
<https://christoph-jerolimov.github.io/comicbooks/>. One-time setup in the
repository settings: **Settings → Pages → Build and deployment → Source** must
be set to **GitHub Actions**. The workflow can also be started by hand from
the Actions tab.

The project page lives under `/comicbooks/`, so `astro.config.mjs` sets
`base` accordingly and all internal links go through `withBase()` in
`src/lib/url.ts`. To serve from the root of a custom domain, build with
`BASE_PATH=/` and change `site` in the config.

## Project layout

```
public/comics/<book>/     images + book.yaml, one folder per book
scripts/generate-samples.mjs
src/lib/books.ts          build-time loader for the manifests
src/lib/url.ts            base-path helper for links
.github/workflows/deploy.yml  GitHub Pages deployment
src/pages/index.astro     the shelf
src/pages/read/[slug]/    the reader route
src/components/Viewer.astro  reader UI, gestures, overview
src/layouts/Base.astro
src/styles/global.css
```
