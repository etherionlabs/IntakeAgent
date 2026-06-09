/**
 * Urgency Calculation Service
 * Determines urgency level of conversations based on creation timestamp.
 *
 * Urgency levels:
 * 1. URGENTE (🔴 danger) — >24 hours since creation
 * 2. PENDIENTE (🟠 warning) — >6 hours since creation
 * 3. EN REVISIÓN (⏳ tertiary) — >2 hours since creation
 * 4. ESPERANDO (💬 info) — <2 hours since creation
 */

/**
 * Badge representation for a conversation's urgency.
 */
export interface UrgencyBadge {
  icon: string;      // Emoji: 🔴, 🟠, ⏳, 💬
  label: string;     // "URGENTE", "PENDIENTE", "EN REVISIÓN", "ESPERANDO"
  color: string;     // CSS class: danger, warning, tertiary, info
}

/**
 * Determines the urgency badge for a conversation based on creation time.
 *
 * @param createdAt - The timestamp when the conversation was created
 * @returns UrgencyBadge with icon, label, and CSS color class
 *
 * @example
 * const badge = getUrgencyBadge(new Date(Date.now() - 25 * 60 * 60 * 1000));
 * console.log(badge); // { icon: '🔴', label: 'URGENTE', color: 'danger' }
 */
export function getUrgencyBadge(createdAt: Date): UrgencyBadge {
  const hours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

  if (hours > 24) {
    return { icon: '🔴', label: 'URGENTE', color: 'danger' };
  }
  if (hours > 6) {
    return { icon: '🟠', label: 'PENDIENTE', color: 'warning' };
  }
  if (hours > 2) {
    return { icon: '⏳', label: 'EN REVISIÓN', color: 'tertiary' };
  }
  return { icon: '💬', label: 'ESPERANDO', color: 'info' };
}
