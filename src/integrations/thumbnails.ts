// Astro integration that produces small WebP thumbnails for every image in
// public/comics/<book>/. They are served under /thumbs/<book>/<file>.webp:
// rendered on demand by a dev-server middleware, and written into the output
// directory at the end of `astro build`.
import type { AstroIntegration } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const THUMB_WIDTH = 480;
const COMICS_DIR = path.resolve('public/comics');
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

function thumb(src: string) {
  return sharp(src, { animated: false })
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 74 });
}

export default function thumbnails(): AstroIntegration {
  let base = '/';
  return {
    name: 'comic-thumbnails',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base;
      },

      // Dev: /thumbs/<book>/<file>.webp is rendered from public/comics/<book>/<file> on request.
      'astro:server:setup': ({ server }) => {
        const prefixes = [`${base.replace(/\/+$/, '')}/thumbs/`, '/thumbs/'];
        const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = (req.url ?? '').split('?')[0];
          const prefix = prefixes.find((p) => url.startsWith(p));
          if (!prefix || !url.endsWith('.webp')) return next();
          const rel = decodeURIComponent(url.slice(prefix.length, -'.webp'.length));
          const src = path.resolve(COMICS_DIR, rel);
          if (!src.startsWith(COMICS_DIR + path.sep) || !IMAGE_RE.test(src)) return next();
          try {
            const buf = await thumb(src).toBuffer();
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(buf);
          } catch {
            next();
          }
        };
        // Astro's own request handler is already registered and answers 404 for
        // unknown paths, so this has to run before it, not after.
        server.middlewares.stack.unshift({ route: '', handle });
      },

      // Build: write thumbnails for every book image into dist/thumbs/.
      'astro:build:done': async ({ dir, logger }) => {
        const out = path.join(fileURLToPath(dir), 'thumbs');
        let count = 0;
        const books = (await readdir(COMICS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
        for (const book of books) {
          const srcDir = path.join(COMICS_DIR, book.name);
          const destDir = path.join(out, book.name);
          await mkdir(destDir, { recursive: true });
          const files = (await readdir(srcDir)).filter((f) => IMAGE_RE.test(f));
          await Promise.all(
            files.map(async (f) => {
              await thumb(path.join(srcDir, f)).toFile(path.join(destDir, `${f}.webp`));
              count++;
            }),
          );
        }
        logger.info(`generated ${count} thumbnails`);
      },
    },
  };
}
