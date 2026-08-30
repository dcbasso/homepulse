import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule, MatButtonToggleChange } from '@angular/material/button-toggle';
import { MatRadioModule, MatRadioChange } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PwaInstallService } from '../../core/pwa-install.service';
import { ThemeService } from '../../core/theme.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';

/** A UI language option: the ngx-translate locale code paired with its native display name. */
interface LangOption {
  code: 'pt-BR' | 'en' | 'es';
  labelKey: string;
}

/** Languages available in the UI, in the order they appear in the selector. */
const SUPPORTED_LANGS: readonly LangOption[] = [
  { code: 'pt-BR', labelKey: 'PREFERENCES.LANG_PT_BR' },
  { code: 'en', labelKey: 'PREFERENCES.LANG_EN' },
  { code: 'es', labelKey: 'PREFERENCES.LANG_ES' },
];

/**
 * Preferences screen.
 *
 * Lets the user choose the UI theme (light/dark) and language, replacing the
 * quick controls that used to live directly in the navbar/drawer with a
 * single dedicated screen that works equally well on mobile and desktop.
 */
@Component({
  selector: 'app-preferences',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavbarComponent,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatRadioModule,
    MatIconModule,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="preferences-main">
      <h1 class="preferences-title">{{ 'PREFERENCES.TITLE' | translate }}</h1>

      <mat-card class="preferences-card">
        <mat-card-header>
          <mat-card-title>{{ 'PREFERENCES.THEME_TITLE' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-button-toggle-group
            [value]="isDark() ? 'dark' : 'light'"
            (change)="onThemeChange($event)"
          >
            <mat-button-toggle value="light">
              <mat-icon>light_mode</mat-icon>
              {{ 'PREFERENCES.THEME_LIGHT' | translate }}
            </mat-button-toggle>
            <mat-button-toggle value="dark">
              <mat-icon>dark_mode</mat-icon>
              {{ 'PREFERENCES.THEME_DARK' | translate }}
            </mat-button-toggle>
          </mat-button-toggle-group>
        </mat-card-content>
      </mat-card>

      <mat-card class="preferences-card">
        <mat-card-header>
          <mat-card-title>{{ 'PREFERENCES.LANGUAGE_TITLE' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-radio-group class="language-options" [value]="currentLang()" (change)="onLangChange($event)">
            @for (lang of langOptions; track lang.code) {
              <mat-radio-button [value]="lang.code">{{ lang.labelKey | translate }}</mat-radio-button>
            }
          </mat-radio-group>
        </mat-card-content>
      </mat-card>

      @if (installService.canInstall()) {
        <mat-card class="preferences-card">
          <mat-card-header>
            <mat-card-title>{{ 'PREFERENCES.INSTALL_TITLE' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content class="install-content">
            <p class="install-description">{{ 'PREFERENCES.INSTALL_DESCRIPTION' | translate }}</p>
            <button mat-raised-button color="primary" (click)="installService.promptInstall()">
              <mat-icon>install_mobile</mat-icon>
              {{ 'PREFERENCES.INSTALL_BUTTON' | translate }}
            </button>
          </mat-card-content>
        </mat-card>
      }
    </main>
    </app-navbar>
  `,
  styles: [`
    .preferences-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .preferences-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .preferences-card {
      margin-bottom: 1.25rem;
    }

    .language-options {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .install-content {
      align-items: flex-start;
      gap: 0.75rem;
    }

    .install-description {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }
  `],
})
export class PreferencesComponent {
  protected themeService = inject(ThemeService);
  protected installService = inject(PwaInstallService);
  private translate = inject(TranslateService);

  /** Language options shown in the selector. */
  protected langOptions = SUPPORTED_LANGS;

  /** Reactive dark-mode flag derived from ThemeService. */
  protected isDark = toSignal(this.themeService.isDark$, { initialValue: false });

  /** Current active language code, reactive by itself. */
  protected currentLang = this.translate.currentLang;

  /**
   * Applies the theme selected via the light/dark toggle group.
   *
   * @param event - Button toggle change event carrying the selected value.
   */
  onThemeChange(event: MatButtonToggleChange): void {
    this.themeService.setTheme(event.value === 'dark');
  }

  /**
   * Switches the UI to the selected language and persists the choice.
   *
   * @param event - Radio change event carrying the selected language code.
   */
  onLangChange(event: MatRadioChange): void {
    this.translate.use(event.value);
    localStorage.setItem('lang', event.value);
  }
}
