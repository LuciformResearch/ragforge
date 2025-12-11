/**
 * Timestamp utilities (copied from LR_CodeRag shared helpers)
 * Provides consistent local-time timestamps for logging and filenames.
 */

export function getLocalTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  const offset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
  const offsetSign = offset >= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

export function getFilenameTimestamp(): string {
  return getLocalTimestamp().replace(/[:.]/g, '-');
}

/**
 * Format any Date object with local timezone offset
 * @param date Date to format (defaults to now)
 * @returns Timestamp string like "2025-11-10T19:18:59.832+01:00"
 */
export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  const offset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
  const offsetSign = offset >= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Normalize any timestamp value to ISO string with local timezone
 * Always returns a string, never Date objects
 * @param timestamp Date, string (ISO), or number (milliseconds since epoch)
 * @returns ISO string with local timezone like "2025-11-10T19:18:59.832+01:00"
 */
export function normalizeTimestamp(timestamp: Date | string | number): string {
  if (typeof timestamp === 'string') {
    // If already a string, assume it's ISO format - validate and return as-is
    // If it's not ISO, try to parse it
    if (timestamp.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return timestamp; // Already ISO format
    }
    // Try to parse as date string
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return formatLocalDate(date);
    }
    // If parsing fails, return as-is (might be invalid, but we don't want to crash)
    return timestamp;
  }
  
  if (timestamp instanceof Date) {
    return formatLocalDate(timestamp);
  }
  
  if (typeof timestamp === 'number') {
    return formatLocalDate(new Date(timestamp));
  }
  
  // Fallback: use current date
  return formatLocalDate();
}
