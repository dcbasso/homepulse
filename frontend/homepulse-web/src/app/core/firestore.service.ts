import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  setDoc,
  query,
  orderBy,
  limit,
  where,
  QueryConstraint,
  DocumentData,
  CollectionReference,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);

  /**
   * Returns a typed reference to a Firestore collection.
   *
   * @param path - Dot-separated collection path (e.g. 'speedtest_results').
   */
  col<T extends DocumentData>(path: string): CollectionReference<T> {
    return collection(this.firestore, path) as CollectionReference<T>;
  }

  /**
   * Subscribes to all documents in a collection, applying optional constraints.
   *
   * @param path - Firestore collection path.
   * @param constraints - Optional query constraints (where, orderBy, limit, etc.).
   * @returns Observable that emits the document array on every change.
   */
  getCollection<T extends DocumentData>(
    path: string,
    ...constraints: QueryConstraint[]
  ): Observable<T[]> {
    const ref = collection(this.firestore, path) as CollectionReference<T>;
    const q = constraints.length ? query(ref, ...constraints) : ref;
    return collectionData(q, { idField: 'id' }) as Observable<T[]>;
  }

  /**
   * Subscribes to a single document by path.
   *
   * @param path - Full document path (e.g. 'monitor_config/current').
   * @returns Observable that emits the document data on every change.
   */
  getDoc<T extends DocumentData>(path: string): Observable<T | undefined> {
    return docData(doc(this.firestore, path)) as Observable<T | undefined>;
  }

  /**
   * Writes (merge) data into a document at the given path.
   *
   * @param path - Full document path.
   * @param data - Data to merge into the document.
   * @returns Promise that resolves when the write is committed.
   */
  setDoc(path: string, data: DocumentData): Promise<void> {
    return setDoc(doc(this.firestore, path), data, { merge: true });
  }

  /** Re-exports constraint helpers for convenience. */
  readonly orderBy = orderBy;
  readonly limit = limit;
  readonly where = where;
}
