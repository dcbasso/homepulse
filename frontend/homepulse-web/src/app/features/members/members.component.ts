import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { MembersDataService, HouseholdMemberEntry } from './members-data.service';
import { HouseholdRole } from '../../core/models/household.model';

/** Roles that can be granted to a household member (see ADR 0003/0005). */
const ASSIGNABLE_ROLES: HouseholdRole[] = ['owner', 'admin', 'member'];

/**
 * Members management screen — lets an `owner`/`admin` grant or revoke access
 * to the active household (see ADR 0005: manually administered allowlist,
 * no self-signup). Members with the `member` role see the list read-only.
 */
@Component({
  selector: 'app-members',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    NavbarComponent,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="members-main">
      <h1 class="members-title">{{ 'MEMBERS.TITLE' | translate }}</h1>

      <mat-card class="members-card">
        <mat-card-content>
          @if (members().length === 0) {
            <p class="empty-state">{{ 'MEMBERS.NO_MEMBERS' | translate }}</p>
          }
          @for (member of members(); track member.id) {
            <div class="member-row">
              <div class="member-info">
                <mat-icon>person</mat-icon>
                <span class="member-email">{{ member.email }}</span>
                @if (member.email === currentUserEmail()) {
                  <span class="you-badge">{{ 'MEMBERS.YOU' | translate }}</span>
                }
                @if (canManage() && member.email !== currentUserEmail()) {
                  <mat-form-field appearance="outline" class="role-select">
                    <mat-select
                      [value]="member.role"
                      [disabled]="changingRole()"
                      (selectionChange)="changeRole(member, $event.value)"
                    >
                      @for (role of assignableRoles; track role) {
                        <mat-option [value]="role">{{ 'MEMBERS.ROLE_' + role.toUpperCase() | translate }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                } @else {
                  <span class="member-role">{{ 'MEMBERS.ROLE_' + member.role.toUpperCase() | translate }}</span>
                }
              </div>
              @if (canManage()) {
                <button
                  mat-icon-button
                  [attr.aria-label]="'COMMON.REMOVE' | translate"
                  [disabled]="removing()"
                  (click)="removeMember(member)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      @if (canManage()) {
        <mat-card class="members-card">
          <mat-card-header>
            <mat-card-title>{{ 'MEMBERS.ADD' | translate }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form class="add-form" [formGroup]="addForm" (ngSubmit)="addMember()">
              <mat-form-field appearance="outline" class="email-field">
                <mat-label>{{ 'MEMBERS.EMAIL' | translate }}</mat-label>
                <input matInput type="email" formControlName="email" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="role-field">
                <mat-label>{{ 'MEMBERS.ROLE' | translate }}</mat-label>
                <mat-select formControlName="role">
                  @for (role of assignableRoles; track role) {
                    <mat-option [value]="role">{{ 'MEMBERS.ROLE_' + role.toUpperCase() | translate }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <button mat-raised-button color="primary" type="submit" [disabled]="addForm.invalid || adding()">
                {{ 'MEMBERS.ADD' | translate }}
              </button>
            </form>
          </mat-card-content>
        </mat-card>
      }
    </main>
    </app-navbar>
  `,
  styles: [`
    .members-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .members-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .members-card {
      margin-bottom: 1.25rem;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .member-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .member-row:last-child {
      border-bottom: none;
    }

    .member-info {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .member-email {
      font-weight: 500;
    }

    .you-badge {
      font-size: 0.75rem;
      color: var(--mat-sys-primary);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 8px;
      padding: 0.05rem 0.4rem;
    }

    .member-role {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: capitalize;
    }

    .role-select {
      width: 140px;
    }
    .role-select ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .add-form {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .email-field {
      flex: 2 1 220px;
    }

    .role-field {
      flex: 1 1 140px;
    }
  `],
})
export class MembersComponent {
  private membersDataService = inject(MembersDataService);
  private householdContext = inject(HouseholdContextService);
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);

  /** Roles selectable in the "add member" form. */
  readonly assignableRoles = ASSIGNABLE_ROLES;

  /** Current member list of the active household. */
  members = signal<HouseholdMemberEntry[]>([]);

  /** True while an add/remove request is in flight. */
  adding = signal(false);
  removing = signal(false);
  changingRole = signal(false);

  /** Email of the signed-in user, used to badge their own row. */
  currentUserEmail = signal<string | null>(null);

  /** True when the signed-in user can add/remove members in the active household. */
  canManage = signal(false);

  readonly addForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['member' as HouseholdRole, Validators.required],
  });

  constructor() {
    this.membersDataService.getMembers().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((members) => this.members.set(members));

    this.authService.currentUser$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((user) => this.currentUserEmail.set(user?.email ?? null));

    this.householdContext.activeHousehold$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((household) => this.canManage.set(household?.role === 'owner' || household?.role === 'admin'));
  }

  /**
   * Submits the add-member form, granting the given email access to the
   * active household with the selected role.
   */
  addMember(): void {
    if (this.addForm.invalid) return;
    const { email, role } = this.addForm.getRawValue();
    this.adding.set(true);
    this.membersDataService.addMember(email!, role as HouseholdRole)
      .then(() => {
        this.addForm.reset({ email: '', role: 'member' });
        this.snackBar.open(this.translate.instant('MEMBERS.ADD_SUCCESS'), '', { duration: 3000 });
      })
      .catch(() => this.snackBar.open(this.translate.instant('MEMBERS.ERROR'), '', { duration: 3000 }))
      .finally(() => this.adding.set(false));
  }

  /**
   * Changes the role of an existing member of the active household.
   *
   * @param member - The member entry to update.
   * @param role - The new role to assign to the member.
   */
  changeRole(member: HouseholdMemberEntry, role: HouseholdRole): void {
    if (role === member.role) return;
    this.changingRole.set(true);
    this.membersDataService.updateMemberRole(member, role)
      .then(() => this.snackBar.open(this.translate.instant('MEMBERS.ROLE_UPDATE_SUCCESS'), '', { duration: 3000 }))
      .catch(() => this.snackBar.open(this.translate.instant('MEMBERS.ERROR'), '', { duration: 3000 }))
      .finally(() => this.changingRole.set(false));
  }

  /**
   * Removes a member from the active household, revoking their access.
   *
   * @param member - The member entry to remove.
   */
  removeMember(member: HouseholdMemberEntry): void {
    this.removing.set(true);
    this.membersDataService.removeMember(member)
      .then(() => this.snackBar.open(this.translate.instant('MEMBERS.REMOVE_SUCCESS'), '', { duration: 3000 }))
      .catch(() => this.snackBar.open(this.translate.instant('MEMBERS.ERROR'), '', { duration: 3000 }))
      .finally(() => this.removing.set(false));
  }
}
