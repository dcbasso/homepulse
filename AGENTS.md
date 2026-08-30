# homepulse-gcp — Project Conventions

## Monorepo Structure

```
homepulse-gcp/
├── client/homepulse-client/          # Rust — local agent (runs speedtest, writes to Firestore)
├── frontend/homepulse-web/           # Angular — dashboard SPA (Firebase Hosting)
└── backend/homepulse-notification-server/
    ├── function/                     # Python Cloud Function (alerting)
    └── terraform/                    # GCP infrastructure as code
```

**deploy/ folders are gitignored** — they exist locally for credentials/tokens but are never committed.

---

## Language

All code must be written in English:
- Variable names, function names, class names, constants
- Code comments and documentation
- Commit messages
- File names

Exception: user-facing UI strings are managed via i18n files (see Internationalization section).

---

## Documentation

Every method, function, and public type must have documentation. No exceptions.

### Rust — rustdoc
```rust
/// Appends a speedtest result document to Firestore.
///
/// # Arguments
/// * `config` - Firestore connection settings (project ID, collection)
/// * `token` - OAuth2 bearer token obtained from Service Account
/// * `result` - Parsed speedtest measurement to persist
///
/// # Errors
/// Returns an error if the HTTP request fails or Firestore rejects the document.
pub async fn append_document(config: &FirestoreConfig, token: &str, result: &SpeedtestResult) -> Result<()> {
```

### Python — Google-style docstrings
```python
def check_internet_status(request) -> tuple[str, int]:
    """Check whether recent speedtest data exists and send alert emails if needed.

    Reads the latest document from Firestore, compares its timestamp against
    the configured threshold, and sends a Gmail alert on state transitions
    (down → up or up → down).

    Args:
        request: HTTP request object provided by Cloud Functions runtime.

    Returns:
        A tuple of (response_body, http_status_code).
    """
```

### TypeScript/Angular — JSDoc
```typescript
/**
 * Fetches speedtest results from Firestore within the given time range.
 *
 * @param startDate - Start of the query window (inclusive)
 * @param endDate - End of the query window (inclusive)
 * @returns Observable that emits an array of SpeedtestResult ordered by timestamp ascending
 */
getResults(startDate: Date, endDate: Date): Observable<SpeedtestResult[]> {
```

---

## Clean Code

- Functions do one thing. If a function needs a comment explaining what it does, split it.
- No magic numbers — use named constants.
- No dead code — remove unused variables, imports, and methods.
- Prefer explicit over clever.
- Keep functions short. If a function exceeds ~30 lines, consider extracting logic.
- No commented-out code in commits.

---

## Angular — Screen Structure

Each screen is a **standalone component** with its own folder under `features/`. No shared modules.

```
frontend/homepulse-web/src/app/features/
├── login/
├── dashboard/
│   └── components/
│       ├── speed-chart/
│       ├── metrics-cards/
│       └── date-range-filter/
├── incidents/
│   └── components/
│       └── incident-list/
└── settings/
```

Routes are lazy-loaded:
```typescript
// app.routes.ts
{
  path: 'dashboard',
  loadComponent: () => import('./features/dashboard/dashboard.component')
    .then(m => m.DashboardComponent),
  canActivate: [authGuard]
}
```

---

## Internationalization (i18n)

The UI must support three languages: **Portuguese (pt-BR)**, **English (en)**, and **Spanish (es)**.

- Library: **ngx-translate** (`@ngx-translate/core` + `@ngx-translate/http-loader`)
- Translation files in `frontend/homepulse-web/src/assets/i18n/`:
  - `pt-BR.json` — default language
  - `en.json`
  - `es.json`

**Rule: any maintenance or new screen that touches user-facing strings must update all three translation files (pt-BR, en, es) in the same change.** A key added or changed in one file must be added or changed in the other two — never leave them out of sync.

All user-facing strings must use the translate pipe or service. No hardcoded strings in templates or components.

```html
<h1>{{ 'DASHBOARD.TITLE' | translate }}</h1>
```

```typescript
this.snackBar.open(this.translate.instant('COMMON.SAVE_SUCCESS'), '', { duration: 3000 });
```

Translation key structure:
```json
{
  "COMMON": { "SAVE": "Save", "CANCEL": "Cancel", "LOADING": "Loading..." },
  "LOGIN": { "TITLE": "HomePulse", "BUTTON": "Sign in with Google" },
  "DASHBOARD": { "TITLE": "Dashboard", "NO_DATA": "No records found for this period" },
  "INCIDENTS": { "TITLE": "Incidents", "NO_INCIDENTS": "No incidents found — all good!" },
  "SETTINGS": { "TITLE": "Settings", "SAVE_SUCCESS": "Settings saved successfully" }
}
```

Language preference is persisted in `localStorage`. A language selector is shown in the navbar.

---

## Theming (Light / Dark)

Angular Material custom themes with CSS custom properties. Two themes defined in `styles.scss`.

- Default: follows system preference via `prefers-color-scheme`
- User can override via toggle in the navbar
- Preference persisted in `localStorage`

```scss
$light-theme: mat.define-theme((color: (theme-type: light, primary: mat.$blue-palette)));
$dark-theme:  mat.define-theme((color: (theme-type: dark,  primary: mat.$blue-palette)));

:root { @include mat.all-component-themes($light-theme); }
.dark-theme { @include mat.all-component-themes($dark-theme); }
```

---

## Angular Rules (Non-Negotiable)

### 1. Standalone only — no NgModule
```typescript
@Component({ standalone: true, imports: [...], ... })
```

### 2. Always `ChangeDetectionStrategy.OnPush`
```typescript
@Component({ ..., changeDetection: ChangeDetectionStrategy.OnPush })
```

### 3. No memory leaks — always unsubscribe
Prefer the `async` pipe. When subscribing in a class, use `takeUntilDestroyed()`.
```typescript
private destroy$ = inject(DestroyRef);
this.service.data$.pipe(takeUntilDestroyed(this.destroy$)).subscribe(...);
```

### 4. No hardcoded user-facing strings
Every string visible to the user must come from i18n files.

### 5. No `any` in TypeScript
Use `unknown` and narrow it. `any` silences the compiler and hides bugs.

### 6. Business logic belongs in services, not components

### 7. No new external libraries without approval
Approved packages already in scope: `@angular/material`, `@angular/fire`, `@ngx-translate/core`, `@ngx-translate/http-loader`, `ngx-charts`.

### 8. Lazy-loaded routes only
```typescript
{ path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) }
```

---

## Which subproject should I edit?

| Goal | Path |
|---|---|
| Change Rust client (Firestore writer) | `client/homepulse-client/` |
| Change Cloud Function / alerting logic | `backend/homepulse-notification-server/function/` |
| Change GCP infrastructure | `backend/homepulse-notification-server/terraform/` |
| Change Angular dashboard | `frontend/homepulse-web/` |
