"""Issues a new ingest API key for a household.

Implements the key-issuance side of ADR 0004/0010: generates a key in the
form `hpk_<household_id>_<random>`, stores only its SHA-256 hash in
`households/{household_id}.api_keys[]` (appended, never replacing existing
keys, so rotation can happen without downtime), and prints the raw key once.
The raw key is never written anywhere — copy it immediately, it cannot be
recovered afterward.

Usage:
    python issue_api_key.py --household-id 6557f051-61b1-43d0-93cd-c9ec582c0677
    python issue_api_key.py --household-id 6557f051-... --label "home-server"
    python issue_api_key.py --household-id 6557f051-... --dry-run

Required environment variables (same as the Cloud Function, see .env.example):
    GCP_PROJECT_ID
    FIRESTORE_DATABASE (optional, defaults to "(default)")

Requirements:
    pip install --user google-cloud-firestore
"""

import argparse
import hashlib
import logging
import os
import secrets
import sys
from datetime import datetime, timezone

from google.cloud import firestore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

COLLECTION_HOUSEHOLDS = "households"

# Matches ingest.py::API_KEY_ID_PREFIX — the lookup hint prefix of an ingest API key.
API_KEY_ID_PREFIX = "hpk_"

# Bytes of randomness for the key's secret portion (before URL-safe base64 encoding).
KEY_RANDOM_BYTES = 32


def _get_firestore_client() -> firestore.Client:
    """Builds a Firestore client from the same env vars used by the Cloud Function.

    Returns:
        An authenticated Firestore client for the configured GCP project.
    """
    project_id = os.environ["GCP_PROJECT_ID"]
    database = os.environ.get("FIRESTORE_DATABASE", "(default)")
    return firestore.Client(project=project_id, database=database)


def _generate_api_key(household_id: str) -> str:
    """Generates a new raw API key for a household.

    Args:
        household_id: ID of the household the key will authenticate as.

    Returns:
        A raw API key in the form "hpk_<household_id>_<random>".
    """
    random_part = secrets.token_urlsafe(KEY_RANDOM_BYTES)
    return f"{API_KEY_ID_PREFIX}{household_id}_{random_part}"


def _hash_api_key(api_key: str) -> str:
    """Hashes an API key with SHA-256, mirroring ingest.py's verification logic.

    Args:
        api_key: Raw API key.

    Returns:
        Hex-encoded SHA-256 digest of the key.
    """
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def issue_key(
    db: firestore.Client, household_id: str, label: str | None, dry_run: bool
) -> str:
    """Generates a new API key and appends its hash to the household's allowlist.

    Args:
        db: Authenticated Firestore client.
        household_id: ID of the household to issue the key for. Must already exist.
        label: Optional human-readable label stored alongside the hash, to help
            identify keys later during rotation/revocation.
        dry_run: If True, generates and prints the key without writing to Firestore.

    Returns:
        The raw API key. Not recoverable afterward — only its hash is persisted.

    Raises:
        ValueError: If no household document exists with the given ID.
    """
    household_ref = db.collection(COLLECTION_HOUSEHOLDS).document(household_id)
    if not household_ref.get().exists:
        raise ValueError(f"households/{household_id} does not exist")

    raw_key = _generate_api_key(household_id)
    key_entry = {
        "hash": _hash_api_key(raw_key),
        "label": label or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        logger.info("[dry-run] Would append to households/%s.api_keys: %s", household_id, key_entry)
        return raw_key

    household_ref.update({"api_keys": firestore.ArrayUnion([key_entry])})
    logger.info("Appended new API key hash to households/%s.api_keys", household_id)
    return raw_key


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """Parses command-line arguments for the key issuance script.

    Args:
        argv: Argument list (excluding the program name), typically sys.argv[1:].

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--household-id",
        required=True,
        help="ID of the household to issue the key for. Must already exist in Firestore.",
    )
    parser.add_argument(
        "--label",
        default=None,
        help="Optional label to identify this key later (e.g. 'home-server').",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate and print the key without writing its hash to Firestore.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """Entry point: parses arguments, issues the key, and prints it once.

    Args:
        argv: Argument list (excluding the program name), typically sys.argv[1:].

    Returns:
        Process exit code (0 on success, 1 if the household does not exist).
    """
    args = _parse_args(argv)
    db = _get_firestore_client()

    try:
        raw_key = issue_key(db, args.household_id, args.label, args.dry_run)
    except ValueError as error:
        logger.error(str(error))
        return 1

    print("\n=== New ingest API key (copy now — it cannot be recovered) ===")
    print(raw_key)
    print("Set it in the Rust client's Authorization header as: ApiKey <key above>\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
