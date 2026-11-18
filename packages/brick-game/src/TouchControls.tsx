import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  LEFT_STICK_BUTTON,
  PAD_BUTTONS,
  setTouchButton,
  setTouchPad,
  setTouchStick,
} from './touch-pad.ts';

/** How far a finger travels from where it landed for a full push, in px. */
const STICK_RADIUS = 52;
const LOOK_RADIUS = 70;

interface ButtonSpec {
  label: string;
  title: string;
  button: number;
  className?: string;
}

const b = PAD_BUTTONS;

function Stick({
  onMove,
  className,
}: {
  onMove: (x: number, y: number) => void;
  className: string;
}) {
  const knob = useRef<HTMLDivElement>(null);
  const origin = useRef<{ id: number; x: number; y: number } | null>(null);
  const set = (x: number, y: number) => {
    onMove(x, y);
    if (knob.current)
      knob.current.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    origin.current = {
      id: event.pointerId,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
    move(event);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, length / STICK_RADIUS) / length;
    set(dx * scale, dy * scale);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current?.id !== event.pointerId) return;
    origin.current = null;
    set(0, 0);
  };
  return (
    <div
      className={className}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="touch-knob" ref={knob} />
    </div>
  );
}

function PadButton({ spec }: { spec: ButtonSpec }) {
  const [id, down] = [useRef<number | null>(null), setTouchButton];
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (id.current !== event.pointerId) return;
    id.current = null;
    down(spec.button, false);
  };
  return (
    <button
      type="button"
      className={`touch-button ${spec.className ?? ''}`}
      aria-label={spec.title}
      title={spec.title}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        id.current = event.pointerId;
        down(spec.button, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {spec.label}
    </button>
  );
}

/**
 * Thumbsticks and buttons for touch screens: a stick on the left walks, dragging anywhere else
 * looks round, and buttons sit on the right. They press the virtual pad (`touch-pad.ts`), so each
 * does what the matching controller button does (see `gamepad.ts`).
 */
export function TouchControls({
  building,
  minimap,
  simple,
}: {
  building: boolean;
  minimap: boolean;
  /** Simple controls turn with the walking stick, so there is no second stick to look with. */
  simple: boolean;
}) {
  useEffect(() => {
    setTouchPad(true);
    return () => setTouchPad(false);
  }, []);

  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = look.current;
    if (!start || start.id !== event.pointerId) return;
    const clamp = (value: number) => Math.max(-1, Math.min(1, value / LOOK_RADIUS));
    setTouchStick('right', clamp(event.clientX - start.x), clamp(event.clientY - start.y));
  };
  const lookEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (look.current?.id !== event.pointerId) return;
    look.current = null;
    setTouchStick('right', 0, 0);
  };

  const main: ButtonSpec[] = [
    { label: '⤒', title: 'Jump', button: b.a, className: 'big' },
    { label: '💬', title: 'Talk', button: b.b },
    { label: '🕊', title: 'Fly', button: b.y },
    { label: '🏃', title: 'Run', button: LEFT_STICK_BUTTON },
  ];
  const extra: ButtonSpec[] = building
    ? [
        { label: '＋', title: 'Place', button: b.rt, className: 'big' },
        { label: '－', title: 'Take off', button: b.lt },
        { label: '⧉', title: 'Copy', button: b.x },
        { label: '↻', title: 'Turn', button: b.up },
        { label: '‹', title: 'Previous piece', button: b.lb },
        { label: '›', title: 'Next piece', button: b.rb },
        { label: '🎨', title: 'Next colour', button: b.right },
        { label: '🧱', title: 'Brick box', button: b.down },
      ]
    : [
        { label: '🎩', title: 'Hats', button: b.up },
        ...(minimap ? [{ label: '🗺', title: 'Map', button: b.down }] : []),
      ];
  const top: ButtonSpec[] = [
    { label: '👁', title: 'Camera', button: b.view },
    { label: '☰', title: 'Menu', button: b.menu },
  ];

  return (
    <div className={simple ? 'touch-controls' : 'touch-controls has-look'}>
      <div
        className="touch-look"
        onPointerDown={(event) => {
          if (look.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          look.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={lookMove}
        onPointerUp={lookEnd}
        onPointerCancel={lookEnd}
      />
      <div className="touch-top">
        {top.map((spec) => (
          <PadButton key={spec.title} spec={spec} />
        ))}
      </div>
      <Stick className="touch-stick" onMove={(x, y) => setTouchStick('left', x, y)} />
      {!simple && (
        <Stick className="touch-stick look" onMove={(x, y) => setTouchStick('right', x, y)} />
      )}
      <div className="touch-actions">
        {main.map((spec) => (
          <PadButton key={spec.title} spec={spec} />
        ))}
      </div>
      <div className="touch-extras">
        {extra.map((spec) => (
          <PadButton key={spec.title} spec={spec} />
        ))}
      </div>
    </div>
  );
}
