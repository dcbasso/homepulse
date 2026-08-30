import { Injectable, signal } from '@angular/core';

/** The non-standard event Chromium browsers fire when the app becomes installable. */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

/**
 * Wraps the browser's native "Add to Home Screen" install flow.
 *
 * Backed by the `beforeinstallprompt` event, which only Chromium-based
 * browsers (Chrome, Edge, Samsung Internet, Chrome for Android) fire. Safari
 * (iOS/macOS) and Firefox expose no web API to trigger or detect
 * installability, so `canInstall` simply stays false there — the user must
 * use the browser's own "Add to Home Screen" menu entry instead.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** True when the native install prompt is currently available to trigger. */
  readonly canInstall = signal(false);

  constructor() {
    if (this.isRunningStandalone()) return;

    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    });
  }

  /**
   * Shows the native browser install prompt captured from `beforeinstallprompt`.
   * No-ops if no prompt is currently available (e.g. already installed, or
   * running on a browser that doesn't support this API).
   */
  async promptInstall(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.canInstall.set(false);
  }

  /** True when the app is already running installed (standalone display mode). */
  private isRunningStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches;
  }
}
