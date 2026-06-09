/**
 * Timeline Service
 * Converts agent actions into formatted timeline items for display.
 */

import type { Action } from './receptionist-summary';

export interface TimelineItem {
  icon: string;      // Emoji: 📞, 💬, 📸, ✓, ❌
  time: string;      // "5 min ago"
  description: string; // "Sent message to María"
  detail?: string;
}

/**
 * Formats relative time from a timestamp to "X min/hour/day ago" format.
 * @example
 * formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000)) // "5 min ago"
 */
function formatRelativeTime(timestamp: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // For older items, show date format
  return timestamp.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Maps action types to their display emojis.
 */
function getIconForAction(actionType: Action['type']): string {
  const iconMap: Record<Action['type'], string> = {
    message_sent: '💬',
    photo_requested: '📸',
    job_ready: '✓',
    job_closed: '✓',
    note_added: '📝',
  };
  return iconMap[actionType] || '📌';
}

/**
 * Creates a human-readable description for an action.
 */
function getDescriptionForAction(
  actionType: Action['type'],
  target?: string,
  count?: number,
): string {
  const countStr = count && count > 1 ? ` (${count})` : '';

  switch (actionType) {
    case 'message_sent':
      return target
        ? `Sent message to ${target}${countStr}`
        : `Sent message${countStr}`;
    case 'photo_requested':
      return count && count > 1
        ? `Requested photos (${count})`
        : 'Requested photo';
    case 'job_ready':
      return count && count > 1
        ? `Marked ${count} jobs ready for review`
        : 'Marked job ready for review';
    case 'job_closed':
      return count && count > 1
        ? `Closed ${count} completed jobs`
        : 'Closed completed job';
    case 'note_added':
      return 'Added note';
    default:
      return 'Action performed';
  }
}

/**
 * Converts an array of actions into timeline items for display.
 * Sorts by timestamp (newest first) and formats each action.
 *
 * @example
 * formatTimelineItems([
 *   { type: 'message_sent', target: 'María', timestamp: new Date() },
 *   { type: 'photo_requested', timestamp: new Date(Date.now() - 5*60000) }
 * ])
 * // => [
 * //   { icon: '💬', time: 'just now', description: 'Sent message to María' },
 * //   { icon: '📸', time: '5 min ago', description: 'Requested photo' }
 * // ]
 */
export function formatTimelineItems(actions: Action[]): TimelineItem[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  // Sort by timestamp descending (newest first)
  const sorted = [...actions].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  );

  return sorted.map((action) => ({
    icon: getIconForAction(action.type),
    time: formatRelativeTime(action.timestamp),
    description: getDescriptionForAction(action.type, action.target, action.count),
  }));
}
