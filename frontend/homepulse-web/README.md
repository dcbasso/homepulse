# Web — Angular Dashboard

Angular 22 dashboard for the speedtest monitor, connected to Firebase/Firestore.

## First-time setup

The Firebase environment files are **not tracked in git** to avoid exposing credentials in a public repository. You need to provide them before running or building the app.

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
```

2. Fill in your Firebase project values in both files. You can find them in the [Firebase Console](https://console.firebase.google.com/) → Project Settings → Your apps → Web app config:

```typescript
export const environment = {
  production: false,              // true in environment.prod.ts
  allowedEmail: 'you@gmail.com', // only this email can sign in
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

## Additional resources

- [Angular CLI docs](https://angular.dev/tools/cli)
- [Firebase Console](https://console.firebase.google.com/)
- [GCP deploy guide](../../docs/deploy.md)
