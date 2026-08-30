import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { Heartbeat } from '../../../../core/models/heartbeat.model';

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
 * Paginated table that displays the external IP field from each heartbeat
 * document, alongside the heartbeat timestamp.
 */
@Component({
  selector: 'app-heartbeat-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatIconModule, TranslatePipe],
  template: `
    <div class="search-bar">
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>{{ 'COMMON.SEARCH' | translate }}</mat-label>
        <input matInput (input)="applyFilter($event)" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
    </div>

    <div class="table-container">
      <table mat-table [dataSource]="dataSource" class="ip-table">

        <ng-container matColumnDef="timestamp">
          <th mat-header-cell *matHeaderCellDef>{{ 'HEARTBEAT_HISTORY.COL_TIME' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ formatTimestamp(row.timestamp) }}</td>
        </ng-container>

        <ng-container matColumnDef="external_ip_v4">
          <th mat-header-cell *matHeaderCellDef>{{ 'HEARTBEAT_HISTORY.COL_IPV4' | translate }}</th>
          <td mat-cell *matCellDef="let row" class="ip-cell">{{ row.external_ip_v4 || '—' }}</td>
        </ng-container>

        <ng-container matColumnDef="external_ip_v6">
          <th mat-header-cell *matHeaderCellDef>{{ 'HEARTBEAT_HISTORY.COL_IPV6' | translate }}</th>
          <td mat-cell *matCellDef="let row" class="ip-cell">{{ row.external_ip_v6 || '—' }}</td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>

        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty-row" [attr.colspan]="displayedColumns.length">
            {{ 'HEARTBEAT_HISTORY.NO_DATA' | translate }}
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
    .ip-table { width: 100%; }

    .ip-cell {
      font-family: monospace;
      font-size: 0.9rem;
    }

    .empty-row {
      text-align: center;
      padding: 2rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class HeartbeatTableComponent implements AfterViewInit {
  /** Heartbeat documents to display. */
  readonly results = input<Heartbeat[]>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  readonly dataSource = new MatTableDataSource<Heartbeat>([]);
  readonly displayedColumns = ['timestamp', 'external_ip_v4', 'external_ip_v6'];
  readonly PAGE_SIZE = PAGE_SIZE;

  protected readonly formatTimestamp = formatTimestamp;

  constructor() {
    this.dataSource.filterPredicate = (row: Heartbeat, filter: string) => {
      const term = filter.trim().toLowerCase();
      return [row.external_ip_v4, row.external_ip_v6]
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
