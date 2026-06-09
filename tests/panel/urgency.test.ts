import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUrgencyBadge, type UrgencyBadge } from '../../src/panel/services/urgency';

describe('getUrgencyBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('URGENTE — >24 hours', () => {
    it('returns 🔴 danger for >24 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 25 * 60 * 60 * 1000); // 25 hours ago
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge).toEqual({
        icon: '🔴',
        label: 'URGENTE',
        color: 'danger',
      });

      vi.useRealTimers();
    });

    it('returns 🔴 danger for exactly 24.1 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 24.1 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('danger');
      expect(badge.icon).toBe('🔴');

      vi.useRealTimers();
    });

    it('returns 🔴 danger for 48 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 48 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('danger');

      vi.useRealTimers();
    });
  });

  describe('PENDIENTE — >6 hours and <=24 hours', () => {
    it('returns 🟠 warning for >6 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 7 * 60 * 60 * 1000); // 7 hours ago
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge).toEqual({
        icon: '🟠',
        label: 'PENDIENTE',
        color: 'warning',
      });

      vi.useRealTimers();
    });

    it('returns 🟠 warning for exactly 6.1 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 6.1 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('warning');
      expect(badge.icon).toBe('🟠');

      vi.useRealTimers();
    });

    it('returns 🟠 warning for 12 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 12 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('warning');

      vi.useRealTimers();
    });
  });

  describe('EN REVISIÓN — >2 hours and <=6 hours', () => {
    it('returns ⏳ tertiary for >2 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 3 * 60 * 60 * 1000); // 3 hours ago
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge).toEqual({
        icon: '⏳',
        label: 'EN REVISIÓN',
        color: 'tertiary',
      });

      vi.useRealTimers();
    });

    it('returns ⏳ tertiary for exactly 2.1 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 2.1 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('tertiary');
      expect(badge.icon).toBe('⏳');

      vi.useRealTimers();
    });

    it('returns ⏳ tertiary for 4 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 4 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('tertiary');

      vi.useRealTimers();
    });
  });

  describe('ESPERANDO — <2 hours', () => {
    it('returns 💬 info for <2 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 1 * 60 * 60 * 1000); // 1 hour ago
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge).toEqual({
        icon: '💬',
        label: 'ESPERANDO',
        color: 'info',
      });

      vi.useRealTimers();
    });

    it('returns 💬 info for exactly 0 minutes (just created)', () => {
      const now = Date.now();
      const createdAt = new Date(now);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('info');
      expect(badge.icon).toBe('💬');

      vi.useRealTimers();
    });

    it('returns 💬 info for 30 minutes', () => {
      const now = Date.now();
      const createdAt = new Date(now - 30 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('info');

      vi.useRealTimers();
    });

    it('returns 💬 info for 1.9 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 1.9 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('info');

      vi.useRealTimers();
    });
  });

  describe('Edge cases', () => {
    it('handles dates in the future (edge case)', () => {
      const now = Date.now();
      const createdAt = new Date(now + 60 * 60 * 1000); // 1 hour in future
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      // Negative hours should return ESPERANDO (lowest urgency)
      expect(badge.color).toBe('info');
      expect(badge.icon).toBe('💬');

      vi.useRealTimers();
    });

    it('handles very old dates (100 days)', () => {
      const now = Date.now();
      const createdAt = new Date(now - 100 * 24 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge.color).toBe('danger');
      expect(badge.icon).toBe('🔴');

      vi.useRealTimers();
    });

    it('handles boundary case: exactly 24 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 24 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      // At exactly 24 hours, should still be in PENDIENTE range (not yet URGENTE)
      expect(badge.color).toBe('warning');

      vi.useRealTimers();
    });

    it('handles boundary case: exactly 6 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 6 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      // At exactly 6 hours, should still be in EN REVISIÓN range (not yet PENDIENTE)
      expect(badge.color).toBe('tertiary');

      vi.useRealTimers();
    });

    it('handles boundary case: exactly 2 hours', () => {
      const now = Date.now();
      const createdAt = new Date(now - 2 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      // At exactly 2 hours, should still be in ESPERANDO range (not yet EN REVISIÓN)
      expect(badge.color).toBe('info');

      vi.useRealTimers();
    });
  });

  describe('Return type consistency', () => {
    it('always returns an object with icon, label, and color', () => {
      const now = Date.now();
      const createdAt = new Date(now - 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const badge = getUrgencyBadge(createdAt);

      expect(badge).toHaveProperty('icon');
      expect(badge).toHaveProperty('label');
      expect(badge).toHaveProperty('color');
      expect(typeof badge.icon).toBe('string');
      expect(typeof badge.label).toBe('string');
      expect(typeof badge.color).toBe('string');

      vi.useRealTimers();
    });

    it('icon is always an emoji from the set', () => {
      const now = Date.now();
      const validIcons = ['🔴', '🟠', '⏳', '💬'];

      for (let offset = 0; offset <= 100; offset += 5) {
        const createdAt = new Date(now - offset * 60 * 60 * 1000);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const badge = getUrgencyBadge(createdAt);
        expect(validIcons).toContain(badge.icon);

        vi.useRealTimers();
      }
    });

    it('color is always one of the valid CSS classes', () => {
      const now = Date.now();
      const validColors = ['danger', 'warning', 'tertiary', 'info'];

      for (let offset = 0; offset <= 100; offset += 5) {
        const createdAt = new Date(now - offset * 60 * 60 * 1000);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const badge = getUrgencyBadge(createdAt);
        expect(validColors).toContain(badge.color);

        vi.useRealTimers();
      }
    });
  });
});
