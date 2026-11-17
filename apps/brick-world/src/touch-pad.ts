/**
 * The on-screen controls' virtual controller. It looks like one more connected gamepad (standard
 * layout), so walking and the game's own pad handling take touch input through the code that
 * already reads a controller; nothing else needs to know about fingers.
 *
 * Whether the controls show is a setting: `auto` follows the device (a touch screen as the main
 * pointer), `on` and `off` force it.
 */
import type { PadLike } from '@brick-workshop/walk/walk-gamepad';
import { PAD_BUTTONS } from './gamepad.ts';

export type TouchSetting = 'auto' | 'on' | 'off';
export const TOUCH_SETTINGS: TouchSetting[] = ['auto', 'on', 'off'];
export const TOUCH_LABELS: Record<TouchSetting, string> = { auto: 'Auto', on: 'On', off: 'Off' };
export const isTouchSetting = (value: unknown): value is TouchSetting =>
  typeof value === 'string' && (TOUCH_SETTINGS as string[]).includes(value);

/** The stick-click button, which sprints. */
export const LEFT_STICK_BUTTON = 10;

/** Whether the device's main pointer is a finger. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? navigator.maxTouchPoints > 0;
}

export const touchShown = (setting: TouchSetting) =>
  setting === 'on' || (setting === 'auto' && isTouchDevice());

interface VirtualPad extends PadLike {
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

const pad: VirtualPad = {
  connected: false,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};

/** Joins the virtual pad to what `navigator.getGamepads` reports, once. */
let installed = false;
function install() {
  if (installed || typeof navigator === 'undefined') return;
  installed = true;
  const real = navigator.getGamepads?.bind(navigator);
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => {
      const pads: (PadLike | null)[] = real ? [...real()] : [];
      if (pad.connected) pads.push(pad);
      return pads;
    },
  });
}

/** Connects or disconnects the virtual pad; releasing everything when it goes. */
export function setTouchPad(connected: boolean) {
  install();
  pad.connected = connected;
  if (!connected) {
    pad.axes.fill(0);
    for (const button of pad.buttons) {
      button.pressed = false;
      button.value = 0;
    }
  }
}

/** Sets a stick: `left` is axes 0 and 1, the right one axes 2 and 3. */
export function setTouchStick(stick: 'left' | 'right', x: number, y: number) {
  const at = stick === 'left' ? 0 : 2;
  pad.axes[at] = x;
  pad.axes[at + 1] = y;
}

export function setTouchButton(index: number, down: boolean) {
  const button = pad.buttons[index];
  if (!button) return;
  button.pressed = down;
  button.value = down ? 1 : 0;
}

export { PAD_BUTTONS };
