import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge, take } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { SettingsDataService, TestAlertRequest } from './settings-data.service';
import { MonitorConfig, Recipient, TelegramRecipient } from '../../core/models/monitor-config.model';
import { environment } from '../../../environments/environment';
import { TelegramHelpDialogComponent } from './components/telegram-help-dialog/telegram-help-dialog.component';
import { formatPreview } from './date-format-preview.util';

const DEFAULT_SUBJECT_PREFIX = 'HomePulse';
const DEFAULT_SUBJECT_DOWN_SUFFIX = 'Internet is down';
const DEFAULT_SUBJECT_UP_SUFFIX   = 'Internet is back';
const DEFAULT_BODY_DOWN =
  'No heartbeat received since ${DATETIME_DOWN}.\n\nHi ${NAME}, you will receive another email once the internet comes back.';
const DEFAULT_BODY_UP =
  'Hi ${NAME}, the internet is back!\n\nDown at: ${DATETIME_DOWN}\nRecovered at: ${DATETIME_UP}\nTotal downtime: ${TOTAL_TIME} min';

/** Matches the backend's DEFAULT_TIMEZONE/DEFAULT_DATE_FORMAT (main.py) for unconfigured docs. */
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DATE_FORMAT = '%d/%m/%Y %H:%M:%S %Z';

/** Sentinel value for the date-format preset select when the user picked "Custom". */
const CUSTOM_DATE_FORMAT_VALUE = '__custom__';

/** Preset strftime patterns offered in the date-format select, each shown with its own preview. */
const DATE_FORMAT_PRESETS: readonly string[] = [
  DEFAULT_DATE_FORMAT,
  '%Y-%m-%d %H:%M:%S',
  '%d/%m/%Y %H:%M',
  '%m/%d/%Y %I:%M %p',
];

const FORM_DEFAULTS = {
  max_minutes_without_data: 45,
  email_subject_prefix:     DEFAULT_SUBJECT_PREFIX,
  email_subject_down:       DEFAULT_SUBJECT_DOWN_SUFFIX,
  email_subject_up:         DEFAULT_SUBJECT_UP_SUFFIX,
  email_body_down:          DEFAULT_BODY_DOWN,
  email_body_up:            DEFAULT_BODY_UP,
  notify_on_down:           true,
  notify_on_recovery:       true,
  notify_telegram_on_down:     true,
  notify_telegram_on_recovery: true,
  timezone:                 DEFAULT_TIMEZONE,
  date_format:              DEFAULT_DATE_FORMAT,
};

/**
 * Resolves the browser's local IANA timezone, falling back to DEFAULT_TIMEZONE
 * if the runtime can't report one.
 */
function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Lists IANA timezone names supported by the current browser.
 * Falls back to a single-entry list when `Intl.supportedValuesOf` is unavailable.
 */
function listSupportedTimezones(): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  try {
    return supportedValuesOf ? supportedValuesOf('timeZone') : [DEFAULT_TIMEZONE];
  } catch {
    return [DEFAULT_TIMEZONE];
  }
}

/**
 * Maps a stored strftime pattern to its matching preset, or CUSTOM_DATE_FORMAT_VALUE
 * when it doesn't match any preset.
 *
 * @param dateFormat - The strftime pattern currently held by the form.
 */
function presetForDateFormat(dateFormat: string): string {
  return DATE_FORMAT_PRESETS.includes(dateFormat) ? dateFormat : CUSTOM_DATE_FORMAT_VALUE;
}

/** Bot token pattern: "<numeric bot id>:<secret>" as issued by @BotFather. */
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

/** Chat ID pattern: a signed integer (private/group chats) or an @username (channels). */
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$|^@[A-Za-z0-9_]{5,32}$/;

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Formats the bracketed marker prepended to every email subject, e.g. "[ HomePulse ] ".
 *
 * @param prefix - User-configured prefix value (falls back to the default when empty).
 */
function buildSubjectPrefixMarker(prefix: string): string {
  return `[ ${prefix || DEFAULT_SUBJECT_PREFIX} ] `;
}

/**
 * Strips the bracketed prefix marker from a stored subject string.
 * Returns only the editable suffix so it can be bound to the form field.
 *
 * @param subject - Full subject string as stored in Firestore.
 * @param prefix - The prefix value the marker was built with.
 */
function stripSubjectPrefix(subject: string, prefix: string): string {
  const marker = buildSubjectPrefixMarker(prefix);
  return subject.startsWith(marker) ? subject.slice(marker.length) : subject;
}

/**
 * Formats a Firestore Timestamp to "dd/MM/yyyy HH:mm".
 *
 * @param ts - Timestamp to format.
 */
function formatTimestamp(ts: Timestamp): string {
  const d = ts.toDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Reconstructs a Recipient list from a stored config, applying lazy migration from
 * the legacy single `alert_email` field when `alert_emails` is absent.
 *
 * @param config - The config document loaded from Firestore.
 */
function buildRecipients(config: MonitorConfig): Recipient[] {
  const emails = config.alert_emails?.length
    ? config.alert_emails
    : config.alert_email ? [config.alert_email] : [environment.allowedEmail];
  const names = config.recipient_names ?? {};
  return emails.map(email => ({ email, name: names[email] ?? '' }));
}

/**
 * Masks a Telegram bot token for chip display, revealing only the last 4 characters.
 * Display-only — the add/edit form always shows the full token.
 *
 * @param token - Full bot token as stored in Firestore.
 */
function maskBotToken(token: string): string {
  if (token.length <= 4) return '••••';
  return `••••${token.slice(-4)}`;
}

/**
 * Settings screen.
 *
 * Manages monitoring intervals, alert thresholds, email recipients (with display names),
 * per-alert email subjects, and body templates with placeholder substitution support.
 * All values are persisted to `monitor_config/current` in Firestore.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavbarComponent,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="settings-main">
      <h1 class="settings-title">{{ 'SETTINGS.TITLE' | translate }}</h1>

      <form [formGroup]="form" (ngSubmit)="save()">

        <!-- Status Check section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>{{ 'SETTINGS.SECTION_CHECK' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>

            <p class="section-label">{{ 'SETTINGS.FIXED_INTERVAL_INFO' | translate }}</p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_THRESHOLD' | translate }}</mat-label>
              <input matInput type="number" formControlName="max_minutes_without_data" />
              <mat-hint>{{ 'SETTINGS.FIELD_THRESHOLD_HINT' | translate }}</mat-hint>
            </mat-form-field>

          </mat-card-content>
        </mat-card>

        <!-- Date & Time section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>{{ 'SETTINGS.SECTION_DATETIME' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_TIMEZONE' | translate }}</mat-label>
              <mat-select formControlName="timezone">
                @for (tz of timezoneOptions; track tz) {
                  <mat-option [value]="tz">{{ tz }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_DATE_FORMAT' | translate }}</mat-label>
              <mat-select
                [value]="dateFormatPreset()"
                (selectionChange)="onDateFormatPresetChange($event.value)"
              >
                @for (preset of dateFormatPresets; track preset) {
                  <mat-option [value]="preset">{{ preset }}</mat-option>
                }
                <mat-option [value]="customDateFormatValue">
                  {{ 'SETTINGS.FIELD_DATE_FORMAT_CUSTOM' | translate }}
                </mat-option>
              </mat-select>
            </mat-form-field>

            @if (dateFormatPreset() === customDateFormatValue) {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'SETTINGS.FIELD_DATE_FORMAT_CUSTOM' | translate }}</mat-label>
                <input matInput type="text" formControlName="date_format" />
                <mat-hint>{{ 'SETTINGS.FIELD_DATE_FORMAT_CUSTOM_HINT' | translate }}</mat-hint>
              </mat-form-field>
            }

            <p class="placeholder-hint">{{ 'SETTINGS.FIELD_DATE_FORMAT_PREVIEW' | translate }}: {{ datePreview() }}</p>

          </mat-card-content>
        </mat-card>

        <!-- Email Notifications section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>{{ 'SETTINGS.SECTION_EMAIL' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>

            <p class="section-label">{{ 'SETTINGS.SECTION_RECIPIENTS' | translate }}</p>

            <div class="chip-list">
              @for (r of recipients(); track r.email; let i = $index) {
                <div class="recipient-chip">
                  <span class="chip-body" (click)="openEditRecipient(i)">
                    <span class="chip-email">{{ r.email }}</span>
                    <span class="chip-sep">|</span>
                    <span class="chip-name">{{ r.name }}</span>
                  </span>
                  <button
                    type="button"
                    class="chip-remove"
                    (click)="removeRecipient(i)"
                    [attr.aria-label]="'COMMON.REMOVE' | translate"
                  >×</button>
                </div>
              }
            </div>

            @if (showRecipientForm()) {
              <div class="recipient-form" [formGroup]="addForm">
                <div class="recipient-form-fields">
                  <mat-form-field appearance="outline" class="recipient-field">
                    <mat-label>{{ 'SETTINGS.FIELD_RECIPIENT_NAME' | translate }}</mat-label>
                    <input matInput type="text" formControlName="name" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="recipient-field">
                    <mat-label>{{ 'SETTINGS.FIELD_RECIPIENT_EMAIL' | translate }}</mat-label>
                    <input matInput type="email" formControlName="email" />
                    @if (addForm.get('email')?.invalid && addForm.get('email')?.touched) {
                      <mat-error>{{ 'SETTINGS.FIELD_EMAIL_INVALID' | translate }}</mat-error>
                    }
                  </mat-form-field>
                </div>
                <div class="recipient-form-actions">
                  <button type="button" mat-button (click)="cancelRecipientForm()">
                    {{ 'SETTINGS.CANCEL' | translate }}
                  </button>
                  <button
                    type="button"
                    mat-raised-button
                    color="primary"
                    (click)="confirmRecipient()"
                    [disabled]="addForm.invalid"
                  >
                    {{ 'SETTINGS.CONFIRM' | translate }}
                  </button>
                </div>
              </div>
            } @else {
              <button type="button" mat-stroked-button (click)="openAddRecipient()">
                + {{ 'SETTINGS.ADD_RECIPIENT' | translate }}
              </button>
            }

            <div class="checkbox-group">
              <mat-checkbox formControlName="notify_on_down">
                {{ 'SETTINGS.FIELD_NOTIFY_DOWN' | translate }}
              </mat-checkbox>
              <mat-checkbox formControlName="notify_on_recovery">
                {{ 'SETTINGS.FIELD_NOTIFY_RECOVERY' | translate }}
              </mat-checkbox>
            </div>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_SUBJECT_PREFIX' | translate }}</mat-label>
              <input matInput type="text" formControlName="email_subject_prefix" />
              <mat-hint>{{ 'SETTINGS.FIELD_SUBJECT_PREFIX_HINT' | translate }}</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_SUBJECT_DOWN' | translate }}</mat-label>
              <span matTextPrefix class="subject-prefix">[&nbsp;{{ form.get('email_subject_prefix')?.value || defaultSubjectPrefix }}&nbsp;]&nbsp;</span>
              <input matInput type="text" formControlName="email_subject_down" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_SUBJECT_UP' | translate }}</mat-label>
              <span matTextPrefix class="subject-prefix">[&nbsp;{{ form.get('email_subject_prefix')?.value || defaultSubjectPrefix }}&nbsp;]&nbsp;</span>
              <input matInput type="text" formControlName="email_subject_up" />
            </mat-form-field>

            <div class="test-send-row">
              <button
                type="button"
                mat-stroked-button
                (click)="testSendEmail()"
                [disabled]="testingEmail() || recipients().length === 0"
              >
                @if (testingEmail()) {
                  <mat-spinner diameter="18" />
                } @else {
                  {{ 'SETTINGS.TEST_SEND' | translate }}
                }
              </button>
              @if (recipients().length === 0) {
                <span class="test-send-hint">{{ 'SETTINGS.TEST_SEND_NO_RECIPIENTS' | translate }}</span>
              }
            </div>

          </mat-card-content>
        </mat-card>

        <!-- Telegram Notifications section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title class="card-title-with-help">
              {{ 'SETTINGS.SECTION_TELEGRAM' | translate }}
              <button
                type="button"
                mat-icon-button
                class="help-icon-button"
                (click)="openTelegramHelp()"
                [matTooltip]="'SETTINGS.TELEGRAM_HELP_TOOLTIP' | translate"
                [attr.aria-label]="'SETTINGS.TELEGRAM_HELP_TOOLTIP' | translate"
              >
                <mat-icon>info_outline</mat-icon>
              </button>
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>

            <p class="section-label">{{ 'SETTINGS.SECTION_RECIPIENTS' | translate }}</p>

            <div class="chip-list">
              @for (r of telegramRecipients(); track r.chat_id + r.bot_token; let i = $index) {
                <div class="recipient-chip">
                  <span class="chip-body" (click)="openEditTelegramRecipient(i)">
                    <span class="chip-name">{{ r.name }}</span>
                    <span class="chip-sep">|</span>
                    <span class="chip-email">{{ maskBotToken(r.bot_token) }}</span>
                  </span>
                  <button
                    type="button"
                    class="chip-remove"
                    (click)="removeTelegramRecipient(i)"
                    [attr.aria-label]="'COMMON.REMOVE' | translate"
                  >×</button>
                </div>
              }
            </div>

            @if (showTelegramRecipientForm()) {
              <div class="recipient-form" [formGroup]="addTelegramForm">
                <div class="recipient-form-fields">
                  <mat-form-field appearance="outline" class="recipient-field">
                    <mat-label>{{ 'SETTINGS.FIELD_TELEGRAM_NAME' | translate }}</mat-label>
                    <input matInput type="text" formControlName="name" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="recipient-field">
                    <mat-label>{{ 'SETTINGS.FIELD_TELEGRAM_BOT_TOKEN' | translate }}</mat-label>
                    <input matInput type="text" formControlName="bot_token" />
                    @if (addTelegramForm.get('bot_token')?.invalid && addTelegramForm.get('bot_token')?.touched) {
                      <mat-error>{{ 'SETTINGS.FIELD_TELEGRAM_BOT_TOKEN_INVALID' | translate }}</mat-error>
                    }
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="recipient-field">
                    <mat-label>{{ 'SETTINGS.FIELD_TELEGRAM_CHAT_ID' | translate }}</mat-label>
                    <input matInput type="text" formControlName="chat_id" />
                    <button
                      type="button"
                      mat-icon-button
                      matSuffix
                      [disabled]="addTelegramForm.get('bot_token')?.invalid"
                      (click)="openTelegramGetUpdates()"
                      [matTooltip]="'SETTINGS.TELEGRAM_GET_UPDATES_TOOLTIP' | translate"
                      [attr.aria-label]="'SETTINGS.TELEGRAM_GET_UPDATES_TOOLTIP' | translate"
                    >
                      <mat-icon>open_in_new</mat-icon>
                    </button>
                    @if (addTelegramForm.get('chat_id')?.invalid && addTelegramForm.get('chat_id')?.touched) {
                      <mat-error>{{ 'SETTINGS.FIELD_TELEGRAM_CHAT_ID_INVALID' | translate }}</mat-error>
                    }
                  </mat-form-field>
                </div>
                <div class="recipient-form-actions">
                  <button type="button" mat-button (click)="cancelTelegramRecipientForm()">
                    {{ 'SETTINGS.CANCEL' | translate }}
                  </button>
                  <button
                    type="button"
                    mat-raised-button
                    color="primary"
                    (click)="confirmTelegramRecipient()"
                    [disabled]="addTelegramForm.invalid"
                  >
                    {{ 'SETTINGS.CONFIRM' | translate }}
                  </button>
                </div>
              </div>
            } @else {
              <button type="button" mat-stroked-button (click)="openAddTelegramRecipient()">
                + {{ 'SETTINGS.ADD_TELEGRAM_RECIPIENT' | translate }}
              </button>
            }

            <div class="checkbox-group">
              <mat-checkbox formControlName="notify_telegram_on_down">
                {{ 'SETTINGS.FIELD_NOTIFY_DOWN_TELEGRAM' | translate }}
              </mat-checkbox>
              <mat-checkbox formControlName="notify_telegram_on_recovery">
                {{ 'SETTINGS.FIELD_NOTIFY_RECOVERY_TELEGRAM' | translate }}
              </mat-checkbox>
            </div>

            <div class="test-send-row">
              <button
                type="button"
                mat-stroked-button
                (click)="testSendTelegram()"
                [disabled]="testingTelegram() || telegramRecipients().length === 0"
              >
                @if (testingTelegram()) {
                  <mat-spinner diameter="18" />
                } @else {
                  {{ 'SETTINGS.TEST_SEND' | translate }}
                }
              </button>
              @if (telegramRecipients().length === 0) {
                <span class="test-send-hint">{{ 'SETTINGS.TEST_SEND_NO_RECIPIENTS' | translate }}</span>
              }
            </div>

          </mat-card-content>
        </mat-card>

        <!-- Email Templates section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>{{ 'SETTINGS.SECTION_TEMPLATE' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>

            <p class="placeholder-hint">{{ 'SETTINGS.PLACEHOLDERS_HINT_DOWN' | translate }}</p>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_BODY_DOWN' | translate }}</mat-label>
              <textarea matInput formControlName="email_body_down" rows="5"></textarea>
            </mat-form-field>

            <p class="placeholder-hint">{{ 'SETTINGS.PLACEHOLDERS_HINT_UP' | translate }}</p>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'SETTINGS.FIELD_BODY_UP' | translate }}</mat-label>
              <textarea matInput formControlName="email_body_up" rows="5"></textarea>
            </mat-form-field>

          </mat-card-content>
        </mat-card>

        <!-- Actions row -->
        <div class="actions">
          @if (lastUpdated()) {
            <span class="last-updated">
              {{ 'SETTINGS.LAST_UPDATED' | translate }}: {{ lastUpdated() }}
            </span>
          }
          <div class="action-buttons">
            <button
              mat-button
              type="button"
              (click)="cancel()"
              [disabled]="(form.pristine && !recipientsDirty() && !telegramRecipientsDirty()) || saving()"
            >
              {{ 'SETTINGS.CANCEL' | translate }}
            </button>
            <button
              mat-raised-button
              color="primary"
              type="submit"
              [disabled]="form.invalid || (form.pristine && !recipientsDirty() && !telegramRecipientsDirty()) || saving() || (recipients().length === 0 && telegramRecipients().length === 0)"
            >
              @if (saving()) {
                <mat-spinner diameter="20" />
              } @else {
                {{ 'SETTINGS.SAVE' | translate }}
              }
            </button>
          </div>
        </div>

      </form>
    </main>
    </app-navbar>
  `,
  styles: [`
    .settings-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .settings-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .settings-card {
      margin-bottom: 1.25rem;
    }

    mat-card-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-top: 1rem !important;
    }

    .full-width {
      width: 100%;
    }

    .section-label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.25rem;
    }

    .placeholder-hint {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      font-family: monospace;
      margin: 0.25rem 0 0;
    }

    /* Recipient chips */
    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-height: 2rem;
    }

    .recipient-chip {
      display: flex;
      align-items: center;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 1rem;
      overflow: hidden;
      height: 2rem;
      font-size: 0.85rem;
      background: var(--mat-sys-surface-variant);
    }

    .chip-body {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0 0.5rem 0 0.75rem;
      cursor: pointer;
      height: 100%;
      user-select: none;
    }

    .chip-body:hover {
      background: var(--mat-sys-primary-container);
    }

    .chip-name {
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }

    .chip-sep {
      color: var(--mat-sys-outline);
    }

    .chip-email {
      color: var(--mat-sys-on-surface-variant);
    }

    .chip-remove {
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0 0.5rem;
      height: 100%;
      color: var(--mat-sys-on-surface-variant);
      font-size: 1.1rem;
      line-height: 1;
    }

    .chip-remove:hover {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    /* Inline recipient form */
    .recipient-form {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: var(--mat-sys-surface-container-low);
    }

    .recipient-form-fields {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .recipient-field {
      flex: 1;
      min-width: 200px;
    }

    .recipient-form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.25rem 0;
    }

    .test-send-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding-top: 0.25rem;
    }

    .test-send-row button[mat-stroked-button] mat-spinner {
      display: inline-block;
    }

    .test-send-hint {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      padding-top: 0.5rem;
    }

    .last-updated {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .action-buttons {
      display: flex;
      gap: 0.75rem;
      margin-left: auto;
    }

    button[mat-raised-button] mat-spinner {
      display: inline-block;
    }

    .subject-prefix {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
      white-space: nowrap;
    }

    .card-title-with-help {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .help-icon-button {
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class SettingsComponent implements OnInit {
  private dataService = inject(SettingsDataService);
  private fb          = inject(FormBuilder);
  private snackBar    = inject(MatSnackBar);
  private translate   = inject(TranslateService);
  private destroyRef  = inject(DestroyRef);
  private cdr         = inject(ChangeDetectorRef);
  private dialog      = inject(MatDialog);

  /** True while the Firestore save operation is in flight. */
  readonly saving = signal(false);

  /** True while a test email send is in flight. */
  readonly testingEmail = signal(false);

  /** True while a test Telegram send is in flight. */
  readonly testingTelegram = signal(false);

  /** Formatted "dd/MM/yyyy HH:mm" string of last successful save, or null. */
  readonly lastUpdated = signal<string | null>(null);

  /** Current list of email recipients managed outside the reactive form. */
  readonly recipients = signal<Recipient[]>([]);

  /** True when recipients have been modified since the last save or cancel. */
  readonly recipientsDirty = signal(false);

  /** Controls visibility of the inline add/edit recipient form. */
  readonly showRecipientForm = signal(false);

  /** Index of the recipient being edited, or null when adding a new one. */
  private editingIndex: number | null = null;

  /** Current list of Telegram recipients managed outside the reactive form. */
  readonly telegramRecipients = signal<TelegramRecipient[]>([]);

  /** True when Telegram recipients have been modified since the last save or cancel. */
  readonly telegramRecipientsDirty = signal(false);

  /** Controls visibility of the inline add/edit Telegram recipient form. */
  readonly showTelegramRecipientForm = signal(false);

  /** Index of the Telegram recipient being edited, or null when adding a new one. */
  private editingTelegramIndex: number | null = null;

  private savedFormValues = { ...FORM_DEFAULTS };
  private savedRecipients: Recipient[] = [];
  private savedTelegramRecipients: TelegramRecipient[] = [];

  /** Exposes the free `maskBotToken` function to the template. */
  protected readonly maskBotToken = maskBotToken;

  /** Exposes the default subject prefix to the template while the field is empty. */
  protected readonly defaultSubjectPrefix = DEFAULT_SUBJECT_PREFIX;

  /** IANA timezone names offered in the timezone select. */
  protected readonly timezoneOptions = listSupportedTimezones();

  /** strftime presets offered in the date-format select. */
  protected readonly dateFormatPresets = DATE_FORMAT_PRESETS;

  /** Sentinel value identifying the "Custom" option in the date-format select. */
  protected readonly customDateFormatValue = CUSTOM_DATE_FORMAT_VALUE;

  /** Which date-format preset is currently selected (or CUSTOM_DATE_FORMAT_VALUE). */
  readonly dateFormatPreset = signal<string>(CUSTOM_DATE_FORMAT_VALUE);

  /** Live preview of `date_format` rendered in `timezone`, for display only. */
  readonly datePreview = signal('');

  readonly form = this.fb.group({
    max_minutes_without_data: [FORM_DEFAULTS.max_minutes_without_data, [Validators.required, Validators.min(1)]],
    email_subject_prefix:     [FORM_DEFAULTS.email_subject_prefix,     Validators.required],
    email_subject_down:       [FORM_DEFAULTS.email_subject_down,       Validators.required],
    email_subject_up:         [FORM_DEFAULTS.email_subject_up,         Validators.required],
    email_body_down:          [FORM_DEFAULTS.email_body_down,          Validators.required],
    email_body_up:            [FORM_DEFAULTS.email_body_up,            Validators.required],
    notify_on_down:           [FORM_DEFAULTS.notify_on_down],
    notify_on_recovery:       [FORM_DEFAULTS.notify_on_recovery],
    notify_telegram_on_down:      [FORM_DEFAULTS.notify_telegram_on_down],
    notify_telegram_on_recovery:  [FORM_DEFAULTS.notify_telegram_on_recovery],
    timezone:                 [FORM_DEFAULTS.timezone,    Validators.required],
    date_format:              [FORM_DEFAULTS.date_format, Validators.required],
  });

  constructor() {
    merge(
      this.form.controls.timezone.valueChanges,
      this.form.controls.date_format.valueChanges,
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.updateDatePreview());
    this.updateDatePreview();
  }

  /** Separate form group for the inline add/edit recipient panel. */
  readonly addForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    name:  ['', Validators.required],
  });

  /** Separate form group for the inline add/edit Telegram recipient panel. */
  readonly addTelegramForm = this.fb.group({
    name:      ['', Validators.required],
    bot_token: ['', [Validators.required, Validators.pattern(TELEGRAM_BOT_TOKEN_PATTERN)]],
    chat_id:   ['', [Validators.required, Validators.pattern(TELEGRAM_CHAT_ID_PATTERN)]],
  });

  /**
   * Loads the current config from Firestore and patches the form and recipient list.
   * Applies lazy migration from the legacy `alert_email` field when `alert_emails` is absent.
   */
  ngOnInit(): void {
    this.dataService.getConfig().pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(config => {
      const recipientList = config
        ? buildRecipients(config)
        : [{ email: environment.allowedEmail, name: '' }];

      this.recipients.set(recipientList);
      this.savedRecipients = [...recipientList];

      const telegramRecipientList = config?.telegram_recipients ?? [];
      this.telegramRecipients.set(telegramRecipientList);
      this.savedTelegramRecipients = [...telegramRecipientList];

      const subjectPrefix = config?.email_subject_prefix || FORM_DEFAULTS.email_subject_prefix;

      this.savedFormValues = {
        max_minutes_without_data: config?.max_minutes_without_data ?? FORM_DEFAULTS.max_minutes_without_data,
        email_subject_prefix:     subjectPrefix,
        email_subject_down:       stripSubjectPrefix(config?.email_subject_down ?? (buildSubjectPrefixMarker(subjectPrefix) + FORM_DEFAULTS.email_subject_down), subjectPrefix),
        email_subject_up:         stripSubjectPrefix(config?.email_subject_up   ?? (buildSubjectPrefixMarker(subjectPrefix) + FORM_DEFAULTS.email_subject_up), subjectPrefix),
        email_body_down:          config?.email_body_down          ?? FORM_DEFAULTS.email_body_down,
        email_body_up:            config?.email_body_up            ?? FORM_DEFAULTS.email_body_up,
        notify_on_down:           config?.notify_on_down           ?? FORM_DEFAULTS.notify_on_down,
        notify_on_recovery:       config?.notify_on_recovery       ?? FORM_DEFAULTS.notify_on_recovery,
        notify_telegram_on_down:      config?.notify_telegram_on_down     ?? FORM_DEFAULTS.notify_telegram_on_down,
        notify_telegram_on_recovery:  config?.notify_telegram_on_recovery ?? FORM_DEFAULTS.notify_telegram_on_recovery,
        // A config doc that predates this field falls back to UTC (matching its actual
        // past behavior); a brand-new install with no doc at all defaults to the browser's
        // own timezone, which is a friendlier first-run guess.
        timezone:                 config?.timezone ?? (config ? DEFAULT_TIMEZONE : detectBrowserTimezone()),
        date_format:              config?.date_format ?? FORM_DEFAULTS.date_format,
      };

      this.form.patchValue(this.savedFormValues);
      this.form.markAsPristine();
      this.recipientsDirty.set(false);
      this.telegramRecipientsDirty.set(false);
      this.dateFormatPreset.set(presetForDateFormat(this.savedFormValues.date_format));

      if (config?.updated_at) {
        this.lastUpdated.set(formatTimestamp(config.updated_at));
      }
      this.cdr.markForCheck();
    });
  }

  /**
   * Persists the current form values and recipient list to Firestore.
   * Serialises the recipient signal into `alert_emails` and `recipient_names`.
   */
  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.form.disable();

    try {
      const raw = this.form.getRawValue();
      const recipientList = this.recipients();
      const telegramRecipientList = this.telegramRecipients();
      const subjectPrefix = raw.email_subject_prefix || FORM_DEFAULTS.email_subject_prefix;
      const subjectPrefixMarker = buildSubjectPrefixMarker(subjectPrefix);

      const values: Omit<MonitorConfig, 'updated_at' | 'alert_email'> = {
        max_minutes_without_data: Number(raw.max_minutes_without_data),
        alert_emails:             recipientList.map(r => r.email),
        recipient_names:          Object.fromEntries(recipientList.map(r => [r.email, r.name])),
        email_subject_prefix:     subjectPrefix,
        email_subject_down:       subjectPrefixMarker + (raw.email_subject_down ?? FORM_DEFAULTS.email_subject_down),
        email_subject_up:         subjectPrefixMarker + (raw.email_subject_up   ?? FORM_DEFAULTS.email_subject_up),
        email_body_down:          raw.email_body_down    ?? DEFAULT_BODY_DOWN,
        email_body_up:            raw.email_body_up      ?? DEFAULT_BODY_UP,
        notify_on_down:           raw.notify_on_down     ?? true,
        notify_on_recovery:       raw.notify_on_recovery ?? true,
        telegram_recipients:          telegramRecipientList,
        notify_telegram_on_down:      raw.notify_telegram_on_down     ?? true,
        notify_telegram_on_recovery:  raw.notify_telegram_on_recovery ?? true,
        timezone:                  raw.timezone    ?? DEFAULT_TIMEZONE,
        date_format:               raw.date_format ?? FORM_DEFAULTS.date_format,
      };

      await this.dataService.saveConfig(values);

      this.savedFormValues = {
        max_minutes_without_data: values.max_minutes_without_data,
        email_subject_prefix:     values.email_subject_prefix,
        email_subject_down:       stripSubjectPrefix(values.email_subject_down, values.email_subject_prefix),
        email_subject_up:         stripSubjectPrefix(values.email_subject_up, values.email_subject_prefix),
        email_body_down:          values.email_body_down,
        email_body_up:            values.email_body_up,
        notify_on_down:           values.notify_on_down,
        notify_on_recovery:       values.notify_on_recovery,
        notify_telegram_on_down:      values.notify_telegram_on_down,
        notify_telegram_on_recovery:  values.notify_telegram_on_recovery,
        timezone:                  values.timezone,
        date_format:               values.date_format,
      };
      this.savedRecipients = [...recipientList];
      this.savedTelegramRecipients = [...telegramRecipientList];
      this.lastUpdated.set(formatTimestamp(Timestamp.fromDate(new Date())));
      this.form.markAsPristine();
      this.recipientsDirty.set(false);
      this.telegramRecipientsDirty.set(false);
      this.dateFormatPreset.set(presetForDateFormat(values.date_format));
      this.snackBar.open(this.translate.instant('SETTINGS.SAVE_SUCCESS'), '', { duration: 3000 });
    } catch {
      this.snackBar.open(this.translate.instant('SETTINGS.SAVE_ERROR'), '', { duration: 4000 });
    } finally {
      this.saving.set(false);
      this.form.enable();
      this.cdr.markForCheck();
    }
  }

  /**
   * Restores the form and recipient list to the last successfully saved state.
   */
  cancel(): void {
    this.form.patchValue(this.savedFormValues);
    this.form.markAsPristine();
    this.recipients.set([...this.savedRecipients]);
    this.recipientsDirty.set(false);
    this.showRecipientForm.set(false);
    this.telegramRecipients.set([...this.savedTelegramRecipients]);
    this.telegramRecipientsDirty.set(false);
    this.showTelegramRecipientForm.set(false);
    this.dateFormatPreset.set(presetForDateFormat(this.savedFormValues.date_format));
    this.cdr.markForCheck();
  }

  /**
   * Applies a date-format preset selection: updates the preset select's own state and,
   * unless "Custom" was picked, writes the preset's strftime pattern into the form.
   *
   * @param value - Selected preset's strftime pattern, or CUSTOM_DATE_FORMAT_VALUE.
   */
  onDateFormatPresetChange(value: string): void {
    this.dateFormatPreset.set(value);
    if (value !== CUSTOM_DATE_FORMAT_VALUE) {
      this.form.get('date_format')?.setValue(value);
      this.form.get('date_format')?.markAsDirty();
    }
  }

  /** Recomputes the live date-format preview from the form's current values. */
  private updateDatePreview(): void {
    const { date_format, timezone } = this.form.getRawValue();
    this.datePreview.set(
      formatPreview(date_format || FORM_DEFAULTS.date_format, timezone || DEFAULT_TIMEZONE),
    );
    this.cdr.markForCheck();
  }

  /**
   * Opens the inline recipient form in "add" mode with empty fields.
   */
  openAddRecipient(): void {
    this.editingIndex = null;
    this.addForm.reset({ email: '', name: '' });
    this.showRecipientForm.set(true);
  }

  /**
   * Opens the inline recipient form pre-filled with the selected recipient's data.
   *
   * @param index - Index of the recipient to edit in the recipients signal.
   */
  openEditRecipient(index: number): void {
    const r = this.recipients()[index];
    this.editingIndex = index;
    this.addForm.patchValue({ email: r.email, name: r.name });
    this.showRecipientForm.set(true);
  }

  /**
   * Confirms the add/edit form and updates the recipients signal.
   * Replaces the existing entry when editing, appends when adding.
   */
  confirmRecipient(): void {
    if (this.addForm.invalid) return;
    const { email, name } = this.addForm.getRawValue();
    const current = [...this.recipients()];
    if (this.editingIndex !== null) {
      current[this.editingIndex] = { email: email!, name: name! };
    } else {
      current.push({ email: email!, name: name! });
    }
    this.recipients.set(current);
    this.recipientsDirty.set(true);
    this.showRecipientForm.set(false);
    this.cdr.markForCheck();
  }

  /**
   * Closes the inline recipient form without saving changes.
   */
  cancelRecipientForm(): void {
    this.showRecipientForm.set(false);
  }

  /**
   * Removes a recipient from the list by index.
   *
   * @param index - Index of the recipient to remove.
   */
  removeRecipient(index: number): void {
    this.recipients.set(this.recipients().filter((_, i) => i !== index));
    this.recipientsDirty.set(true);
    this.cdr.markForCheck();
  }

  /**
   * Opens the inline Telegram recipient form in "add" mode with empty fields.
   */
  openAddTelegramRecipient(): void {
    this.editingTelegramIndex = null;
    this.addTelegramForm.reset({ name: '', bot_token: '', chat_id: '' });
    this.showTelegramRecipientForm.set(true);
  }

  /**
   * Opens the inline Telegram recipient form pre-filled with the selected recipient's data.
   *
   * @param index - Index of the Telegram recipient to edit in the telegramRecipients signal.
   */
  openEditTelegramRecipient(index: number): void {
    const r = this.telegramRecipients()[index];
    this.editingTelegramIndex = index;
    this.addTelegramForm.patchValue({ name: r.name, bot_token: r.bot_token, chat_id: r.chat_id });
    this.showTelegramRecipientForm.set(true);
  }

  /**
   * Confirms the add/edit form and updates the telegramRecipients signal.
   * Replaces the existing entry when editing, appends when adding.
   */
  confirmTelegramRecipient(): void {
    if (this.addTelegramForm.invalid) return;
    const { name, bot_token, chat_id } = this.addTelegramForm.getRawValue();
    const current = [...this.telegramRecipients()];
    if (this.editingTelegramIndex !== null) {
      current[this.editingTelegramIndex] = { name: name!, bot_token: bot_token!, chat_id: chat_id! };
    } else {
      current.push({ name: name!, bot_token: bot_token!, chat_id: chat_id! });
    }
    this.telegramRecipients.set(current);
    this.telegramRecipientsDirty.set(true);
    this.showTelegramRecipientForm.set(false);
    this.cdr.markForCheck();
  }

  /**
   * Closes the inline Telegram recipient form without saving changes.
   */
  cancelTelegramRecipientForm(): void {
    this.showTelegramRecipientForm.set(false);
  }

  /**
   * Removes a Telegram recipient from the list by index.
   *
   * @param index - Index of the Telegram recipient to remove.
   */
  removeTelegramRecipient(index: number): void {
    this.telegramRecipients.set(this.telegramRecipients().filter((_, i) => i !== index));
    this.telegramRecipientsDirty.set(true);
    this.cdr.markForCheck();
  }

  /**
   * Opens the Telegram bot setup help dialog.
   */
  openTelegramHelp(): void {
    this.dialog.open(TelegramHelpDialogComponent);
  }

  /**
   * Opens the Telegram getUpdates endpoint for the bot token currently typed in the
   * add/edit form, in a new tab, so the user can read their chat_id from the JSON response.
   */
  openTelegramGetUpdates(): void {
    const botToken = this.addTelegramForm.get('bot_token')?.value;
    if (!botToken) return;
    window.open(`${TELEGRAM_API_BASE}/bot${botToken}/getUpdates`, '_blank', 'noopener,noreferrer');
  }

  /**
   * Sends a test email to the currently listed recipients, using the form's
   * current — possibly unsaved — recovery subject/body, timezone, and date
   * format, filled with synthetic sample data.
   */
  async testSendEmail(): Promise<void> {
    if (this.testingEmail() || this.recipients().length === 0) return;
    this.testingEmail.set(true);
    try {
      const sent = await this.dataService.sendTestAlert({
        ...this.buildTestAlertBase(),
        channel: 'email',
        recipients: this.recipients(),
      });
      this.snackBar.open(
        this.translate.instant('SETTINGS.TEST_SEND_SUCCESS', { count: sent }), '', { duration: 3000 },
      );
    } catch {
      this.snackBar.open(this.translate.instant('SETTINGS.TEST_SEND_ERROR'), '', { duration: 4000 });
    } finally {
      this.testingEmail.set(false);
      this.cdr.markForCheck();
    }
  }

  /**
   * Sends a test Telegram message to the currently listed recipients, using the
   * form's current — possibly unsaved — recovery subject/body, timezone, and date
   * format, filled with synthetic sample data.
   */
  async testSendTelegram(): Promise<void> {
    if (this.testingTelegram() || this.telegramRecipients().length === 0) return;
    this.testingTelegram.set(true);
    try {
      const sent = await this.dataService.sendTestAlert({
        ...this.buildTestAlertBase(),
        channel: 'telegram',
        recipients: this.telegramRecipients(),
      });
      this.snackBar.open(
        this.translate.instant('SETTINGS.TEST_SEND_SUCCESS', { count: sent }), '', { duration: 3000 },
      );
    } catch {
      this.snackBar.open(this.translate.instant('SETTINGS.TEST_SEND_ERROR'), '', { duration: 4000 });
    } finally {
      this.testingTelegram.set(false);
      this.cdr.markForCheck();
    }
  }

  /** Builds the subject/body/timezone/date-format shared by both test-send channels. */
  private buildTestAlertBase(): Omit<TestAlertRequest, 'channel' | 'recipients'> {
    const raw = this.form.getRawValue();
    const subjectPrefix = raw.email_subject_prefix || FORM_DEFAULTS.email_subject_prefix;
    return {
      subject: buildSubjectPrefixMarker(subjectPrefix) + (raw.email_subject_up ?? FORM_DEFAULTS.email_subject_up),
      bodyTemplate: raw.email_body_up ?? DEFAULT_BODY_UP,
      timezone: raw.timezone ?? DEFAULT_TIMEZONE,
      dateFormat: raw.date_format ?? FORM_DEFAULTS.date_format,
    };
  }
}
