"""Tests for ingest.py's API key authentication (Fase 8 / ADR 0010).

Covers `_authenticate` and its helpers using a fake Firestore client (no
emulator or live project needed) — these are pure allowlist-lookup functions
that only need a `.get()`-able document, not real Firestore behavior.

The rotation-specific tests (`test_rotation_*`) are the core of Fase 8's
"validar fluxo de rotação de API key sem downtime do client" requirement:
they prove that a household's `api_keys[]` list supports two simultaneously
active keys (the overlap window ADR 0010 relies on) and that revoking one
key does not affect the other.
"""

import hashlib

import pytest

import ingest


class FakeSnapshot:
    """Stand-in for a `firestore.DocumentSnapshot`."""

    def __init__(self, data: dict | None):
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict | None:
        return self._data


class FakeDocumentRef:
    """Stand-in for a `firestore.DocumentReference` with a fixed snapshot."""

    def __init__(self, data: dict | None):
        self._snapshot = FakeSnapshot(data)

    def get(self) -> FakeSnapshot:
        return self._snapshot


class FakeCollection:
    """Stand-in for a `firestore.CollectionReference` backed by a dict of documents."""

    def __init__(self, documents: dict[str, dict]):
        self._documents = documents

    def document(self, document_id: str) -> FakeDocumentRef:
        return FakeDocumentRef(self._documents.get(document_id))


class FakeFirestoreClient:
    """Stand-in for `firestore.Client`, exposing only the `households` collection."""

    def __init__(self, households: dict[str, dict]):
        self._households = FakeCollection(households)

    def collection(self, name: str) -> FakeCollection:
        assert name == ingest.COLLECTION_HOUSEHOLDS
        return self._households


class FakeRequest:
    """Stand-in for the Flask-like request object passed by functions_framework."""

    def __init__(self, headers: dict[str, str]):
        self.headers = headers


def _api_key(household_id: str, secret: str) -> str:
    return f"hpk_{household_id}_{secret}"


def _hash(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def test_hash_api_key_is_deterministic_sha256():
    key = "hpk_house-1_abc123"
    assert ingest._hash_api_key(key) == hashlib.sha256(key.encode("utf-8")).hexdigest()
    assert ingest._hash_api_key(key) == ingest._hash_api_key(key)


@pytest.mark.parametrize(
    "headers,expected",
    [
        ({}, None),
        ({"Authorization": "Bearer sometoken"}, None),
        ({"Authorization": "ApiKey "}, None),
        ({"Authorization": "ApiKey hpk_house-1_abc123"}, "hpk_house-1_abc123"),
    ],
)
def test_extract_api_key(headers, expected):
    assert ingest._extract_api_key(FakeRequest(headers)) == expected


def test_resolve_household_id_rejects_key_without_prefix():
    db = FakeFirestoreClient({})
    assert ingest._resolve_household_id(db, "not-a-valid-key") is None


def test_resolve_household_id_rejects_unknown_household():
    db = FakeFirestoreClient({})
    key = _api_key("ghost-house", "secret")
    assert ingest._resolve_household_id(db, key) is None


def test_resolve_household_id_rejects_inactive_household():
    key = _api_key("house-1", "secret")
    db = FakeFirestoreClient(
        {"house-1": {"status": "suspended", "api_keys": [{"hash": _hash(key)}]}}
    )
    assert ingest._resolve_household_id(db, key) is None


def test_resolve_household_id_rejects_hash_not_in_allowlist():
    key = _api_key("house-1", "secret")
    other_key = _api_key("house-1", "different-secret")
    db = FakeFirestoreClient(
        {"house-1": {"status": "active", "api_keys": [{"hash": _hash(other_key)}]}}
    )
    assert ingest._resolve_household_id(db, key) is None


def test_resolve_household_id_accepts_valid_key():
    key = _api_key("house-1", "secret")
    db = FakeFirestoreClient(
        {"house-1": {"status": "active", "api_keys": [{"hash": _hash(key)}]}}
    )
    assert ingest._resolve_household_id(db, key) == "house-1"


def test_resolve_household_id_ignores_tampered_household_id_prefix():
    """A key claiming to belong to house-1 must not authenticate against house-2's allowlist."""
    key = _api_key("house-2", "secret-that-belongs-to-house-1")
    db = FakeFirestoreClient(
        {
            "house-1": {"status": "active", "api_keys": [{"hash": _hash(key)}]},
            "house-2": {"status": "active", "api_keys": [{"hash": _hash("hpk_house-2_real-secret")}]},
        }
    )
    assert ingest._resolve_household_id(db, key) is None


def test_rotation_old_and_new_keys_both_work_during_overlap_window():
    """Per ADR 0010: a new key is added before the old one is removed, so both
    must authenticate successfully during the overlap window — this is what
    lets the household's client machine be updated without any downtime."""
    old_key = _api_key("house-1", "old-secret")
    new_key = _api_key("house-1", "new-secret")
    db = FakeFirestoreClient(
        {
            "house-1": {
                "status": "active",
                "api_keys": [{"hash": _hash(old_key)}, {"hash": _hash(new_key)}],
            }
        }
    )

    assert ingest._resolve_household_id(db, old_key) == "house-1"
    assert ingest._resolve_household_id(db, new_key) == "house-1"


def test_rotation_revoking_old_key_does_not_affect_new_key():
    """After the overlap window, removing the old key's hash must revoke only
    that key — the new key (and any other households) must be unaffected."""
    old_key = _api_key("house-1", "old-secret")
    new_key = _api_key("house-1", "new-secret")
    db = FakeFirestoreClient(
        {"house-1": {"status": "active", "api_keys": [{"hash": _hash(new_key)}]}}
    )

    assert ingest._resolve_household_id(db, old_key) is None
    assert ingest._resolve_household_id(db, new_key) == "house-1"


def test_rotation_revoking_one_household_key_does_not_affect_other_households():
    key_house_1 = _api_key("house-1", "secret")
    key_house_2 = _api_key("house-2", "secret")
    db = FakeFirestoreClient(
        {
            "house-1": {"status": "active", "api_keys": []},
            "house-2": {"status": "active", "api_keys": [{"hash": _hash(key_house_2)}]},
        }
    )

    assert ingest._resolve_household_id(db, key_house_1) is None
    assert ingest._resolve_household_id(db, key_house_2) == "house-2"


def test_authenticate_missing_header_returns_401():
    db = FakeFirestoreClient({})
    household_id, error = ingest._authenticate(FakeRequest({}), db)
    assert household_id is None
    assert error == ({"error": "Missing or malformed Authorization header"}, 401)


def test_authenticate_invalid_key_returns_401():
    db = FakeFirestoreClient({})
    request = FakeRequest({"Authorization": "ApiKey hpk_house-1_wrong-secret"})
    household_id, error = ingest._authenticate(request, db)
    assert household_id is None
    assert error == ({"error": "Invalid or revoked API key"}, 401)


def test_authenticate_valid_key_returns_household_id_and_no_error():
    key = _api_key("house-1", "secret")
    db = FakeFirestoreClient(
        {"house-1": {"status": "active", "api_keys": [{"hash": _hash(key)}]}}
    )
    request = FakeRequest({"Authorization": f"ApiKey {key}"})
    household_id, error = ingest._authenticate(request, db)
    assert household_id == "house-1"
    assert error is None
