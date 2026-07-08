/**
 * Prefixes public-asset paths with the GitHub Pages basePath.
 * next/image applies basePath to routes but NOT to unoptimized image srcs,
 * so /brand/*.svg would 404 on github.io/<repo>/ without this.
 * NEXT_PUBLIC_BASE_PATH is inlined at build time.
 */
export const asset = (path: string): string =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${path}`;
