import { useEffect, useState } from 'react';
import type { Theme, ThemePreference } from '../index.js';
import { themePreference, themeStorageKey } from '../runtime/theme.js';

export function useThemePreference(fallback: ThemePreference) {
  const key = themeStorageKey(location.pathname);
  const readPreference = () => {
    try {
      return themePreference(localStorage.getItem(key), fallback);
    } catch {
      return fallback;
    }
  };
  const [preference, setPreference] = useState(readPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => {
      setSystemTheme(media.matches ? 'dark' : 'light');
    };
    change();
    media.addEventListener('change', change);
    return () => {
      media.removeEventListener('change', change);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      setPreference(readPreference());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener('space-lab:theme-preference', refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('space-lab:theme-preference', refresh);
    };
  }, [key, fallback]);
  const savePreference = (value: ThemePreference) => {
    setPreference(value);
    try {
      localStorage.setItem(key, value);
      window.dispatchEvent(new Event('space-lab:theme-preference'));
    } catch {
      return;
    }
  };
  return { preference, setPreference: savePreference, systemTheme };
}
