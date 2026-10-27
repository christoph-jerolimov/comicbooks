// Build-time loader: every folder in public/comics/ that contains a book.yaml
// becomes one comic book. Runs only on the server during `astro build`/`dev`.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import sharp from 'sharp';

export interface ComicPage {
  /** 1-based page number */
  number: number;
  /** URL of the image, relative to site root */
  src: string;
  /** File name inside the book folder */
  file: string;
  caption?: string;
  width: number;
  height: number;
}

export interface ComicBook {
  slug: string;
  title: string;
  subtitle?: string;
  author?: string;
  issue?: number | string;
  description?: string;
  tags: string[];
  direction: 'ltr' | 'rtl';
  cover: string;
  pages: ComicPage[];
}

interface Manifest {
  title?: string;
  subtitle?: string;
  author?: string;
  issue?: number | string;
  description?: string;
  tags?: string[];
  direction?: string;
  cover?: string;
  pages?: Array<string | { file: string; caption?: string }>;
}

const COMICS_DIR = path.resolve('public/comics');
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

async function imageSize(file: string): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(file).metadata();
    return { width: meta.width ?? 3, height: meta.height ?? 4 };
  } catch {
    return { width: 3, height: 4 };
  }
}

async function loadBook(slug: string): Promise<ComicBook | null> {
  const dir = path.join(COMICS_DIR, slug);
  const manifestPath = path.join(dir, 'book.yaml');
  let manifest: Manifest;
  try {
    manifest = (parse(await readFile(manifestPath, 'utf8')) as Manifest) ?? {};
  } catch {
    return null; // folders without a manifest are ignored
  }

  const entries = (await readdir(dir)).filter((f) => IMAGE_RE.test(f)).sort(collator.compare);
  const cover = manifest.cover ?? entries.find((f) => /^cover\./i.test(f)) ?? entries[0];

  // Explicit order from the manifest, otherwise alphabetical minus the cover.
  const ordered: Array<{ file: string; caption?: string }> = manifest.pages
    ? manifest.pages.map((p) => (typeof p === 'string' ? { file: p } : p))
    : entries.filter((f) => f !== cover).map((file) => ({ file }));

  const pages: ComicPage[] = [];
  for (const [i, p] of ordered.entries()) {
    const abs = path.join(dir, p.file);
    try {
      await stat(abs);
    } catch {
      console.warn(`[comics] ${slug}/book.yaml lists missing file "${p.file}", skipping`);
      continue;
    }
    pages.push({
      number: i + 1,
      file: p.file,
      src: `/comics/${slug}/${encodeURIComponent(p.file)}`,
      caption: p.caption,
      ...(await imageSize(abs)),
    });
  }
  pages.forEach((p, i) => (p.number = i + 1));

  return {
    slug,
    title: manifest.title ?? slug,
    subtitle: manifest.subtitle,
    author: manifest.author,
    issue: manifest.issue,
    description: manifest.description,
    tags: manifest.tags ?? [],
    direction: manifest.direction === 'rtl' ? 'rtl' : 'ltr',
    cover: cover ? `/comics/${slug}/${encodeURIComponent(cover)}` : (pages[0]?.src ?? ''),
    pages,
  };
}

let cache: Promise<ComicBook[]> | undefined;

export function getBooks(): Promise<ComicBook[]> {
  cache ??= (async () => {
    const dirs = (await readdir(COMICS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
    const books = await Promise.all(dirs.map((d) => loadBook(d.name)));
    return books
      .filter((b): b is ComicBook => b !== null && b.pages.length > 0)
      .sort((a, b) => collator.compare(a.title, b.title));
  })();
  return cache;
}

export async function getBook(slug: string): Promise<ComicBook | undefined> {
  return (await getBooks()).find((b) => b.slug === slug);
}
