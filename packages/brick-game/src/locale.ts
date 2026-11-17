/**
 * The language the people of Brick World speak. It changes what they say, in their speech bubbles
 * and aloud; the menus stay in English.
 */
export type Locale = 'en' | 'nl';

export const LOCALES: Record<Locale, { label: string; tag: string }> = {
  en: { label: 'English', tag: 'en-GB' },
  nl: { label: 'Nederlands', tag: 'nl-NL' },
};

export const isLocale = (name: unknown): name is Locale =>
  typeof name === 'string' && Object.hasOwn(LOCALES, name);

/** The browser's own language where it is one of ours, otherwise English. */
export function defaultLocale(languages: readonly string[] = navigator.languages ?? []): Locale {
  for (const language of languages) {
    const short = language.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return 'en';
}
