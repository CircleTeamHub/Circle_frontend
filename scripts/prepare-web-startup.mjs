import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectEnv } from '@expo/env';
import installWebStartup from './web-startup.cjs';

export function prepareWebStartup(directory, { dsn, environment = 'production' } = {}) {
  const index = join(directory, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (html.includes('id="windnote-web-startup"')) return;
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/_expo\/static\/js\/web\/([^"/]+\.js)"[^>]*>/g)];
  if (!scripts.length) throw new Error('Web export has no Expo entry scripts.');
  const head = /<head\b[^>]*>\s*(?:<meta\b[^>]*\bcharset\s*=[^>]*>)?/i.exec(html);
  if (!head) throw new Error('Web export has no document head.');
  const assets = scripts.map(match => match[1]);
  const build = /-([a-f0-9]{32})\.js$/.exec(assets.find(asset => asset.startsWith('index-')) ?? '')?.[1];
  let endpoint;
  if (dsn) {
    const url = new URL(dsn);
    const project = /^\/(\d+)$/.exec(url.pathname)?.[1];
    if (url.protocol !== 'https:' || !url.username || url.password || !project) throw new Error('Invalid public Sentry DSN for web startup diagnostics.');
    endpoint = `${url.origin}/api/${project}/envelope/?sentry_key=${encodeURIComponent(url.username)}&sentry_version=7`;
  }
  const config = JSON.stringify({ assets, build, environment, endpoint }).replace(/</g, '\\u003c');
  const probe = `<script id="windnote-web-startup">(${installWebStartup.toString()})(window,document,${config});</script>`;
  const insertAt = head.index + head[0].length;
  writeFileSync(index, html.slice(0, insertAt) + probe + html.slice(insertAt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadProjectEnv(process.cwd(), { mode: 'production', silent: true });
  prepareWebStartup(resolve(process.argv[2] || 'dist'), {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN?.trim(),
    environment: process.env.APP_VARIANT === 'preprod' ? 'preproduction' : 'production',
  });
}
