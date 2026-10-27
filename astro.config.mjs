import { defineConfig } from 'astro/config';

// The site is deployed to GitHub Pages as a project page, so it lives under
// https://<owner>.github.io/<repo>/. `site` and `base` make every generated
// link and asset URL carry that prefix. Set BASE_PATH=/ to build for the root
// of a custom domain instead.
const base = process.env.BASE_PATH ?? '/comicbooks';

export default defineConfig({
  site: 'https://christoph-jerolimov.github.io',
  base,
  output: 'static',
  trailingSlash: 'ignore',
});
