export const environment = {
  production: false,
  testAlertFunctionUrl: 'https://REGION-YOUR_PROJECT_ID.cloudfunctions.net/send-test-alert',
  inviteFunctionUrl: 'https://REGION-YOUR_PROJECT_ID.cloudfunctions.net/send-invite-email',
  issueApiKeyFunctionUrl: 'https://REGION-YOUR_PROJECT_ID.cloudfunctions.net/issue-api-key',
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID',
    measurementId: 'YOUR_MEASUREMENT_ID',
    databaseId: 'YOUR_FIRESTORE_DATABASE_ID',
  },
};
