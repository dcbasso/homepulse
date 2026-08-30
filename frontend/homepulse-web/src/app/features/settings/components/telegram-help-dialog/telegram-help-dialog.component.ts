import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Modal dialog with step-by-step instructions for creating a Telegram bot
 * and obtaining its token and chat ID, opened from the Settings screen.
 */
@Component({
  selector: 'app-telegram-help-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'SETTINGS.TELEGRAM_HELP_TITLE' | translate }}</h2>
    <mat-dialog-content>
      <ol class="help-steps">
        <li>{{ 'SETTINGS.TELEGRAM_HELP_STEP_1' | translate }}</li>
        <li>{{ 'SETTINGS.TELEGRAM_HELP_STEP_2' | translate }}</li>
        <li>{{ 'SETTINGS.TELEGRAM_HELP_STEP_3' | translate }}</li>
        <li>{{ 'SETTINGS.TELEGRAM_HELP_STEP_4' | translate }}</li>
      </ol>
      <p>
        <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">
          {{ 'SETTINGS.TELEGRAM_HELP_LINK' | translate }}
        </a>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'SETTINGS.TELEGRAM_HELP_CLOSE' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .help-steps {
      padding-left: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
  `],
})
export class TelegramHelpDialogComponent {}
