"""One-shot migration: root collections -> households/{household_id}/... schema.

Implements Fase 1 of docs/adr/ROADMAP.md (ADR 0002, 0003, 0009). Recopies the
existing root-level collections (`speedtest_results`, `heartbeats`,
`incidents`, `monitor_state/current`, `monitor_config/current`) into
subcollections under a new `households/{household_id}` document, without
touching or deleting the originals. Safe to re-run: every copied document
keeps its original document ID, so re-running overwrites with the same data
instead of duplicating it.

Usage:
    python migrate_to_households.py --owner-email dcbasso@gmail.com
    python migrate_to_households.py --owner-email dcbasso@gmail.com --dry-run
    python migrate_to_households.py --owner-email dcbasso@gmail.com \\
        --household-id 5f2c9e6a-... --owner-uid abc123

Required environment variables (same as the Cloud Function, see .env.example):
    GCP_PROJECT_ID
    FIRESTORE_DATABASE (optional, defaults to "(default)")

Requirements:
    pip install --user google-cloud-firestore
"""

import argparse
import logging
import os
import sys
import uuid
from dataclasses import dataclass

from google.cloud import firestore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ROOT_COLLECTION_HEARTBEATS = "heartbeats"
ROOT_COLLECTION_SPEEDTEST_RESULTS = "speedtest_results"
ROOT_COLLECTION_INCIDENTS = "incidents"
ROOT_COLLECTION_STATE = "monitor_state"
ROOT_COLLECTION_CONFIG = "monitor_config"

SINGLETON_DOC_ID = "current"

# Time-series collections copied document-by-document into the new household
# subcollection, preserving the original document ID.
TIME_SERIES_COLLECTIONS = (
    ROOT_COLLECTION_HEARTBEATS,
    ROOT_COLLECTION_SPEEDTEST_RESULTS,
    ROOT_COLLECTION_INCIDENTS,
)

# Firestore rejects batches larger than 500 writes.
BATCH_SIZE = 500


@dataclass
class MigrationSummary:
    """Counts of documents copied per collection during a migration run.

    Attributes:
        household_id: The household the data was copied into.
        collection_counts: Map of root collection name to number of documents copied.
        singleton_docs_copied: Number of singleton docs copied (monitor_state/monitor_config).
    """

    household_id: str
    collection_counts: dict[str, int]
    singleton_docs_copied: int


def _get_firestore_client() -> firestore.Client:
    """Builds a Firestore client from the same env vars used by the Cloud Function.

    Returns:
        An authenticated Firestore client for the configured GCP project.
    """
    project_id = os.environ["GCP_PROJECT_ID"]
    database = os.environ.get("FIRESTORE_DATABASE", "(default)")
    return firestore.Client(project=project_id, database=database)


def _create_household_doc(
    db: firestore.Client,
    household_id: str,
    owner_email: str,
    owner_uid: str | None,
    dry_run: bool,
) -> None:
    """Creates (or overwrites) the `households/{household_id}` root document
    and its owner entry in the `members` subcollection (see ADR 0006).

    The member document is keyed by `owner_uid` when known, so
    `firestore.rules`'s `exists(.../members/$(request.auth.uid))` check
    authorizes the owner immediately. If `owner_uid` is not supplied, it is
    keyed by email instead and reconciled to the uid on the owner's first
    login, matching `HouseholdContextService.resolveMembershipsFor`.

    Args:
        db: Authenticated Firestore client.
        household_id: ID of the household document to create.
        owner_email: Email of the existing single-user account, added as owner.
        owner_uid: Firebase Auth UID of the owner, if known. None if not supplied.
        dry_run: If True, logs the intended write without performing it.
    """
    data = {"name": "Default household", "status": "active", "api_keys": []}
    member_id = owner_uid or owner_email
    member_data = {"uid": owner_uid or "", "email": owner_email, "role": "owner"}

    if dry_run:
        logger.info("[dry-run] Would create households/%s with %s", household_id, data)
        logger.info(
            "[dry-run] Would create households/%s/members/%s with %s",
            household_id, member_id, member_data,
        )
        return

    db.collection("households").document(household_id).set(data)
    db.collection("households").document(household_id).collection("members").document(
        member_id
    ).set(member_data)
    logger.info("Created households/%s (owner: %s)", household_id, owner_email)


def _copy_time_series_collection(
    db: firestore.Client, household_id: str, collection_name: str, dry_run: bool
) -> int:
    """Copies every document from a root collection into the household subcollection.

    Preserves original document IDs so re-running the migration overwrites
    the same documents instead of duplicating them. Writes are batched to
    stay under Firestore's per-batch operation limit.

    Args:
        db: Authenticated Firestore client.
        household_id: Destination household ID.
        collection_name: Name of the root collection to copy (e.g. "heartbeats").
        dry_run: If True, counts documents without writing anything.

    Returns:
        The number of documents copied (or that would be copied, in dry-run mode).
    """
    source_docs = list(db.collection(collection_name).stream())
    if dry_run:
        logger.info(
            "[dry-run] Would copy %d document(s) from %s to households/%s/%s",
            len(source_docs), collection_name, household_id, collection_name,
        )
        return len(source_docs)

    dest_collection = (
        db.collection("households").document(household_id).collection(collection_name)
    )
    copied = 0
    batch = db.batch()
    pending = 0
    for doc in source_docs:
        batch.set(dest_collection.document(doc.id), doc.to_dict())
        pending += 1
        copied += 1
        if pending == BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()

    logger.info(
        "Copied %d document(s) from %s to households/%s/%s",
        copied, collection_name, household_id, collection_name,
    )
    return copied


def _copy_singleton_doc(
    db: firestore.Client, household_id: str, collection_name: str, dry_run: bool
) -> bool:
    """Copies a single fixed document (e.g. `monitor_state/current`) into the household.

    Args:
        db: Authenticated Firestore client.
        household_id: Destination household ID.
        collection_name: Root collection holding the singleton doc
            ("monitor_state" or "monitor_config").
        dry_run: If True, logs the intended write without performing it.

    Returns:
        True if the source document existed and was (or would be) copied, else False.
    """
    source_ref = db.collection(collection_name).document(SINGLETON_DOC_ID)
    source_doc = source_ref.get()
    if not source_doc.exists:
        logger.warning("%s/%s does not exist — skipping", collection_name, SINGLETON_DOC_ID)
        return False

    if dry_run:
        logger.info(
            "[dry-run] Would copy %s/%s to households/%s/%s/%s",
            collection_name, SINGLETON_DOC_ID, household_id, collection_name, SINGLETON_DOC_ID,
        )
        return True

    dest_ref = (
        db.collection("households")
        .document(household_id)
        .collection(collection_name)
        .document(SINGLETON_DOC_ID)
    )
    dest_ref.set(source_doc.to_dict())
    logger.info(
        "Copied %s/%s to households/%s/%s/%s",
        collection_name, SINGLETON_DOC_ID, household_id, collection_name, SINGLETON_DOC_ID,
    )
    return True


def migrate(
    db: firestore.Client,
    household_id: str,
    owner_email: str,
    owner_uid: str | None,
    dry_run: bool,
) -> MigrationSummary:
    """Runs the full migration: household doc creation plus all collection copies.

    Old root collections are only read, never modified or deleted, per ADR 0009 —
    they stay in place as a rollback point until the new schema is validated.

    Args:
        db: Authenticated Firestore client.
        household_id: ID to assign to the newly created household.
        owner_email: Email of the existing single-user account, added as owner.
        owner_uid: Firebase Auth UID of the owner, if known.
        dry_run: If True, performs no writes and only logs what would happen.

    Returns:
        A MigrationSummary with per-collection document counts.
    """
    _create_household_doc(db, household_id, owner_email, owner_uid, dry_run)

    collection_counts = {
        name: _copy_time_series_collection(db, household_id, name, dry_run)
        for name in TIME_SERIES_COLLECTIONS
    }

    singleton_docs_copied = sum(
        1
        for name in (ROOT_COLLECTION_STATE, ROOT_COLLECTION_CONFIG)
        if _copy_singleton_doc(db, household_id, name, dry_run)
    )

    return MigrationSummary(
        household_id=household_id,
        collection_counts=collection_counts,
        singleton_docs_copied=singleton_docs_copied,
    )


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """Parses command-line arguments for the migration script.

    Args:
        argv: Argument list (excluding the program name), typically sys.argv[1:].

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--owner-email",
        required=True,
        help="Email of the existing single-user account, registered as household owner.",
    )
    parser.add_argument(
        "--owner-uid",
        default=None,
        help="Firebase Auth UID of the owner, if known. Can be added to the "
        "households/{id} doc later if omitted.",
    )
    parser.add_argument(
        "--household-id",
        default=None,
        help="ID to assign to the new household. Defaults to a freshly generated UUID4, "
        "per ADR 0009 (must not be a predictable value like 'default').",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would be copied without writing anything to Firestore.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """Entry point: parses arguments, runs the migration, and prints a summary.

    Args:
        argv: Argument list (excluding the program name), typically sys.argv[1:].

    Returns:
        Process exit code (0 on success).
    """
    args = _parse_args(argv)
    household_id = args.household_id or str(uuid.uuid4())

    db = _get_firestore_client()
    summary = migrate(
        db=db,
        household_id=household_id,
        owner_email=args.owner_email,
        owner_uid=args.owner_uid,
        dry_run=args.dry_run,
    )

    logger.info("=== Migration summary%s ===", " (dry-run)" if args.dry_run else "")
    logger.info("household_id: %s", summary.household_id)
    for name, count in summary.collection_counts.items():
        logger.info("  %s: %d document(s)", name, count)
    logger.info("  singleton docs (monitor_state/monitor_config): %d", summary.singleton_docs_copied)
    logger.info(
        "Old root collections were left untouched — see ADR 0009 for the cleanup step "
        "once the new schema is validated."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
