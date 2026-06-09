/**
 * Conversation Grouping Service
 * Groups conversations by state for the inbox view.
 *
 * Groups:
 * 1. Attention Required — Conversations waiting for response, older than 6 hours
 * 2. Waiting Client — Conversations waiting for client response
 * 3. In Attention — Currently being worked on by receptionist
 */

/**
 * Represents a conversation in the inbox.
 */
export interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  lastMessageTime: Date;
  messageCount: number;
  isWaitingForClient: boolean;
  lastAgentResponseTime?: Date;
  status: string;
}

/**
 * Grouped conversations organized by state.
 */
export interface GroupedConversations {
  attentionRequired: Conversation[];
  waitingClient: Conversation[];
  inAttention: Conversation[];
}

/**
 * Groups conversations by state based on their status and timestamps.
 *
 * Logic:
 * - attentionRequired: Not waiting for client AND (now - lastAgentResponseTime) > 6 hours
 * - waitingClient: isWaitingForClient = true
 * - inAttention: status = OPEN_INTAKE (agent is currently working on it)
 *
 * Each group is sorted by timestamp (most recent first).
 *
 * @param conversations - Array of conversations to group
 * @returns Object with three arrays: attentionRequired, waitingClient, inAttention
 *
 * @example
 * const grouped = groupConversationsByState(conversations);
 * console.log(grouped.attentionRequired); // Oldest conversations waiting for agent response
 * console.log(grouped.waitingClient);    // Conversations waiting for client
 * console.log(grouped.inAttention);      // Conversations being worked on
 */
export function groupConversationsByState(
  conversations: Conversation[],
): GroupedConversations {
  const attentionRequired: Conversation[] = [];
  const waitingClient: Conversation[] = [];
  const inAttention: Conversation[] = [];

  const now = new Date();
  const sixHoursAgoMs = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

  for (const conv of conversations) {
    // In Attention — Status is OPEN_INTAKE (agent is actively working)
    if (conv.status === 'OPEN_INTAKE') {
      inAttention.push(conv);
    }
    // Waiting Client — Explicitly marked as waiting for client
    else if (conv.isWaitingForClient) {
      waitingClient.push(conv);
    }
    // Attention Required — Not waiting for client AND older than 6 hours since last agent response
    else if (!conv.isWaitingForClient) {
      // If there's no lastAgentResponseTime, treat as needing attention
      if (!conv.lastAgentResponseTime) {
        attentionRequired.push(conv);
      } else {
        const timeSinceLastResponse = now.getTime() - conv.lastAgentResponseTime.getTime();
        if (timeSinceLastResponse > sixHoursAgoMs) {
          attentionRequired.push(conv);
        }
      }
    }
  }

  // Sort each group by timestamp (most recent first)
  const sortByRecency = (a: Conversation, b: Conversation) =>
    b.lastMessageTime.getTime() - a.lastMessageTime.getTime();

  attentionRequired.sort(sortByRecency);
  waitingClient.sort(sortByRecency);
  inAttention.sort(sortByRecency);

  return {
    attentionRequired,
    waitingClient,
    inAttention,
  };
}
