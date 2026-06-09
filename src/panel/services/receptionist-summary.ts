/**
 * Receptionist Summary Service
 * Generates human-readable operational summaries from agent actions.
 */

export interface Action {
  type:
    | 'message_sent'
    | 'photo_requested'
    | 'job_ready'
    | 'job_closed'
    | 'note_added';
  /** Contact name, job id, or description of what was acted on */
  target?: string;
  /** Number of items if bulk operation */
  count?: number;
  timestamp: Date;
}

/**
 * Groups actions by type and generates a human-readable narrative.
 * Returns a 2-3 sentence summary with signature.
 *
 * @example
 * generateSummary([
 *   { type: 'photo_requested', count: 3, timestamp: new Date() },
 *   { type: 'job_ready', count: 2, timestamp: new Date() }
 * ])
 * // => "Just asked 3 clients for photos. 2 jobs ready for review. — Your Digital Receptionist"
 */
export function generateSummary(actions: Action[]): string {
  if (!actions || actions.length === 0) {
    return 'Receptionist is ready to work. — Your Digital Receptionist';
  }

  // Group actions by type and aggregate
  const actionGroups = new Map<
    Action['type'],
    { count: number; targets: Set<string> }
  >();

  for (const action of actions) {
    const key = action.type;
    if (!actionGroups.has(key)) {
      actionGroups.set(key, { count: 0, targets: new Set() });
    }
    const group = actionGroups.get(key)!;
    group.count += action.count ?? 1;
    if (action.target) {
      group.targets.add(action.target);
    }
  }

  // Build narrative sentences
  const sentences: string[] = [];

  // Process each action type
  const photoActions = actionGroups.get('photo_requested');
  if (photoActions && photoActions.count > 0) {
    if (photoActions.count === 1) {
      sentences.push('Asked for a photo');
    } else {
      sentences.push(`Asked ${photoActions.count} clients for photos`);
    }
  }

  const messageActions = actionGroups.get('message_sent');
  if (messageActions && messageActions.count > 0) {
    const targets = Array.from(messageActions.targets);
    if (targets.length > 0) {
      if (targets.length === 1) {
        sentences.push(`Sent message to ${targets[0]}`);
      } else {
        sentences.push(`Sent messages to ${targets.length} contacts`);
      }
    } else if (messageActions.count > 0) {
      sentences.push(
        `Sent ${messageActions.count} message${messageActions.count > 1 ? 's' : ''}`,
      );
    }
  }

  const readyActions = actionGroups.get('job_ready');
  if (readyActions && readyActions.count > 0) {
    if (readyActions.count === 1) {
      sentences.push('1 job ready for review');
    } else {
      sentences.push(`${readyActions.count} jobs ready for review`);
    }
  }

  const closedActions = actionGroups.get('job_closed');
  if (closedActions && closedActions.count > 0) {
    if (closedActions.count === 1) {
      sentences.push('Closed 1 completed job');
    } else {
      sentences.push(`Closed ${closedActions.count} completed jobs`);
    }
  }

  const noteActions = actionGroups.get('note_added');
  if (noteActions && noteActions.count > 0) {
    if (noteActions.count === 1) {
      sentences.push('Added a note');
    } else {
      sentences.push(`Added ${noteActions.count} notes`);
    }
  }

  if (sentences.length === 0) {
    return 'Receptionist is ready to work. — Your Digital Receptionist';
  }

  // Join sentences with "Just" prefix for the first, then dot-separated
  let narrative = 'Just ' + sentences.join('. ') + '.';

  // Add signature
  return narrative + ' — Your Digital Receptionist';
}

/**
 * Extracts actions from agent tool calls.
 * Used to convert raw AgentRun.toolCalls into Action objects.
 */
export function extractActionsFromToolCalls(
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>,
): Action[] {
  const actions: Action[] = [];
  const timestamp = new Date();

  for (const toolCall of toolCalls) {
    const name = toolCall.name;

    if (name === 'request_photo') {
      // request_photo typically takes no args or minimal args
      actions.push({
        type: 'photo_requested',
        count: 1,
        timestamp,
      });
    } else if (name === 'mark_ready_for_review') {
      // mark_ready_for_review marks a job as ready
      actions.push({
        type: 'job_ready',
        count: 1,
        timestamp,
      });
    } else if (name === 'close_job') {
      // close_job closes a completed job
      actions.push({
        type: 'job_closed',
        count: 1,
        timestamp,
      });
    } else if (name === 'update_intake') {
      // update_intake can be treated as a note-like action
      // This is less visible to the user but still an action
      actions.push({
        type: 'note_added',
        count: 1,
        timestamp,
      });
    }
  }

  return actions;
}
