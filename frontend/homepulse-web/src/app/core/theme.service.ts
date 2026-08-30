import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const STORAGE_KEY = 'theme';
const DARK_CLASS = 'dark-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private darkSubject = new BehaviorSubject<boolean>(false);

  /** Emits true when the dark theme is active. */
  isDark$: Observable<boolean> = this.darkSubject.asObservable();

  /**
   * Reads the persisted theme preference from localStorage and applies it.
   * Falls back to the system preference via prefers-color-scheme when no
   * stored value exists. Must be called once during app initialization.
   */
  initTheme(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    const prefersDark =
      stored !== null
        ? stored === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme(prefersDark);
  }

  /**
   * Toggles between light and dark theme and persists the preference
   * to localStorage so it survives page refreshes.
   */
  toggleTheme(): void {
    this.applyTheme(!this.darkSubject.value);
  }

  /**
   * Explicitly selects light or dark theme and persists the preference
   * to localStorage so it survives page refreshes.
   *
   * @param dark - True to activate the dark theme, false for light.
   */
  setTheme(dark: boolean): void {
    this.applyTheme(dark);
  }

  private applyTheme(dark: boolean): void {
    document.body.classList.toggle(DARK_CLASS, dark);
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    this.darkSubject.next(dark);
  }
}
