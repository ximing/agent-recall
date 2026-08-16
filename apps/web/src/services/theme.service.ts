import { Service } from '@rabjs/react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ar-theme';

function storedTheme(): Theme | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : null;
}

export class ThemeService extends Service {
  theme: Theme = storedTheme() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  init(): void {
    this.apply(this.theme);
    // 未手动选择过主题时跟随系统
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (!storedTheme()) this.set(event.matches ? 'dark' : 'light');
    });
  }

  set(theme: Theme): void {
    this.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    this.apply(theme);
  }

  private apply(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
  }
}
