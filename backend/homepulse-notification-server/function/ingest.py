"""Cloud Function — Ingest API.

Implements Fase 2 of docs/adr/ROADMAP.md (ADR 0004, 0010). Receives
heartbeat and speedtest measurements from the Rust client over HTTP,
authenticated by a per-household API key, and writes them into
`households/{household_id}/...` subcollections.

The client is never trusted with GCP credentials: it authenticates with a
long-lived API key (format `hpk_<household_id>_<random>`), and this function
resolves the household from the key's SHA-256 hash against that household's
`api_keys[]` allowlist — never from the (spoofable) id embedded in the key
itself. See ADR 0004 and ADR 0010 for the full rationale.
"""

import hashlib
import logging
import os
import sys
from datetime import datetime, timezone

import functions_framework
from google.cloud import firestore

# The Cloud Run Python runtime pre-configures the root logger with its own
# handler, making `logging.basicConfig()` a no-op (it only takes effect when
# the root logger has no handlers yet). Attaching an explicit handler here
# guarantees INFO-level logs are emitted regardless of that pre-existing setup.
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.propagate = False
_handler = logging.StreamHandler(sys.stdout)
_handler.setLevel(logging.INFO)
logger.addHandler(_handler)

COLLECTION_HOUSEHOLDS = "households"
COLLECTION_HEARTBEATS = "heartbeats"
COLLECTION_SPEEDTEST_RESULTS = "speedtest_results"

HOUSEHOLD_STATUS_ACTIVE = "active"

# Header carrying the API key, e.g. "Authorization: ApiKey hpk_<id>_<random>".
API_KEY_HEADER = "Authorization"
API_KEY_HEADER_PREFIX = "ApiKey "

# Per ADR 0010, keys look like "hpk_<household_id>_<random>". This prefix is
# only a lookup hint for finding the household doc — actual authentication
# is the SHA-256 hash check against that household's api_keys[] allowlist.
API_KEY_ID_PREFIX = "hpk_"

# Placeholder stored when the client could not resolve its own external IP.
UNKNOWN_IP = "unknown"

# Fields required in a POST /speedtest body, and which of those are numeric
# (validated as int/float rather than accepted as arbitrary JSON values).
SPEEDTEST_STRING_FIELDS = ("server", "isp", "external_ip_v4", "external_ip_v6", "result_url")
SPEEDTEST_NUMERIC_FIELDS = ("download_mbps", "upload_mbps", "ping_ms", "jitter_ms", "packet_loss_pct")


def _get_firestore_client() -> firestore.Client:
    """Builds a Firestore client from the same env vars used by the Cloud Function.

    Returns:
        An authenticated Firestore client for the configured GCP project.
    """
    project_id = os.environ["GCP_PROJECT_ID"]
    database = os.environ.get("FIRESTORE_DATABASE", "(default)")
    return firestore.Client(project=project_id, database=database)


def _hash_api_key(api_key: str) -> str:
    """Hashes an API key with SHA-256 for comparison against the stored allowlist.

    Args:
        api_key: Raw API key as sent by the client.

    Returns:
        Hex-encoded SHA-256 digest of the key.
    """
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _extract_api_key(request) -> str | None:
    """Extracts the raw API key from the request's Authorization header.

    Args:
        request: HTTP request object provided by the Cloud Functions runtime.

    Returns:
        The raw API key, or None if the header is missing or malformed.
    """
    header_value = request.headers.get(API_KEY_HEADER, "")
    if not header_value.startswith(API_KEY_HEADER_PREFIX):
        return None
    api_key = header_value[len(API_KEY_HEADER_PREFIX):].strip()
    return api_key or None


def _resolve_household_id(db: firestore.Client, api_key: str) -> str | None:
    """Resolves the household that owns an API key, verifying it against its allowlist.

    The household_id embedded in the key is used only to look up which
    household document to check — the caller is authenticated exclusively by
    the key's hash being present in that household's `api_keys[]` list, so a
    tampered id prefix cannot grant access to another household's data.

    Args:
        db: Authenticated Firestore client.
        api_key: Raw API key extracted from the Authorization header.

    Returns:
        The household_id if the key is valid and active, else None.
    """
    if not api_key.startswith(API_KEY_ID_PREFIX):
        return None
    remainder = api_key[len(API_KEY_ID_PREFIX):]
    household_id, _, _ = remainder.partition("_")
    if not household_id:
        return None

    household_doc = db.collection(COLLECTION_HOUSEHOLDS).document(household_id).get()
    if not household_doc.exists:
        return None

    household_data = household_doc.to_dict() or {}
    if household_data.get("status") != HOUSEHOLD_STATUS_ACTIVE:
        return None

    key_hash = _hash_api_key(api_key)
    active_hashes = {entry.get("hash") for entry in household_data.get("api_keys", [])}
    if key_hash not in active_hashes:
        return None

    return household_id


def _authenticate(request, db: firestore.Client) -> tuple[str | None, tuple[dict, int] | None]:
    """Authenticates an ingest request by API key.

    Args:
        request: HTTP request object provided by the Cloud Functions runtime.
        db: Authenticated Firestore client.

    Returns:
        A (household_id, None) tuple on success, or (None, (body, status))
        with the error response to return on failure.
    """
    api_key = _extract_api_key(request)
    if api_key is None:
        return None, ({"error": "Missing or malformed Authorization header"}, 401)

    household_id = _resolve_household_id(db, api_key)
    if household_id is None:
        return None, ({"error": "Invalid or revoked API key"}, 401)

    return household_id, None


@functions_framework.http
def ingest_heartbeat(request) -> tuple[dict, int]:
    """Receives a liveness heartbeat from the Rust client and stores it.

    Expects a JSON body with optional `external_ip_v4` / `external_ip_v6`
    string fields (defaulting to "unknown" when absent, mirroring the
    previous direct-Firestore client behavior). The document is written to
    `households/{household_id}/heartbeats/{auto_id}` with a server-assigned
    timestamp.

    Args:
        request: HTTP request object provided by the Cloud Functions runtime.

    Returns:
        A tuple of (response_body, http_status_code).
    """
    if request.method != "POST":
        return {"error": "Method not allowed"}, 405

    db = _get_firestore_client()
    household_id, auth_error = _authenticate(request, db)
    if auth_error is not None:
        return auth_error

    payload = request.get_json(silent=True) or {}
    document = {
        "timestamp": datetime.now(timezone.utc),
        "external_ip_v4": payload.get("external_ip_v4", UNKNOWN_IP),
        "external_ip_v6": payload.get("external_ip_v6", UNKNOWN_IP),
    }

    db.collection(COLLECTION_HOUSEHOLDS).document(household_id).collection(
        COLLECTION_HEARTBEATS
    ).document().set(document)

    logger.info("Heartbeat ingested for household %s", household_id)
    return {"status": "ok"}, 201


@functions_framework.http
def ingest_speedtest(request) -> tuple[dict, int]:
    """Receives a speedtest measurement from the Rust client and stores it.

    Expects a JSON body with all of `download_mbps`, `upload_mbps`,
    `ping_ms`, `jitter_ms`, `packet_loss_pct` (numeric), and `server`,
    `isp`, `external_ip_v4`, `external_ip_v6`, `result_url` (string). The
    document is written to `households/{household_id}/speedtest_results/{auto_id}`
    with a server-assigned timestamp.

    Args:
        request: HTTP request object provided by the Cloud Functions runtime.

    Returns:
        A tuple of (response_body, http_status_code).
    """
    if request.method != "POST":
        return {"error": "Method not allowed"}, 405

    db = _get_firestore_client()
    household_id, auth_error = _authenticate(request, db)
    if auth_error is not None:
        return auth_error

    payload = request.get_json(silent=True) or {}

    missing_fields = [
        field
        for field in SPEEDTEST_STRING_FIELDS + SPEEDTEST_NUMERIC_FIELDS
        if field not in payload
    ]
    if missing_fields:
        return {"error": f"Missing required fields: {', '.join(missing_fields)}"}, 400

    invalid_fields = [
        field
        for field in SPEEDTEST_NUMERIC_FIELDS
        if not isinstance(payload[field], (int, float)) or isinstance(payload[field], bool)
    ]
    if invalid_fields:
        return {"error": f"Fields must be numeric: {', '.join(invalid_fields)}"}, 400

    document = {
        "timestamp": datetime.now(timezone.utc),
        **{field: payload[field] for field in SPEEDTEST_NUMERIC_FIELDS},
        **{field: payload[field] for field in SPEEDTEST_STRING_FIELDS},
    }

    db.collection(COLLECTION_HOUSEHOLDS).document(household_id).collection(
        COLLECTION_SPEEDTEST_RESULTS
    ).document().set(document)

    logger.info("Speedtest result ingested for household %s", household_id)
    return {"status": "ok"}, 201
