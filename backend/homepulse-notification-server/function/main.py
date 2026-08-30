"""Cloud Function — Internet Monitor.

Triggered by Cloud Scheduler every minute. Reads the latest heartbeat
document from Firestore, compares its timestamp against a configurable
threshold, and sends Gmail alerts on state transitions (up→down, down→up).
Incident records are persisted in Firestore.
"""

import base64
import email.mime.image
import email.mime.multipart
import email.mime.text
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import functions_framework
import requests
from google.cloud import firestore
from google.oauth2 import id_token as google_id_token
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from email_template import build_html_email

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

COLLECTION_HEARTBEAT = "heartbeats"
COLLECTION_STATE = "monitor_state"
COLLECTION_CONFIG = "monitor_config"
COLLECTION_INCIDENTS = "incidents"

# Number of consecutive checks that must see a stale heartbeat before an
# outage is confirmed and an alert is sent. Debounces single-sample false
# positives (e.g. a transient Firestore read anomaly) without meaningfully
# delaying detection of a real outage (adds at most one scheduler interval).
DOWN_CONFIRMATION_CHECKS = 2
STATE_DOC = "current"
CONFIG_DOC = "current"

DEFAULT_MAX_MINUTES = 5
DEFAULT_ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "")
DEFAULT_SUBJECT_DOWN = "[homepulse] Internet is down"
DEFAULT_SUBJECT_UP = "[homepulse] Internet is back"
DEFAULT_BODY_DOWN = (
    "No heartbeat received since ${DATETIME_DOWN}.\n\n"
    "Hi ${NAME}, you will receive another email once the internet comes back."
)
DEFAULT_BODY_UP = (
    "Hi ${NAME}, the internet is back!\n\n"
    "Down at: ${DATETIME_DOWN}\nRecovered at: ${DATETIME_UP}\nTotal downtime: ${TOTAL_TIME} min"
)

# Fallback timezone/format applied when `monitor_config/current` has no
# `timezone`/`date_format` field yet, or holds a value that fails to parse.
DEFAULT_TIMEZONE = "UTC"
DEFAULT_DATE_FORMAT = "%d/%m/%Y %H:%M:%S %Z"

TELEGRAM_API_BASE = "https://api.telegram.org"

# Telegram rejects sendPhoto calls whose `caption` exceeds this length.
TELEGRAM_CAPTION_MAX_LENGTH = 1024

# Logo bundled with the Cloud Function source (see terraform/function.tf,
# which zips this whole directory), used both as the Telegram photo and as
# the embedded header image in HTML emails.
LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "logo.png")

# Marker prepended to the subject/caption of a send_test_alert message so
# recipients can immediately tell it's a drill, not a real outage.
TEST_ALERT_PREFIX = "[TESTE] "

# Synthetic outage duration used to fill ${TOTAL_TIME} in a send_test_alert
# preview — there is no real incident behind a test send.
TEST_ALERT_DOWNTIME_MINUTES = 8

# CORS headers for send_test_alert, the only Cloud Function in this project
# called directly from the browser (the others are invoked by Cloud Scheduler
# or the Rust client, which aren't subject to CORS). Open to any origin since
# the endpoint is protected by its own Firebase ID token + email check below,
# not by origin — a page on another origin still can't forge a valid token.
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
}

_gmail_service = None


@dataclass
class MonitorConfig:
    """Monitoring configuration loaded from Firestore.

    Attributes:
        max_minutes: Minutes without heartbeat data before an outage is declared.
        recipients: List of dicts with 'email' and 'name' keys for alert recipients.
        subject_down: Email subject used when the internet goes down.
        subject_up: Email subject used when the internet recovers.
        body_down: Body template for the outage alert. Supports ${NAME} and ${DATETIME_DOWN}.
        body_up: Body template for the recovery alert. Supports ${NAME}, ${DATETIME_DOWN},
            ${DATETIME_UP}, and ${TOTAL_TIME}.
        notify_on_down: Whether to send email alerts when an outage is detected.
        notify_on_recovery: Whether to send email alerts when the internet recovers.
        telegram_recipients: List of dicts with 'name', 'bot_token', and 'chat_id' keys
            for Telegram alert recipients.
        notify_telegram_on_down: Whether to send Telegram alerts when an outage is detected.
        notify_telegram_on_recovery: Whether to send Telegram alerts when the internet recovers.
        timezone: IANA timezone name (e.g. "America/Sao_Paulo") used to render
            ${DATETIME_DOWN}/${DATETIME_UP} placeholders.
        date_format: strftime pattern used to render ${DATETIME_DOWN}/${DATETIME_UP}
            placeholders.
    """

    max_minutes: int
    recipients: list[dict]
    subject_down: str
    subject_up: str
    body_down: str
    body_up: str
    notify_on_down: bool
    notify_on_recovery: bool
    telegram_recipients: list[dict]
    notify_telegram_on_down: bool
    notify_telegram_on_recovery: bool
    timezone: str
    date_format: str


def _get_firestore_client() -> firestore.Client:
    """Returns a Firestore client using the default application credentials.

    Reads GCP_PROJECT_ID and FIRESTORE_DATABASE from environment variables.
    FIRESTORE_DATABASE defaults to "(default)" if not set.

    Returns:
        An authenticated Firestore client for the configured GCP project.
    """
    project_id = os.environ["GCP_PROJECT_ID"]
    database = os.environ.get("FIRESTORE_DATABASE", "(default)")
    return firestore.Client(project=project_id, database=database)


def _load_monitor_config(db: firestore.Client) -> MonitorConfig:
    """Reads monitoring configuration from Firestore, falling back to env var defaults.

    Applies lazy migration: if `alert_emails` is absent, falls back to the legacy
    `alert_email` field, then to the ALERT_EMAIL environment variable.

    Args:
        db: Authenticated Firestore client.

    Returns:
        A MonitorConfig populated from Firestore or defaults.
    """
    doc = db.collection(COLLECTION_CONFIG).document(CONFIG_DOC).get()
    if doc.exists:
        data = doc.to_dict()
        max_minutes = int(data.get("max_minutes_without_data", DEFAULT_MAX_MINUTES))

        alert_emails = data.get("alert_emails") or []
        if not alert_emails:
            legacy = data.get("alert_email", DEFAULT_ALERT_EMAIL)
            alert_emails = [legacy] if legacy else []

        recipient_names = data.get("recipient_names") or {}
        recipients = [
            {"email": e, "name": recipient_names.get(e, "")}
            for e in alert_emails
        ]
        if not recipients:
            recipients = [{"email": DEFAULT_ALERT_EMAIL, "name": ""}]

        telegram_recipients = [
            {
                "name": r.get("name", ""),
                "bot_token": r.get("bot_token", ""),
                "chat_id": r.get("chat_id", ""),
            }
            for r in (data.get("telegram_recipients") or [])
        ]

        return MonitorConfig(
            max_minutes=max_minutes,
            recipients=recipients,
            subject_down=data.get("email_subject_down") or DEFAULT_SUBJECT_DOWN,
            subject_up=data.get("email_subject_up") or DEFAULT_SUBJECT_UP,
            body_down=data.get("email_body_down") or DEFAULT_BODY_DOWN,
            body_up=data.get("email_body_up") or DEFAULT_BODY_UP,
            notify_on_down=bool(data.get("notify_on_down", True)),
            notify_on_recovery=bool(data.get("notify_on_recovery", True)),
            telegram_recipients=telegram_recipients,
            notify_telegram_on_down=bool(data.get("notify_telegram_on_down", True)),
            notify_telegram_on_recovery=bool(data.get("notify_telegram_on_recovery", True)),
            timezone=data.get("timezone") or DEFAULT_TIMEZONE,
            date_format=data.get("date_format") or DEFAULT_DATE_FORMAT,
        )

    logger.warning("monitor_config/current not found — using env var defaults")
    max_minutes = int(os.environ.get("MAX_MINUTES_WITHOUT_DATA", DEFAULT_MAX_MINUTES))
    return MonitorConfig(
        max_minutes=max_minutes,
        recipients=[{"email": DEFAULT_ALERT_EMAIL, "name": ""}],
        subject_down=DEFAULT_SUBJECT_DOWN,
        subject_up=DEFAULT_SUBJECT_UP,
        body_down=DEFAULT_BODY_DOWN,
        body_up=DEFAULT_BODY_UP,
        notify_on_down=True,
        notify_on_recovery=True,
        telegram_recipients=[],
        notify_telegram_on_down=True,
        notify_telegram_on_recovery=True,
        timezone=DEFAULT_TIMEZONE,
        date_format=DEFAULT_DATE_FORMAT,
    )


def _resolve_template(template: str, replacements: dict[str, str]) -> str:
    """Substitutes ${KEY} placeholders in a template string.

    Args:
        template: Template string containing ${KEY} placeholders.
        replacements: Map of placeholder key to its replacement value.

    Returns:
        The template with all known placeholders substituted.
    """
    result = template
    for key, value in replacements.items():
        result = result.replace(f"${{{key}}}", value)
    return result


def _format_datetime(dt: datetime, tz_name: str, date_format: str) -> str:
    """Converts a UTC datetime to the given timezone and renders it with a strftime pattern.

    Falls back to DEFAULT_TIMEZONE/DEFAULT_DATE_FORMAT if `tz_name` is not a
    recognized IANA timezone or `date_format` is not a valid strftime pattern,
    since both come from user-editable Firestore config and must not crash
    the alert pipeline.

    Args:
        dt: Timezone-aware UTC datetime to render.
        tz_name: IANA timezone name (e.g. "America/Sao_Paulo").
        date_format: strftime pattern.

    Returns:
        The formatted datetime string.
    """
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo(DEFAULT_TIMEZONE)
    try:
        return dt.astimezone(tz).strftime(date_format)
    except (ValueError, TypeError):
        return dt.astimezone(tz).strftime(DEFAULT_DATE_FORMAT)


def _get_latest_heartbeat_timestamp(db: firestore.Client) -> datetime | None:
    """Queries the most recent heartbeat document from Firestore.

    Args:
        db: Authenticated Firestore client.

    Returns:
        The UTC timestamp of the latest document, or None if the collection is empty.
    """
    docs = (
        db.collection(COLLECTION_HEARTBEAT)
        .order_by("timestamp", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict()
        ts = data.get("timestamp")
        if isinstance(ts, datetime):
            return ts.astimezone(timezone.utc)
        if isinstance(ts, str):
            return datetime.fromisoformat(ts).astimezone(timezone.utc)
    return None


def _read_monitor_state(db: firestore.Client) -> tuple[bool, int]:
    """Reads the current internet-down state from Firestore.

    Args:
        db: Authenticated Firestore client.

    Returns:
        A tuple of (internet_down, consecutive_down_checks). internet_down is
        True if the internet was previously flagged as down (and an alert
        already sent). consecutive_down_checks counts how many checks in a
        row have seen a stale heartbeat without yet reaching
        DOWN_CONFIRMATION_CHECKS (used to debounce single-sample anomalies).
    """
    doc = db.collection(COLLECTION_STATE).document(STATE_DOC).get()
    if doc.exists:
        data = doc.to_dict()
        return (
            bool(data.get("internet_down", False)),
            int(data.get("consecutive_down_checks", 0)),
        )
    return False, 0


def _write_monitor_state(db: firestore.Client, internet_down: bool, consecutive_down_checks: int = 0) -> None:
    """Persists a confirmed internet-down/up state transition to Firestore.

    Args:
        db: Authenticated Firestore client.
        internet_down: True if the internet is now considered down.
        consecutive_down_checks: Value to store for the running debounce counter
            (0 on recovery, since the counter restarts from scratch afterwards).
    """
    now = datetime.now(timezone.utc)
    field_name = "last_down_alert_at" if internet_down else "last_recovery_alert_at"
    db.collection(COLLECTION_STATE).document(STATE_DOC).set(
        {
            "internet_down": internet_down,
            "consecutive_down_checks": consecutive_down_checks,
            field_name: now,
        },
        merge=True,
    )


def _write_down_check_counter(db: firestore.Client, consecutive_down_checks: int) -> None:
    """Persists the running count of consecutive stale-heartbeat checks.

    Used while a potential outage has not yet been confirmed (has not reached
    DOWN_CONFIRMATION_CHECKS), so no alert-related fields are touched.

    Args:
        db: Authenticated Firestore client.
        consecutive_down_checks: The updated counter value.
    """
    db.collection(COLLECTION_STATE).document(STATE_DOC).set(
        {"consecutive_down_checks": consecutive_down_checks},
        merge=True,
    )


def _create_incident(db: firestore.Client) -> str:
    """Creates a new incident document marking the start of an outage.

    Args:
        db: Authenticated Firestore client.

    Returns:
        The auto-generated document ID of the created incident.
    """
    now = datetime.now(timezone.utc)
    _, ref = db.collection(COLLECTION_INCIDENTS).add(
        {"started_at": now, "recovered_at": None, "duration_minutes": None}
    )
    return ref.id


def _close_latest_incident(db: firestore.Client) -> tuple[datetime | None, int | None]:
    """Updates the most recent open incident with its recovery time and duration.

    Queries the most recent incident by started_at and closes it if still open.
    Avoids a composite index by filtering recovered_at in Python.

    Args:
        db: Authenticated Firestore client.

    Returns:
        A tuple of (started_at_utc, duration_minutes). Both are None if no open incident
        was found or the started_at field was missing.
    """
    docs = (
        db.collection(COLLECTION_INCIDENTS)
        .order_by("started_at", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    now = datetime.now(timezone.utc)
    for doc in docs:
        data = doc.to_dict()
        if data.get("recovered_at") is not None:
            logger.warning("Latest incident %s is already closed — skipping", doc.id)
            return None, None
        started_at = data.get("started_at")
        started_at_utc = None
        duration = None
        if isinstance(started_at, datetime):
            started_at_utc = started_at.astimezone(timezone.utc)
            duration = round((now - started_at_utc).total_seconds() / 60)
        doc.reference.update({"recovered_at": now, "duration_minutes": duration})
        logger.warning("Incident %s closed — duration: %s min", doc.id, duration)
        return started_at_utc, duration
    return None, None


def _build_gmail_service():
    """Builds an authenticated Gmail API service using OAuth2 secrets from env vars.

    Reads GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN from
    environment variables (injected from Secret Manager by Cloud Functions).

    Returns:
        An authorized Gmail API Resource object.
    """
    global _gmail_service
    if _gmail_service is not None:
        return _gmail_service

    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/gmail.send"],
    )
    creds.refresh(Request())
    _gmail_service = build("gmail", "v1", credentials=creds)
    return _gmail_service


def _send_email(to: str, subject: str, body: str) -> None:
    """Sends a branded HTML email via the Gmail API, with a plain-text fallback.

    The message is a multipart/related > multipart/alternative structure: a
    plain-text part identical to `body` (for clients that can't render HTML),
    an HTML part wrapping `body` in the HomePulse branded template, and the
    HomePulse logo attached inline and referenced via its Content-ID so it
    renders without depending on external image hosting.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        body: Plain-text email body.
    """
    global _gmail_service
    logo_cid = "homepulse-logo"

    alternative = email.mime.multipart.MIMEMultipart("alternative")
    alternative.attach(email.mime.text.MIMEText(body, "plain"))
    alternative.attach(email.mime.text.MIMEText(build_html_email(body, logo_cid), "html"))

    message = email.mime.multipart.MIMEMultipart("related")
    message["to"] = to
    message["subject"] = subject
    message.attach(alternative)

    with open(LOGO_PATH, "rb") as f:
        logo = email.mime.image.MIMEImage(f.read())
    logo.add_header("Content-ID", f"<{logo_cid}>")
    logo.add_header("Content-Disposition", "inline", filename="logo.png")
    message.attach(logo)

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    try:
        service = _build_gmail_service()
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
    except Exception:
        # Connection may be stale — discard cached service and retry once with a fresh one.
        _gmail_service = None
        service = _build_gmail_service()
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
    logger.info("Email sent to %s — subject: %s", to, subject)


def _send_down_alert(
    recipient: dict,
    last_timestamp: datetime,
    diff_minutes: float,
    subject: str,
    body_template: str,
    tz_name: str,
    date_format: str,
) -> None:
    """Sends an internet-down alert email to a single recipient.

    Resolves ${NAME} and ${DATETIME_DOWN} placeholders in the body template.

    Args:
        recipient: Dict with 'email' and 'name' keys.
        last_timestamp: UTC timestamp of the last received heartbeat record.
        diff_minutes: Minutes elapsed since the last record.
        subject: Email subject line.
        body_template: Body template string with optional placeholders.
        tz_name: IANA timezone name used to render the placeholders.
        date_format: strftime pattern used to render the placeholders.
    """
    body = _resolve_template(body_template, {
        "NAME": recipient["name"],
        "DATETIME_DOWN": _format_datetime(last_timestamp, tz_name, date_format),
    })
    _send_email(to=recipient["email"], subject=subject, body=body)


def _send_recovery_alert(
    recipient: dict,
    recovery_timestamp: datetime,
    started_at: datetime | None,
    duration_minutes: int | None,
    subject: str,
    body_template: str,
    tz_name: str,
    date_format: str,
) -> None:
    """Sends an internet-recovery alert email to a single recipient.

    Resolves ${NAME}, ${DATETIME_DOWN}, ${DATETIME_UP}, and ${TOTAL_TIME}
    placeholders in the body template.

    Args:
        recipient: Dict with 'email' and 'name' keys.
        recovery_timestamp: UTC timestamp when the internet was detected as recovered.
        started_at: UTC timestamp when the outage started, or None if unavailable.
        duration_minutes: Total outage duration in minutes, or None if unavailable.
        subject: Email subject line.
        body_template: Body template string with optional placeholders.
        tz_name: IANA timezone name used to render the placeholders.
        date_format: strftime pattern used to render the placeholders.
    """
    datetime_down = (
        _format_datetime(started_at, tz_name, date_format) if started_at else "unknown"
    )
    total_time = str(duration_minutes) if duration_minutes is not None else "unknown"
    body = _resolve_template(body_template, {
        "NAME": recipient["name"],
        "DATETIME_DOWN": datetime_down,
        "DATETIME_UP": _format_datetime(recovery_timestamp, tz_name, date_format),
        "TOTAL_TIME": total_time,
    })
    _send_email(to=recipient["email"], subject=subject, body=body)


def _send_telegram_message(bot_token: str, chat_id: str, caption: str) -> None:
    """Sends the HomePulse logo with a text caption via the Telegram Bot API.

    Uses sendPhoto instead of sendMessage so every alert carries the HomePulse
    logo. Telegram caps photo captions at TELEGRAM_CAPTION_MAX_LENGTH characters,
    so an overly long caption (e.g. from a user-customized template) is truncated
    rather than rejected by the API.

    Args:
        bot_token: Telegram bot token obtained from @BotFather.
        chat_id: Telegram chat ID (or @channelusername) to send the message to.
        caption: Text shown under the logo (Telegram's sendPhoto has no subject field).
    """
    if len(caption) > TELEGRAM_CAPTION_MAX_LENGTH:
        caption = caption[: TELEGRAM_CAPTION_MAX_LENGTH - 1] + "…"
    url = f"{TELEGRAM_API_BASE}/bot{bot_token}/sendPhoto"
    with open(LOGO_PATH, "rb") as f:
        response = requests.post(
            url,
            data={"chat_id": chat_id, "caption": caption},
            files={"photo": f},
            timeout=10,
        )
    response.raise_for_status()
    logger.info("Telegram photo sent to chat_id %s", chat_id)


def _send_telegram_down_alert(
    recipient: dict,
    last_timestamp: datetime,
    subject: str,
    body_template: str,
    tz_name: str,
    date_format: str,
) -> None:
    """Sends an internet-down alert via Telegram to a single recipient.

    Resolves ${NAME} and ${DATETIME_DOWN} placeholders in the body template, then
    combines subject and body into a single caption since Telegram's sendPhoto
    has no subject field.

    Args:
        recipient: Dict with 'name', 'bot_token', and 'chat_id' keys.
        last_timestamp: UTC timestamp of the last received heartbeat record.
        subject: Subject line (same value used for the email subject).
        body_template: Body template string with optional placeholders.
        tz_name: IANA timezone name used to render the placeholders.
        date_format: strftime pattern used to render the placeholders.
    """
    body = _resolve_template(body_template, {
        "NAME": recipient["name"],
        "DATETIME_DOWN": _format_datetime(last_timestamp, tz_name, date_format),
    })
    _send_telegram_message(recipient["bot_token"], recipient["chat_id"], f"{subject}\n\n{body}")


def _send_telegram_recovery_alert(
    recipient: dict,
    recovery_timestamp: datetime,
    started_at: datetime | None,
    duration_minutes: int | None,
    subject: str,
    body_template: str,
    tz_name: str,
    date_format: str,
) -> None:
    """Sends an internet-recovery alert via Telegram to a single recipient.

    Resolves ${NAME}, ${DATETIME_DOWN}, ${DATETIME_UP}, and ${TOTAL_TIME} placeholders
    in the body template, then combines subject and body into a single caption since
    Telegram's sendPhoto has no subject field.

    Args:
        recipient: Dict with 'name', 'bot_token', and 'chat_id' keys.
        recovery_timestamp: UTC timestamp when the internet was detected as recovered.
        started_at: UTC timestamp when the outage started, or None if unavailable.
        duration_minutes: Total outage duration in minutes, or None if unavailable.
        subject: Subject line (same value used for the email subject).
        body_template: Body template string with optional placeholders.
        tz_name: IANA timezone name used to render the placeholders.
        date_format: strftime pattern used to render the placeholders.
    """
    datetime_down = (
        _format_datetime(started_at, tz_name, date_format) if started_at else "unknown"
    )
    total_time = str(duration_minutes) if duration_minutes is not None else "unknown"
    body = _resolve_template(body_template, {
        "NAME": recipient["name"],
        "DATETIME_DOWN": datetime_down,
        "DATETIME_UP": _format_datetime(recovery_timestamp, tz_name, date_format),
        "TOTAL_TIME": total_time,
    })
    _send_telegram_message(recipient["bot_token"], recipient["chat_id"], f"{subject}\n\n{body}")


@functions_framework.http
def check_internet_status(request) -> tuple[str, int]:
    """Check whether recent heartbeat data exists and send alerts if needed.

    Reads the latest document from Firestore, compares its timestamp against
    the configured threshold, and sends Gmail and/or Telegram alerts on state
    transitions (down→up or up→down). Incident documents are created and closed
    accordingly. Alerts are sent to all configured recipients on each enabled
    channel, with per-recipient name substitution.

    Args:
        request: HTTP request object provided by Cloud Functions runtime.

    Returns:
        A tuple of (response_body, http_status_code).
    """
    try:
        db = _get_firestore_client()
        config = _load_monitor_config(db)

        last_timestamp = _get_latest_heartbeat_timestamp(db)
        if last_timestamp is None:
            logger.warning("No heartbeat documents found in Firestore — skipping check")
            return "No data available", 200

        now = datetime.now(timezone.utc)
        diff_minutes = (now - last_timestamp).total_seconds() / 60

        logger.info(
            "Last record: %s — %.1f min ago (threshold: %d min)",
            _format_datetime(last_timestamp, config.timezone, config.date_format),
            diff_minutes,
            config.max_minutes,
        )

        internet_was_down, consecutive_down_checks = _read_monitor_state(db)

        if diff_minutes > config.max_minutes:
            if internet_was_down:
                logger.info("Internet still DOWN — no duplicate alert sent")
            else:
                consecutive_down_checks += 1
                if consecutive_down_checks >= DOWN_CONFIRMATION_CHECKS:
                    logger.info("Internet appears DOWN — creating incident and sending alerts")
                    _create_incident(db)
                    _write_monitor_state(db, internet_down=True, consecutive_down_checks=consecutive_down_checks)
                    if config.notify_on_down:
                        try:
                            for recipient in config.recipients:
                                _send_down_alert(
                                    recipient=recipient,
                                    last_timestamp=last_timestamp,
                                    diff_minutes=diff_minutes,
                                    subject=config.subject_down,
                                    body_template=config.body_down,
                                    tz_name=config.timezone,
                                    date_format=config.date_format,
                                )
                        except Exception as e:
                            logger.error("Email down-alert failed: %s", e)
                    if config.notify_telegram_on_down:
                        try:
                            for recipient in config.telegram_recipients:
                                _send_telegram_down_alert(
                                    recipient=recipient,
                                    last_timestamp=last_timestamp,
                                    subject=config.subject_down,
                                    body_template=config.body_down,
                                    tz_name=config.timezone,
                                    date_format=config.date_format,
                                )
                        except Exception as e:
                            logger.error("Telegram down-alert failed: %s", e)
                else:
                    logger.info(
                        "Possible outage detected (%d/%d consecutive checks) — awaiting confirmation before alerting",
                        consecutive_down_checks,
                        DOWN_CONFIRMATION_CHECKS,
                    )
                    _write_down_check_counter(db, consecutive_down_checks)
        else:
            if internet_was_down:
                logger.info("Internet is BACK — closing incident and sending recovery alerts")
                started_at, duration_minutes = _close_latest_incident(db)
                _write_monitor_state(db, internet_down=False, consecutive_down_checks=0)
                if config.notify_on_recovery:
                    try:
                        for recipient in config.recipients:
                            _send_recovery_alert(
                                recipient=recipient,
                                recovery_timestamp=last_timestamp,
                                started_at=started_at,
                                duration_minutes=duration_minutes,
                                subject=config.subject_up,
                                body_template=config.body_up,
                                tz_name=config.timezone,
                                date_format=config.date_format,
                            )
                    except Exception as e:
                        logger.error("Email recovery-alert failed: %s", e)
                if config.notify_telegram_on_recovery:
                    try:
                        for recipient in config.telegram_recipients:
                            _send_telegram_recovery_alert(
                                recipient=recipient,
                                recovery_timestamp=last_timestamp,
                                started_at=started_at,
                                duration_minutes=duration_minutes,
                                subject=config.subject_up,
                                body_template=config.body_up,
                                tz_name=config.timezone,
                                date_format=config.date_format,
                            )
                    except Exception as e:
                        logger.error("Telegram recovery-alert failed: %s", e)
            else:
                if consecutive_down_checks:
                    _write_down_check_counter(db, 0)
                logger.info("Internet is UP — nothing to do")

        return "OK", 200

    except Exception as exc:
        logger.exception("Unexpected error during internet status check: %s", exc)
        return f"Internal error: {exc}", 500


def _resolve_caller_ip(request) -> str:
    """Resolves the real caller IP address from an incoming HTTP request.

    Cloud Functions Gen2 runs on Cloud Run behind the Google Front End, so
    `request.remote_addr` reflects the GFE's internal address rather than the
    original client. The actual caller IP is the first entry in the
    comma-separated `X-Forwarded-For` header. Falls back to
    `request.remote_addr` if the header is absent.

    Args:
        request: HTTP request object provided by Cloud Functions runtime.

    Returns:
        The resolved caller IP address, or an empty string if unavailable.
    """
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or ""


@functions_framework.http
def whoami(request) -> tuple[dict, int]:
    """Reports the caller's public IP address.

    Public, unauthenticated endpoint intended for the Rust client's heartbeat
    check — it lets the client discover the WAN IP it is currently reaching
    GCP from. Returns no sensitive data.

    Args:
        request: HTTP request object provided by Cloud Functions runtime.

    Returns:
        A tuple of (response_body, http_status_code), where response_body is
        a JSON-serializable dict of the form {"ip": "<caller's IP>"}.
    """
    ip = _resolve_caller_ip(request)
    return {"ip": ip}, 200


def _verify_caller(request) -> str | None:
    """Verifies the Firebase ID token in the request's Authorization header.

    Checks that the token is a valid, unexpired Firebase Auth token issued for
    this project (GCP_PROJECT_ID) and belongs to the account allowed to manage
    alerts (ALERT_EMAIL) — the same single-account restriction the frontend
    already enforces at login, re-checked here because a client-side check
    alone wouldn't stop someone from calling this endpoint directly with a
    token for a different Google account.

    Args:
        request: HTTP request object provided by Cloud Functions runtime.

    Returns:
        The verified caller's email if the token is valid and authorized, else None.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer "):]
    try:
        claims = google_id_token.verify_firebase_token(
            token, Request(), audience=os.environ["GCP_PROJECT_ID"]
        )
    except ValueError:
        return None
    if claims is None or not claims.get("email_verified"):
        return None
    email = claims.get("email")
    if not email or email != os.environ.get("ALERT_EMAIL"):
        return None
    return email


@functions_framework.http
def send_test_alert(request) -> tuple:
    """Sends a one-off test alert (email or Telegram) using draft settings values.

    Lets the Settings screen preview a channel's current subject/body template,
    timezone, and date format before saving — filled with synthetic sample data
    instead of pulling a real incident from Firestore. Requires a valid Firebase
    ID token (Authorization: Bearer <token>) for the ALERT_EMAIL account; see
    _verify_caller.

    Args:
        request: HTTP request. JSON body:
            channel: "email" or "telegram".
            subject: Subject line (email) — prefixed with TEST_ALERT_PREFIX.
            body_template: Body template with ${NAME}/${DATETIME_DOWN}/
                ${DATETIME_UP}/${TOTAL_TIME} placeholders.
            timezone: IANA timezone name used to render the placeholders.
            date_format: strftime pattern used to render the placeholders.
            recipients: List of Recipient dicts (email channel) or
                TelegramRecipient dicts (telegram channel).

    Returns:
        A tuple of (response_body, http_status_code, headers).
    """
    if request.method == "OPTIONS":
        return "", 204, _CORS_HEADERS

    caller_email = _verify_caller(request)
    if caller_email is None:
        return {"error": "Unauthorized"}, 401, _CORS_HEADERS

    payload = request.get_json(silent=True) or {}
    channel = payload.get("channel")
    subject = str(payload.get("subject", ""))
    body_template = str(payload.get("body_template", ""))
    tz_name = str(payload.get("timezone") or DEFAULT_TIMEZONE)
    date_format = str(payload.get("date_format") or DEFAULT_DATE_FORMAT)
    recipients = payload.get("recipients") or []

    if channel not in ("email", "telegram") or not recipients:
        return {"error": "Invalid request"}, 400, _CORS_HEADERS

    now = datetime.now(timezone.utc)
    started_at = now - timedelta(minutes=TEST_ALERT_DOWNTIME_MINUTES)
    test_subject = f"{TEST_ALERT_PREFIX}{subject}"

    sent = 0
    try:
        for recipient in recipients:
            body = _resolve_template(body_template, {
                "NAME": recipient.get("name", ""),
                "DATETIME_DOWN": _format_datetime(started_at, tz_name, date_format),
                "DATETIME_UP": _format_datetime(now, tz_name, date_format),
                "TOTAL_TIME": str(TEST_ALERT_DOWNTIME_MINUTES),
            })
            if channel == "email":
                _send_email(to=recipient["email"], subject=test_subject, body=body)
            else:
                _send_telegram_message(
                    recipient["bot_token"], recipient["chat_id"], f"{test_subject}\n\n{body}"
                )
            sent += 1
    except Exception as e:
        logger.error("Test %s alert failed: %s", channel, e)
        return {"error": str(e)}, 502, _CORS_HEADERS

    logger.info("Test %s alert sent by %s to %d recipient(s)", channel, caller_email, sent)
    return {"ok": True, "sent": sent}, 200, _CORS_HEADERS
