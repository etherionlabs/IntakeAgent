import { describe, it, expect } from 'vitest';
import { groupConversationsByState, type Conversation } from '../src/panel/services/grouping';

describe('groupConversationsByState', () => {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);

  const mockConversation = (overrides: Partial<Conversation>): Conversation => ({
    id: 'conv-1',
    contactName: 'Test Contact',
    contactPhone: '+1234567890',
    lastMessage: 'Hello',
    lastMessageTime: now,
    messageCount: 5,
    isWaitingForClient: false,
    status: 'OPEN_INTAKE',
    ...overrides,
  });

  describe('grouping logic', () => {
    it('should group OPEN_INTAKE conversations into inAttention', () => {
      const conversations = [mockConversation({ status: 'OPEN_INTAKE' })];
      const result = groupConversationsByState(conversations);

      expect(result.inAttention).toHaveLength(1);
      expect(result.waitingClient).toHaveLength(0);
      expect(result.attentionRequired).toHaveLength(0);
    });

    it('should group READY_FOR_REVIEW conversations into waitingClient', () => {
      const conversations = [
        mockConversation({
          status: 'READY_FOR_REVIEW',
          isWaitingForClient: true,
        }),
      ];
      const result = groupConversationsByState(conversations);

      expect(result.waitingClient).toHaveLength(1);
      expect(result.inAttention).toHaveLength(0);
      expect(result.attentionRequired).toHaveLength(0);
    });

    it('should group conversations older than 6 hours with no recent agent response into attentionRequired', () => {
      const conversations = [
        mockConversation({
          status: 'CLOSED',
          isWaitingForClient: false,
          lastAgentResponseTime: eightHoursAgo,
        }),
      ];
      const result = groupConversationsByState(conversations);

      expect(result.attentionRequired).toHaveLength(1);
      expect(result.waitingClient).toHaveLength(0);
      expect(result.inAttention).toHaveLength(0);
    });

    it('should not group conversations newer than 6 hours into attentionRequired', () => {
      const conversations = [
        mockConversation({
          status: 'CLOSED',
          isWaitingForClient: false,
          lastAgentResponseTime: twoHoursAgo,
        }),
      ];
      const result = groupConversationsByState(conversations);

      expect(result.attentionRequired).toHaveLength(0);
      expect(result.waitingClient).toHaveLength(0);
      expect(result.inAttention).toHaveLength(0);
    });

    it('should handle conversations without lastAgentResponseTime', () => {
      const conversations = [
        mockConversation({
          status: 'CLOSED',
          isWaitingForClient: false,
          lastAgentResponseTime: undefined,
        }),
      ];
      const result = groupConversationsByState(conversations);

      expect(result.attentionRequired).toHaveLength(1);
    });

    it('should sort each group by timestamp (most recent first)', () => {
      const oldest = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      const oldest2 = new Date(now.getTime() - 12 * 60 * 60 * 1000);

      const conversations = [
        mockConversation({
          id: 'conv-oldest',
          lastMessageTime: oldest2,
          lastAgentResponseTime: oldest2,
          status: 'CLOSED',
        }),
        mockConversation({
          id: 'conv-recent',
          lastMessageTime: oldest,
          lastAgentResponseTime: oldest,
          status: 'CLOSED',
        }),
      ];

      const result = groupConversationsByState(conversations);

      expect(result.attentionRequired[0].id).toBe('conv-recent');
      expect(result.attentionRequired[1].id).toBe('conv-oldest');
    });
  });

  describe('empty groups', () => {
    it('should handle empty conversation list', () => {
      const result = groupConversationsByState([]);

      expect(result.attentionRequired).toHaveLength(0);
      expect(result.waitingClient).toHaveLength(0);
      expect(result.inAttention).toHaveLength(0);
    });

    it('should handle conversations that do not fit any category', () => {
      const conversations = [
        mockConversation({
          status: 'CLOSED',
          isWaitingForClient: false,
          lastAgentResponseTime: twoHoursAgo,
        }),
      ];
      const result = groupConversationsByState(conversations);

      expect(result.attentionRequired).toHaveLength(0);
      expect(result.waitingClient).toHaveLength(0);
      expect(result.inAttention).toHaveLength(0);
    });
  });

  describe('mixed conversations', () => {
    it('should properly distribute multiple conversations across groups', () => {
      const conversations = [
        mockConversation({
          id: 'open',
          status: 'OPEN_INTAKE',
        }),
        mockConversation({
          id: 'ready',
          status: 'READY_FOR_REVIEW',
          isWaitingForClient: true,
        }),
        mockConversation({
          id: 'old',
          status: 'CLOSED',
          isWaitingForClient: false,
          lastAgentResponseTime: eightHoursAgo,
        }),
      ];

      const result = groupConversationsByState(conversations);

      expect(result.inAttention).toHaveLength(1);
      expect(result.waitingClient).toHaveLength(1);
      expect(result.attentionRequired).toHaveLength(1);

      expect(result.inAttention[0].id).toBe('open');
      expect(result.waitingClient[0].id).toBe('ready');
      expect(result.attentionRequired[0].id).toBe('old');
    });
  });
});
