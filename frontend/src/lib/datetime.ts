const TZ_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const TIME_RE = /(?:T|\s)\d{2}:\d{2}/;

/**
 * Backend datetimes are stored as UTC, but SQLite can round-trip them without
 * a timezone suffix. Treat suffix-less datetime strings as UTC instants before
 * rendering them in the user's local timezone.
 */
export function parseBackendDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized =
    TIME_RE.test(raw) && !TZ_SUFFIX_RE.test(raw) ? `${raw.replace(/\s+/, "T")}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  const date = coerceDate(value);
  if (!date) return typeof value === "string" && value.trim() ? value : fallback;
  return `${formatLocalDate(date)} ${formatLocalTime(date)}`;
}

export function formatLocalMonthDayTime(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  const date = coerceDate(value);
  if (!date) return typeof value === "string" && value.trim() ? value : fallback;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatLocalTime(date)}`;
}

export function formatLocalDateValue(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  const date = coerceDate(value);
  if (!date) return typeof value === "string" && value.trim() ? value : fallback;
  return formatLocalDate(date);
}

export function formatLocalDateStamp(date: Date): string {
  return formatLocalDate(date);
}

function coerceDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return parseBackendDateTime(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}
