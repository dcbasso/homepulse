"""Shared logic for issuing per-household ingest API keys (ADR 0004/0010).

Used both by the `scripts/issue_api_key.py` CLI script and the
`issue_api_key` Cloud Function (see main.py) — the generation/hash/storage
logic must stay identical between the two so keys issued either way are
indistinguishable to ingest.py's verification.
"""

import hashlib
import secrets
from datetime import datetime, timezone

from google.cloud import firestore

COLLECTION_HOUSEHOLDS = "households"

# Matches ingest.py::API_KEY_ID_PREFIX — the lookup hint prefix of an ingest API key.
API_KEY_ID_PREFIX = "hpk_"

# Bytes of randomness for the key's secret portion (before URL-safe base64 encoding).
KEY_RANDOM_BYTES = 32


def generate_api_key(household_id: str) -> str:
    """Generates a new raw API key for a household.

    Args:
        household_id: ID of the household the key will authenticate as.

    Returns:
        A raw API key in the form "hpk_<household_id>_<random>".
    """
    random_part = secrets.token_urlsafe(KEY_RANDOM_BYTES)
    return f"{API_KEY_ID_PREFIX}{household_id}_{random_part}"


def hash_api_key(api_key: str) -> str:
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
        dry_run: If True, generates and returns the key without writing to Firestore.

    Returns:
        The raw API key. Not recoverable afterward — only its hash is persisted.

    Raises:
        ValueError: If no household document exists with the given ID.
    """
    household_ref = db.collection(COLLECTION_HOUSEHOLDS).document(household_id)
    if not household_ref.get().exists:
        raise ValueError(f"households/{household_id} does not exist")

    raw_key = generate_api_key(household_id)
    key_entry = {
        "hash": hash_api_key(raw_key),
        "label": label or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        return raw_key

    household_ref.update({"api_keys": firestore.ArrayUnion([key_entry])})
    return raw_key
