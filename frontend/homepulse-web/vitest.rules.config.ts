import { defineConfig } from 'vitest/config';

/**
 * Separate Vitest config for the Firestore rules tests under
 * `firestore-rules-tests/`. Kept apart from `ng test` (Angular's own
 * unit-test builder) because these tests run under plain Node against a
 * live Firestore emulator, not jsdom/TestBed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore-rules-tests/**/*.spec.ts'],
    testTimeout: 20000,
  },
});
