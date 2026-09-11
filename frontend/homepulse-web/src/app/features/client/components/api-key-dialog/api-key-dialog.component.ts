import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/** Data passed into {@link ApiKeyDialogComponent} when it is opened. */
export interface ApiKeyDialogData {
  apiKey: string;
}

/**
 * Shows a freshly issued ingest API key exactly once, with a "copy to
 * clipboard" affordance. The key only ever lives in this dialog's data and
 * is discarded (never persisted in clear text) once the dialog is closed.
 */
@Component({
  selector: 'app-api-key-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'CLIENT.KEY_DIALOG_TITLE' | translate }}</h2>
    <mat-dialog-content>
      <p class="warning">{{ 'CLIENT.KEY_WARNING' | translate }}</p>
      <div class="key-box">
        <code>{{ data.apiKey }}</code>
        <button mat-icon-button [attr.aria-label]="'CLIENT.COPY' | translate" (click)="copy()">
          <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
        </button>
      </div>
      @if (copied()) {
        <p class="copied-hint">{{ 'CLIENT.COPIED' | translate }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'CLIENT.CLOSE' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .warning {
      color: var(--mat-sys-error);
      font-weight: 500;
    }
    .key-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      background: var(--mat-sys-surface-container-high);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
    }
    .key-box code {
      overflow-wrap: anywhere;
      font-size: 0.85rem;
    }
    .copied-hint {
      color: var(--mat-sys-primary);
      font-size: 0.85rem;
      margin-bottom: 0;
    }
  `],
})
export class ApiKeyDialogComponent {
  protected data = inject<ApiKeyDialogData>(MAT_DIALOG_DATA);

  /** True right after the key was copied, to briefly swap the icon/hint. */
  protected copied = signal(false);

  /** Copies the API key to the clipboard and briefly flags success. */
  copy(): void {
    navigator.clipboard.writeText(this.data.apiKey).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
