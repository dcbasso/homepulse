import { Timestamp } from '@angular/fire/firestore';

/** A single email recipient with a display name. */
export interface Recipient {
  email: string;
  name: string;
}

/** A single Telegram recipient identified by their bot token and chat ID. */
export interface TelegramRecipient {
  name: string;
  bot_token: string;
  chat_id: string;
}

/** Firestore document schema for `monitor_config/current`. */
export interface MonitorConfig {
  max_minutes_without_data: number;
  /** @deprecated Use alert_emails instead. Kept for lazy migration on load. */
  alert_email?: string;
  alert_emails: string[];
  recipient_names: Record<string, string>;
  email_subject_prefix: string;
  email_subject_down: string;
  email_subject_up: string;
  email_body_down: string;
  email_body_up: string;
  notify_on_down: boolean;
  notify_on_recovery: boolean;
  telegram_recipients: TelegramRecipient[];
  notify_telegram_on_down: boolean;
  notify_telegram_on_recovery: boolean;
  /** IANA timezone name (e.g. "America/Sao_Paulo") used to render alert timestamps. */
  timezone: string;
  /** strftime pattern used to render alert timestamps. */
  date_format: string;
  updated_at?: Timestamp;
}
