"""Issues a new ingest API key for a household.

Implements the key-issuance side of ADR 0004/0010: generates a key in the
form `hpk_<household_id>_<random>`, stores only its SHA-256 hash in
`households/{household_id}.api_keys[]` (appended, never replacing existing
keys, so rotation can happen without downtime), and prints the raw key once.
The raw key is never written anywhere — copy it immediately, it cannot be
recovered afterward.

Generation/hash/storage logic lives in `function/api_keys.py`, shared with
the `issue_api_key` Cloud Function so keys issued via either path are
identical in shape.

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
import logging
import os
import sys

from google.cloud import firestore

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "function"))
from api_keys import issue_key  # noqa: E402 -- must follow the sys.path patch above

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _get_firestore_client() -> firestore.Client:
    """Builds a Firestore client from the same env vars used by the Cloud Function.

    Returns:
        An authenticated Firestore client for the configured GCP project.
    """
    project_id = os.environ["GCP_PROJECT_ID"]
    database = os.environ.get("FIRESTORE_DATABASE", "(default)")
    return firestore.Client(project=project_id, database=database)


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

    if args.dry_run:
        logger.info("[dry-run] Would append a new API key hash to households/%s.api_keys", args.household_id)
    else:
        logger.info("Appended new API key hash to households/%s.api_keys", args.household_id)

    print("\n=== New ingest API key (copy now — it cannot be recovered) ===")
    print(raw_key)
    print("Set it in the Rust client's Authorization header as: ApiKey <key above>\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
