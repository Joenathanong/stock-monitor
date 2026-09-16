/** Tema Morning/Evening — disimpan di localStorage, default ikut prefers-color-scheme. */
export type Theme = 'morning' | 'evening';
export const THEME_KEY = 'ieg-theme';

/** Skrip inline untuk <head> supaya tema terpasang sebelum render pertama (tanpa kedip). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='morning'&&t!=='evening'){t=matchMedia('(prefers-color-scheme: dark)').matches?'evening':'morning'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='morning'}})();`;

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'morning';
  return document.documentElement.dataset.theme === 'evening' ? 'evening' : 'morning';
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
}
