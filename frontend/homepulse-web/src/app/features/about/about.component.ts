import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';

/** Current application version, shown on the About screen. */
const APP_VERSION = '3.0.0';

/** Author contact and profile links, shown on the About screen. */
const AUTHOR = {
  name: 'Dante Basso',
  email: 'dcbasso@gmail.com',
  github: 'https://github.com/dcbasso/homepulse-gcp',
  linkedin: 'https://www.linkedin.com/in/dante-basso-filho',
  personalSite: 'https://www.dantebasso.com.br/',
};

/**
 * About screen.
 *
 * Displays app information (name, description, version) and developer/author
 * contact details with links to GitHub and LinkedIn.
 */
@Component({
  selector: 'app-about',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavbarComponent, MatCardModule, MatIconModule, TranslatePipe],
  template: `
    <app-navbar>
    <main class="about-main">
      <h1 class="about-title">{{ 'ABOUT.TITLE' | translate }}</h1>

      <mat-card class="about-card">
        <mat-card-header>
          <mat-card-title>{{ 'ABOUT.SECTION_APP' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <img class="about-logo" src="assets/images/logo/logo-full-400w.png" alt="HomePulse" />
          <p class="app-name">{{ 'ABOUT.APP_NAME' | translate }}</p>
          <p class="app-made-by">{{ 'ABOUT.MADE_BY' | translate }}</p>
          <p class="app-description">{{ 'ABOUT.APP_DESCRIPTION' | translate }}</p>
          <p class="app-version">{{ 'ABOUT.APP_VERSION' | translate }}: {{ appVersion }}</p>
          <p class="app-license">
            {{ 'ABOUT.APP_LICENSE' | translate }}:
            <a [href]="repositoryUrl" target="_blank" rel="noopener">Apache License 2.0</a>
          </p>
        </mat-card-content>
      </mat-card>

      <mat-card class="about-card">
        <mat-card-header>
          <mat-card-title>{{ 'ABOUT.SECTION_AUTHOR' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="info-row">
            <mat-icon>person</mat-icon>
            <span>{{ author.name }}</span>
          </div>
          <div class="info-row">
            <mat-icon>email</mat-icon>
            <a [href]="'mailto:' + author.email">{{ author.email }}</a>
          </div>
          <div class="info-row">
            <mat-icon>code</mat-icon>
            <a [href]="author.github" target="_blank" rel="noopener">{{ 'ABOUT.AUTHOR_GITHUB' | translate }}</a>
          </div>
          <div class="info-row">
            <mat-icon>work</mat-icon>
            <a [href]="author.linkedin" target="_blank" rel="noopener">{{ 'ABOUT.AUTHOR_LINKEDIN' | translate }}</a>
          </div>
          <div class="info-row">
            <mat-icon>language</mat-icon>
            <a [href]="author.personalSite" target="_blank" rel="noopener">{{ 'ABOUT.AUTHOR_WEBSITE' | translate }}</a>
          </div>
        </mat-card-content>
      </mat-card>
    </main>
    </app-navbar>
  `,
  styles: [`
    .about-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .about-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .about-card {
      margin-bottom: 1.25rem;
    }

    mat-card-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-top: 1rem !important;
    }

    .about-logo {
      width: 160px;
      max-width: 100%;
      margin: 0 0 0.5rem;
    }

    .app-name {
      font-weight: 600;
      margin: 0;
    }

    .app-made-by {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.25rem;
    }

    .app-description {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .app-version {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .app-license {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .app-license a {
      color: var(--mat-sys-primary);
      text-decoration: none;
    }

    .app-license a:hover {
      text-decoration: underline;
    }

    .info-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .info-row a {
      color: var(--mat-sys-primary);
      text-decoration: none;
    }

    .info-row a:hover {
      text-decoration: underline;
    }
  `],
})
export class AboutComponent {
  /** App version displayed in the "About the app" section. */
  readonly appVersion = APP_VERSION;

  /** Author contact and profile links displayed in the "Developer" section. */
  readonly author = AUTHOR;

  /** Original repository URL, linked from the license line. */
  readonly repositoryUrl = AUTHOR.github;
}
