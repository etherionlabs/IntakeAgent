import { describe, it, expect } from 'vitest';
import {
  generateSummary,
  extractActionsFromToolCalls,
  type Action,
} from '../src/panel/services/receptionist-summary';

describe('receptionist-summary', () => {
  describe('generateSummary', () => {
    it('returns default summary for empty actions', () => {
      const result = generateSummary([]);
      expect(result).toBe(
        'Receptionist is ready to work. — Your Digital Receptionist',
      );
    });

    it('returns default summary for null actions', () => {
      const result = generateSummary(null as any);
      expect(result).toBe(
        'Receptionist is ready to work. — Your Digital Receptionist',
      );
    });

    it('generates summary for single photo request', () => {
      const actions: Action[] = [
        {
          type: 'photo_requested',
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Asked for a photo');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates summary for multiple photo requests', () => {
      const actions: Action[] = [
        {
          type: 'photo_requested',
          count: 3,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Asked 3 clients for photos');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates summary for single message sent', () => {
      const actions: Action[] = [
        {
          type: 'message_sent',
          target: 'John',
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Sent message to John');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates summary for job ready for review', () => {
      const actions: Action[] = [
        {
          type: 'job_ready',
          count: 2,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('2 jobs ready for review');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates summary for single job ready', () => {
      const actions: Action[] = [
        {
          type: 'job_ready',
          count: 1,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('1 job ready for review');
    });

    it('generates summary for closed jobs', () => {
      const actions: Action[] = [
        {
          type: 'job_closed',
          count: 2,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Closed 2 completed jobs');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates summary for multiple action types', () => {
      const actions: Action[] = [
        {
          type: 'photo_requested',
          count: 3,
          timestamp: new Date(),
        },
        {
          type: 'job_ready',
          count: 2,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Asked 3 clients for photos');
      expect(result).toContain('2 jobs ready for review');
      expect(result).toContain('— Your Digital Receptionist');
      expect(result).toMatch(/^Just /);
    });

    it('generates summary for mixed actions with notes', () => {
      const actions: Action[] = [
        {
          type: 'photo_requested',
          count: 2,
          timestamp: new Date(),
        },
        {
          type: 'note_added',
          count: 1,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Asked 2 clients for photos');
      expect(result).toContain('Added a note');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('generates narrative with proper sentence structure', () => {
      const actions: Action[] = [
        {
          type: 'message_sent',
          target: 'María',
          timestamp: new Date(),
        },
        {
          type: 'photo_requested',
          count: 3,
          timestamp: new Date(),
        },
        {
          type: 'job_ready',
          count: 2,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);

      // Should start with "Just"
      expect(result).toMatch(/^Just /);

      // Should have sentences separated by dots
      expect(result).toContain('.');

      // Should end with signature
      expect(result).toContain('— Your Digital Receptionist');

      // Should contain all key parts (order may vary)
      expect(result).toContain('María');
      expect(result).toContain('3 clients');
      expect(result).toContain('2 jobs');
    });

    it('handles message_sent with multiple targets', () => {
      const actions: Action[] = [
        {
          type: 'message_sent',
          target: 'John',
          timestamp: new Date(),
        },
        {
          type: 'message_sent',
          target: 'Jane',
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Sent messages to 2 contacts');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('handles multiple notes', () => {
      const actions: Action[] = [
        {
          type: 'note_added',
          count: 3,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Added 3 notes');
      expect(result).toContain('— Your Digital Receptionist');
    });

    it('handles single closed job', () => {
      const actions: Action[] = [
        {
          type: 'job_closed',
          count: 1,
          timestamp: new Date(),
        },
      ];
      const result = generateSummary(actions);
      expect(result).toContain('Closed 1 completed job');
      expect(result).toContain('— Your Digital Receptionist');
    });
  });

  describe('extractActionsFromToolCalls', () => {
    it('extracts photo request actions', () => {
      const toolCalls = [{ name: 'request_photo', args: {}, result: {} }];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('photo_requested');
    });

    it('extracts job ready actions', () => {
      const toolCalls = [
        { name: 'mark_ready_for_review', args: {}, result: {} },
      ];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('job_ready');
    });

    it('extracts close job actions', () => {
      const toolCalls = [{ name: 'close_job', args: {}, result: {} }];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('job_closed');
    });

    it('extracts update intake as note actions', () => {
      const toolCalls = [{ name: 'update_intake', args: {}, result: {} }];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('note_added');
    });

    it('handles multiple tool calls', () => {
      const toolCalls = [
        { name: 'request_photo', args: {}, result: {} },
        { name: 'request_photo', args: {}, result: {} },
        { name: 'mark_ready_for_review', args: {}, result: {} },
      ];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(3);
      expect(actions.filter((a) => a.type === 'photo_requested')).toHaveLength(
        2,
      );
      expect(actions.filter((a) => a.type === 'job_ready')).toHaveLength(1);
    });

    it('ignores unknown tool names', () => {
      const toolCalls = [
        { name: 'unknown_tool', args: {}, result: {} },
        { name: 'request_photo', args: {}, result: {} },
      ];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('photo_requested');
    });

    it('returns empty array for empty tool calls', () => {
      const toolCalls: any[] = [];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions).toHaveLength(0);
    });

    it('sets timestamp for all actions', () => {
      const toolCalls = [{ name: 'request_photo', args: {}, result: {} }];
      const actions = extractActionsFromToolCalls(toolCalls);
      expect(actions[0].timestamp).toBeInstanceOf(Date);
    });
  });
});
