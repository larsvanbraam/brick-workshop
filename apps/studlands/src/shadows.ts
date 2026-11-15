/**
 * Shadow redraws, gathered. Drawing the sun's shadows means drawing every loaded piece again, so
 * asking for it on every change (a chunk arriving, the light moving on, a piece put down) would
 * redraw them several times a second; requests are collected here and served at most every
 * `SHADOW_INTERVAL` seconds (see `GameStage`).
 */
export const SHADOW_INTERVAL = 0.25;

let wanted = true;

/** Asks for the shadows to be drawn again soon. */
export function requestShadows() {
  wanted = true;
}

/** Whether shadows were asked for since the last call, clearing the request. */
export function takeShadowRequest() {
  const was = wanted;
  wanted = false;
  return was;
}
