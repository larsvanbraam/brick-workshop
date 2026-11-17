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

/** The logo's brick colours and the ink on each, the same run as Brick World's title logo. */
const LETTER_BRICKS = [
  ['#c91a09', '#fff6ec'],
  ['#0055bf', '#f2f6ff'],
  ['#f2cd37', '#3b2d07'],
  ['#237841', '#effaf1'],
  ['#fe8a18', '#3a1d02'],
  ['#f4f4f4', '#2a2a2a'],
] as const;

/** The title as words of tilted, coloured letter bricks, which drop in one by one. */
function logoMarkup(title: string) {
  let at = 0;
  const words = title.split(' ').map((word) => {
    const letters = [...word]
      .map((letter) => {
        const index = at++;
        const [color, ink] = LETTER_BRICKS[index % LETTER_BRICKS.length];
        const tilt = (((index * 37) % 7) - 3) * 0.9;
        return `<span class="splash-letter" style="--c: ${color}; --ink: ${ink}; --i: ${index}; --tilt: ${tilt}deg">${escape(letter)}</span>`;
      })
      .join('');
    return `<span class="splash-word" aria-hidden="true">${letters}</span>`;
  });
  return `<h1 class="splash-logo" aria-label="${escape(title)}" style="--letters: ${at}">${words.join('')}</h1>`;
}

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
  const markup =
    `<div id="app-splash" role="status" aria-live="polite"${vars ? ` style="${vars}"` : ''}>` +
    logoMarkup(title) +
    `<div class="splash-studs" role="progressbar" aria-label="Loading ${escape(title)}">` +
    '<span></span>'.repeat(5) +
    `</div>` +
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
