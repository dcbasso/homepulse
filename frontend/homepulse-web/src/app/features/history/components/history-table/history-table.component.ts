import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { SpeedtestResult } from '../../../../core/models/speedtest-result.model';

const PAGE_SIZE = 25;

/**
 * Formats a Firestore Timestamp to "dd/MM/yyyy HH:mm".
 *
 * @param ts - Firestore Timestamp to format.
 */
function formatTimestamp(ts: Timestamp): string {
  const d = ts.toDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Builds the tooltip text shown in the Info column.
 *
 * @param row - Speedtest result containing isp and server fields.
 */
function buildInfoTooltip(row: SpeedtestResult): string {
  const isp    = row.isp    || '—';
  const server = row.server || '—';
  return `Provedor: ${isp}\nServidor: ${server}`;
}

/**
 * Paginated table displaying detailed speedtest measurements.
 *
 * Each row shows timestamp, external IP, download, upload, jitter, ping,
 * and an info icon whose tooltip reveals the ISP and test server.
 */
@Component({
  selector: 'app-history-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatTooltipModule, MatIconModule, TranslatePipe],
  template: `
    <div class="search-bar">
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>{{ 'COMMON.SEARCH' | translate }}</mat-label>
        <input matInput (input)="applyFilter($event)" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
    </div>

    <div class="table-container">
      <table mat-table [dataSource]="dataSource" class="history-table">

        <ng-container matColumnDef="timestamp">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_TIME' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ formatTimestamp(row.timestamp) }}</td>
        </ng-container>

        <ng-container matColumnDef="external_ip_v4">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_IPV4' | translate }}</th>
          <td mat-cell *matCellDef="let row" class="ip-cell">{{ row.external_ip_v4 || '—' }}</td>
        </ng-container>

        <ng-container matColumnDef="external_ip_v6">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_IPV6' | translate }}</th>
          <td mat-cell *matCellDef="let row" class="ip-cell">{{ row.external_ip_v6 || '—' }}</td>
        </ng-container>

        <ng-container matColumnDef="download_mbps">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_DOWNLOAD' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ row.download_mbps | number:'1.1-1' }} Mbps</td>
        </ng-container>

        <ng-container matColumnDef="upload_mbps">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_UPLOAD' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ row.upload_mbps | number:'1.1-1' }} Mbps</td>
        </ng-container>

        <ng-container matColumnDef="jitter_ms">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_JITTER' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ row.jitter_ms | number:'1.1-1' }} ms</td>
        </ng-container>

        <ng-container matColumnDef="ping_ms">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_PING' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ row.ping_ms | number:'1.1-1' }} ms</td>
        </ng-container>

        <ng-container matColumnDef="info">
          <th mat-header-cell *matHeaderCellDef>{{ 'HISTORY.COL_INFO' | translate }}</th>
          <td mat-cell *matCellDef="let row">
            <mat-icon
              class="info-icon"
              [matTooltip]="buildInfoTooltip(row)"
              matTooltipClass="multiline-tooltip"
            >info_outline</mat-icon>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>

        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty-row" [attr.colspan]="displayedColumns.length">
            {{ 'HISTORY.NO_DATA' | translate }}
          </td>
        </tr>
      </table>

      <mat-paginator
        [pageSize]="PAGE_SIZE"
        [pageSizeOptions]="[25, 50, 100]"
        showFirstLastButtons
      />
    </div>
  `,
  styles: [`
    .search-bar { margin-bottom: 0.5rem; }
    .search-field { width: 100%; max-width: 360px; }
    .table-container { overflow-x: auto; }
    .history-table { width: 100%; }

    .ip-cell {
      font-family: monospace;
      font-size: 0.9rem;
    }

    .info-icon {
      font-size: 1.1rem;
      width: 1.1rem;
      height: 1.1rem;
      cursor: default;
      color: var(--mat-sys-on-surface-variant);
      vertical-align: middle;
    }

    .empty-row {
      text-align: center;
      padding: 2rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class HistoryTableComponent implements AfterViewInit {
  /** Speedtest results to display. */
  readonly results = input<SpeedtestResult[]>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  readonly dataSource = new MatTableDataSource<SpeedtestResult>([]);
  readonly displayedColumns = ['timestamp', 'external_ip_v4', 'external_ip_v6', 'download_mbps', 'upload_mbps', 'jitter_ms', 'ping_ms', 'info'];
  readonly PAGE_SIZE = PAGE_SIZE;

  protected readonly formatTimestamp = formatTimestamp;
  protected readonly buildInfoTooltip = buildInfoTooltip;

  constructor() {
    this.dataSource.filterPredicate = (row: SpeedtestResult, filter: string) => {
      const term = filter.trim().toLowerCase();
      return [row.external_ip_v4, row.external_ip_v6, row.isp, row.server]
        .some(field => (field ?? '').toLowerCase().includes(term));
    };

    effect(() => {
      this.dataSource.data = this.results();
    });
  }

  /** Binds the paginator to the table data source after the view is ready. */
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }

  /**
   * Applies the text filter to the table data source and resets to the first page.
   *
   * @param event - Native input event from the search field.
   */
  applyFilter(event: Event): void {
    this.dataSource.filter = (event.target as HTMLInputElement).value;
    this.paginator?.firstPage();
  }
}
