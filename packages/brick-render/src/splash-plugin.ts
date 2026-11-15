import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite-plus';

export interface SplashOptions {
  /** The app's name, shown over the bricks. */
  title: string;
  /** The first line under the bricks; the app changes it with `setSplashMessage`. */
  message: string;
  /** Colours for the splash, so it matches the app's own background. */
  colors?: { background?: string; ink?: string; muted?: string; shadow?: string };
}

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** The four bricks of the stack: colour, left stud, row, length in studs and start delay. */
const BRICKS = [
  ['#c91a09', 0, 0, 4, 0],
  ['#0055bf', 4, 0, 4, 0.22],
  ['#f2cd37', 2, 1, 4, 0.44],
  ['#237841', 3, 2, 2, 0.66],
] as const;

/**
 * Puts the stacking-bricks splash into the app's index.html, so it shows before any script has
 * loaded. The app updates it with `setSplashMessage` and takes it away with `dismissSplash`
 * (`@brick-workshop/render/splash`). Other pages (the workshop's instructions) are left alone.
 */
export function splashPlugin({ title, message, colors = {} }: SplashOptions): Plugin {
  const css = readFileSync(new URL('./splash.css', import.meta.url), 'utf8');
  const vars = [
    ['--splash-bg', colors.background],
    ['--splash-ink', colors.ink],
    ['--splash-muted', colors.muted],
    ['--splash-shadow', colors.shadow],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
  const bricks = BRICKS.map(
    ([color, at, row, studs, delay]) =>
      `<span style="--c: ${color}; --at: ${at}; --row: ${row}; --studs: ${studs}; --d: ${delay}s"></span>`,
  ).join('');
  const markup =
    `<div id="app-splash" role="status" aria-live="polite"${vars ? ` style="${vars}"` : ''}>` +
    `<h1>${escape(title)}</h1>` +
    `<div class="splash-bricks" role="progressbar" aria-label="Loading ${escape(title)}">${bricks}</div>` +
    `<p data-splash-message>${escape(message)}</p>` +
    `</div>`;
  return {
    name: 'brick-workshop:splash',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.path.endsWith('/index.html')) return html;
        return html
          .replace('</head>', () => `<style>\n${css}</style>\n</head>`)
          .replace(/<body[^>]*>/, (body) => `${body}\n${markup}`);
      },
    },
  };
}
