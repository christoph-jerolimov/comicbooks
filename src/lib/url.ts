/** Prefix a site-root path ("/read/x/") with the configured base ("/comicbooks"). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}
