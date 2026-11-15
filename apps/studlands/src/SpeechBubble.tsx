import { useEffect, useRef, useState } from 'react';

/** Characters a second the line types out at. */
const TYPE_RATE = 45;

/**
 * A speech bubble over whoever is speaking: their name and their line, typed out as they say it.
 * It follows `anchor` (written by the scene each frame), and while the speaker is off screen it
 * waits along the bottom of the screen instead.
 */
export function SpeechBubble({
  anchor,
  name,
  text,
}: {
  anchor: { x: number; y: number; visible: boolean };
  name: string;
  text: string;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function follow(now) {
      frame = requestAnimationFrame(follow);
      setShown(Math.min(text.length, Math.floor(((now - start) / 1000) * TYPE_RATE)));
      const element = bubble.current;
      if (!element) return;
      const margin = 16;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const onScreen =
        anchor.visible &&
        anchor.x > 0 &&
        anchor.x < window.innerWidth &&
        anchor.y > height &&
        anchor.y < window.innerHeight;
      element.classList.toggle('docked', !onScreen);
      if (!onScreen) {
        element.style.transform = '';
        return;
      }
      const x = Math.max(
        margin,
        Math.min(window.innerWidth - width - margin, anchor.x - width / 2),
      );
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(anchor.y - height)}px)`;
      // The tail points at the head even when the bubble is pushed in from the edge.
      element.style.setProperty('--tail', `${Math.round(anchor.x - x)}px`);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, text]);
  return (
    <div className="speech" ref={bubble} role="status" aria-live="polite">
      <strong>{name}</strong>
      {/* The rest of the line is there but hidden, so the bubble keeps its size as it types. */}
      <span aria-label={text}>
        {text.slice(0, shown)}
        <span className="unsaid" aria-hidden>
          {text.slice(shown)}
        </span>
      </span>
    </div>
  );
}
