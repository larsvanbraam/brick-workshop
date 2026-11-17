/**
 * Which input the player used last, so every on-screen prompt names the right button: the key on
 * a keyboard, the controller's button after a controller was touched. `App` provides it.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const PadContext = createContext(false);
export const PadProvider = PadContext.Provider;

/** Whether the controller was the last thing used. */
export const useUsingPad = () => useContext(PadContext);

/** A prompt's button: `key` for the keyboard, `pad` for a controller (the key's, if left out). */
export function Key({ k, pad }: { k: ReactNode; pad?: ReactNode }) {
  const using = useUsingPad();
  return <kbd>{using && pad !== undefined ? pad : k}</kbd>;
}
