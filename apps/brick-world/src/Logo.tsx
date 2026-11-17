import type { CSSProperties } from 'react';

/** The logo's brick colours, in turn: red, blue, yellow, green, orange and white. */
const BRICKS = [
  { color: '#c91a09', ink: '#fff6ec' },
  { color: '#0055bf', ink: '#f2f6ff' },
  { color: '#f2cd37', ink: '#3b2d07' },
  { color: '#237841', ink: '#effaf1' },
  { color: '#fe8a18', ink: '#3a1d02' },
  { color: '#f4f4f4', ink: '#2a2a2a' },
];

/** How many letters the logo builds, which sets how long the drop-in takes. */
export const logoLetters = (title: string) => [...title.replace(/ /g, '')].length;

/** The game's name built from coloured bricks, each tilted a little, as if stacked by hand. */
export function Logo({ title }: { title: string }) {
  let at = 0;
  const words = title
    .split(' ')
    .map((word) => [...word].map((letter) => ({ letter, index: at++ })));
  return (
    <h1 className="title-logo" aria-label={title}>
      {words.map((word, w) => (
        <span key={w} className="title-word" aria-hidden>
          {word.map(({ letter, index }) => {
            const brick = BRICKS[index % BRICKS.length];
            const tilt = (((index * 37) % 7) - 3) * 0.9;
            return (
              <span
                key={index}
                className="title-brick"
                style={
                  {
                    '--c': brick.color,
                    '--ink': brick.ink,
                    '--i': index,
                    '--tilt': `${tilt}deg`,
                  } as CSSProperties
                }
              >
                {letter}
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}
