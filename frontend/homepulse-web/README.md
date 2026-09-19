# Web — Angular Dashboard

Angular 22 dashboard for the speedtest monitor, connected to Firebase/Firestore.

## First-time setup

The Firebase environment files and `.firebaserc` are **not tracked in git** to avoid exposing credentials and the real project id in a public repository. You need to provide them before running or building the app.

### If you have access to the `deploy/` folder (owner)

Run the setup script to copy the real environment files into place:

```bash
bash deploy/setup-env.sh
```

This copies `deploy/environment.ts` and `deploy/environment.prod.ts` to `src/environments/`.

### If you are setting up from scratch

1. Copy the example files:

```bash
cp src/environments/environment.example.ts      src/environments/environment.ts
cp src/environments/environment.prod.example.ts src/environments/environment.prod.ts
cp .firebaserc.example                           .firebaserc
```

2. Fill in your Firebase project values in both files, and your project id in `.firebaserc`. You can find them in the [Firebase Console](https://console.firebase.google.com/) → Project Settings → Your apps → Web app config:

```typescript
export const environment = {
  production: false,              // true in environment.prod.ts
  superAdminEmail: 'you@gmail.com', // sees the platform-wide households list
  firebase: {
    apiKey: '...',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: '...',
    appId: '...',
    measurementId: '...',        // optional, for Firebase Analytics
    databaseId: '...',           // named Firestore database (not "(default)")
  },
};
```

---

## Installing dependencies

```bash
npm install --legacy-peer-deps
```

The `--legacy-peer-deps` flag is required: `@angular/fire@20.0.1` (the latest stable release) only declares peer support for `@angular/core@^20.0.0`, while this project runs Angular 22. There is no stable `@angular/fire` release yet targeting Angular 22 (only pre-release `canary` tags) — plain `npm install` fails on this peer conflict until one ships. Revisit this once `@angular/fire` publishes stable Angular 22 support.

## Development server

```bash
ng serve
```

Open [http://localhost:4200](http://localhost:4200). The app reloads on file changes.

## Production build

```bash
ng build
```

Artifacts are output to `dist/`. The Angular CLI uses `environment.prod.ts` automatically for production builds.

## Deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

Or use the full deploy script at `../deploy.sh` which handles Cloud Functions and Hosting together.

## Code scaffolding

```bash
ng generate component component-name
```

## Running unit tests

```bash
ng test
```

## Running Firestore rules tests

Cross-tenant isolation tests for `firestore.rules` (see `firestore-rules-tests/`), run against a real Firestore emulator — separate from `ng test` since these exercise the server-enforced rules directly, not Angular components:

```bash
npm run test:rules
```

## Additional resources

- [Angular CLI docs](https://angular.dev/tools/cli)
- [Firebase Console](https://console.firebase.google.com/)
- [GCP deploy guide](../../docs/deploy.md)
