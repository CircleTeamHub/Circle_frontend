import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareWebPrefetch(directory) {
  const index = join(directory, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (html.includes('id="windnote-web-prefetch-assets"')) return;
  if (!html.includes('</head>')) throw new Error('Web export has no document head.');
  const initial = new Set([...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)"/g)].map(match => match[1]));
  const prefix = '/_expo/static/js/web/';
  const assets = readdirSync(join(directory, prefix.slice(1)))
    .filter(file => /^[\w.+[\]-]+-[a-f0-9]{32}\.js$/.test(file) && !initial.has(prefix + file))
    .map(file => ({ file, size: statSync(join(directory, prefix, file)).size }))
    .sort((a, b) => Number(/^NoteBlockEditor[.-]/.test(b.file)) - Number(/^NoteBlockEditor[.-]/.test(a.file)) || b.size - a.size || a.file.localeCompare(b.file))
    .map(({ file }) => prefix + file);
  const metadata = `<script id="windnote-web-prefetch-assets" type="application/json">${JSON.stringify(assets).replace(/</g, '\\u003c')}</script>`;
  writeFileSync(index, html.replace('</head>', `${metadata}</head>`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareWebPrefetch(resolve(process.argv[2] || 'dist'));
}
