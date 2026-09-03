import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { householdGuard } from './core/household.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'incidents',
    loadComponent: () =>
      import('./features/incidents/incidents.component').then((m) => m.IncidentsComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./features/history/history.component').then((m) => m.HistoryComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'heartbeat-history',
    loadComponent: () =>
      import('./features/heartbeat-history/heartbeat-history.component').then(
        (m) => m.HeartbeatHistoryComponent,
      ),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'members',
    loadComponent: () =>
      import('./features/members/members.component').then((m) => m.MembersComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'preferences',
    loadComponent: () =>
      import('./features/preferences/preferences.component').then((m) => m.PreferencesComponent),
    canActivate: [authGuard, householdGuard],
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./features/about/about.component').then((m) => m.AboutComponent),
    canActivate: [authGuard, householdGuard],
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboard' },
];
