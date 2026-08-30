import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user } from '@angular/fire/auth';
import type { User } from '@angular/fire/auth';
import { Observable, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private router = inject(Router);

  /** Emits the currently authenticated user, or null when signed out. */
  currentUser$: Observable<User | null> = user(this.auth);

  /**
   * Opens a Google Sign-In popup, verifies the email against the allowed list,
   * and redirects to the dashboard on success or rejects with an error on denial.
   *
   * @returns Promise that resolves after a successful login and navigation.
   * @throws Error with message 'ACCESS_DENIED' when the email is not allowed.
   */
  signInWithGoogle(): Observable<void> {
    return from(signInWithPopup(this.auth, new GoogleAuthProvider())).pipe(
      switchMap((credential) => {
        const email = credential.user.email ?? '';
        if (email !== environment.allowedEmail) {
          return from(signOut(this.auth)).pipe(
            switchMap(() => throwError(() => new Error('ACCESS_DENIED'))),
          );
        }
        return from(this.router.navigate(['/dashboard']));
      }),
      switchMap(() => new Observable<void>((obs) => { obs.next(); obs.complete(); })),
    );
  }

  /**
   * Signs out the current user and redirects to the login page.
   *
   * @returns Promise that resolves after sign-out and navigation.
   */
  signOut(): Observable<void> {
    return from(signOut(this.auth)).pipe(
      switchMap(() => from(this.router.navigate(['/login']))),
      switchMap(() => new Observable<void>((obs) => { obs.next(); obs.complete(); })),
    );
  }

  /**
   * Returns a fresh Firebase ID token for the signed-in user, to authenticate
   * calls to backend Cloud Functions that verify it themselves.
   *
   * @returns Promise resolving to the ID token, or null when signed out.
   */
  getIdToken(): Promise<string | null> {
    const currentUser = this.auth.currentUser;
    return currentUser ? currentUser.getIdToken() : Promise.resolve(null);
  }
}
