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
import { TranslatePipe } from '@ngx-translate/core';
import { Timestamp } from '@angular/fire/firestore';
import { Incident } from '../../../../core/models/incident.model';

const PAGE_SIZE = 10;

/**
 * Formats a duration given in minutes as "Xh YYmin".
 *
 * @param minutes - Total duration in minutes.
 */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
}

/**
 * Formats a closed incident's duration.
 * Returns "—" for null values.
 *
 * @param minutes - Total duration in minutes, or null.
 */
function formatDuration(minutes: number | null): string {
  return minutes === null ? '—' : formatMinutes(minutes);
}

/**
 * Computes and formats the elapsed time since a Firestore Timestamp until now.
 *
 * @param ts - Timestamp marking when the incident started.
 */
function elapsedSince(ts: Timestamp): string {
  const elapsed = Math.floor((Date.now() - ts.toDate().getTime()) / 60_000);
  return `~${formatMinutes(elapsed)}`;
}

/**
 * Formats a Firestore Timestamp to a locale-friendly "dd/MM/yyyy HH:mm" string.
 *
 * @param ts - Firestore Timestamp to format.
 */
function formatTimestamp(ts: Timestamp): string {
  const d = ts.toDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Table component that displays a paginated list of internet outage incidents.
 *
 * Each row shows the incident index, start time, end time (or "Ongoing" badge),
 * and duration. Ongoing incidents (no recovered_at) are highlighted in red.
 */
@Component({
  selector: 'app-incident-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, MatPaginatorModule, TranslatePipe],
  template: `
    <div class="table-container">
      <table mat-table [dataSource]="dataSource" class="incident-table">

        <ng-container matColumnDef="index">
          <th mat-header-cell *matHeaderCellDef>{{ 'INCIDENTS.COL_INDEX' | translate }}</th>
          <td mat-cell *matCellDef="let row; let i = index">
            {{ (dataSource.paginator?.pageIndex ?? 0) * PAGE_SIZE + i + 1 }}
          </td>
        </ng-container>

        <ng-container matColumnDef="started_at">
          <th mat-header-cell *matHeaderCellDef>{{ 'INCIDENTS.START' | translate }}</th>
          <td mat-cell *matCellDef="let row">{{ formatTimestamp(row.started_at) }}</td>
        </ng-container>

        <ng-container matColumnDef="recovered_at">
          <th mat-header-cell *matHeaderCellDef>{{ 'INCIDENTS.END' | translate }}</th>
          <td mat-cell *matCellDef="let row">
            @if (row.recovered_at) {
              {{ formatTimestamp(row.recovered_at) }}
            } @else {
              <span class="badge-ongoing">{{ 'INCIDENTS.ONGOING' | translate }}</span>
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="duration">
          <th mat-header-cell *matHeaderCellDef>{{ 'INCIDENTS.DURATION' | translate }}</th>
          <td mat-cell *matCellDef="let row">
            @if (row.recovered_at) {
              {{ formatDuration(row.duration_minutes) }}
            } @else {
              <span class="duration-ongoing">{{ elapsedSince(row.started_at) }}</span>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr
          mat-row
          *matRowDef="let row; columns: displayedColumns;"
          [class.incident-ongoing]="row.recovered_at === null"
        ></tr>

        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty-row" [attr.colspan]="displayedColumns.length">
            {{ 'INCIDENTS.NO_INCIDENTS' | translate }}
          </td>
        </tr>
      </table>

      <mat-paginator
        [pageSize]="PAGE_SIZE"
        [pageSizeOptions]="[10, 25, 50]"
        showFirstLastButtons
      />
    </div>
  `,
  styles: [`
    .table-container { overflow-x: auto; }
    .incident-table { width: 100%; }

    .badge-ongoing {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #ea4335;
      color: #fff;
    }

    .incident-ongoing td {
      background: #fff3f3;
    }

    :host-context(.dark-theme) .incident-ongoing td {
      background: #3d1a1a;
    }

    .duration-ongoing {
      color: #ea4335;
      font-weight: 600;
    }

    .empty-row {
      text-align: center;
      padding: 2rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class IncidentListComponent implements AfterViewInit {
  /** Incidents to display in the table. */
  readonly incidents = input<Incident[]>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  readonly dataSource = new MatTableDataSource<Incident>([]);
  readonly displayedColumns = ['index', 'started_at', 'recovered_at', 'duration'];
  readonly PAGE_SIZE = PAGE_SIZE;

  protected readonly formatTimestamp = formatTimestamp;
  protected readonly formatDuration = formatDuration;
  protected readonly elapsedSince = elapsedSince;

  constructor() {
    effect(() => {
      this.dataSource.data = this.incidents();
    });
  }

  /** Binds the paginator to the table data source after the view is ready. */
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }
}
