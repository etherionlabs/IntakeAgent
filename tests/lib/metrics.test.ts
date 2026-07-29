import { describe, it, expect, beforeEach } from 'vitest';
import {
  incMessage,
  incLlmError,
  incHttp,
  incOpportunity,
  incFollowUp,
  setBotsConnected,
  renderMetrics,
  resetMetrics,
} from '../../src/lib/metrics';

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  it('renderiza contadores en formato Prometheus', () => {
    incMessage('t1'); incMessage('t1'); incMessage('t2');
    incLlmError('insufficient_credits');
    incHttp(200); incHttp(500);
    setBotsConnected(3);
    const out = renderMetrics();
    expect(out).toContain('intake_messages_total{tenant="t1"} 2');
    expect(out).toContain('intake_messages_total{tenant="t2"} 1');
    expect(out).toContain('intake_llm_errors_total{type="insufficient_credits"} 1');
    expect(out).toContain('intake_http_requests_total{class="2xx"} 1');
    expect(out).toContain('intake_http_requests_total{class="5xx"} 1');
    expect(out).toContain('intake_bots_connected 3');
  });
});

describe('métricas de venta', () => {
  beforeEach(() => resetMetrics());

  it('cuenta las oportunidades por estado', () => {
    incOpportunity('offered');
    incOpportunity('offered');
    incOpportunity('accepted');
    const out = renderMetrics();
    expect(out).toContain('intake_opportunities_total{status="offered"} 2');
    expect(out).toContain('intake_opportunities_total{status="accepted"} 1');
  });

  it('cuenta los seguimientos proactivos por motivo', () => {
    incFollowUp('pending_offer');
    incFollowUp('incomplete_intake');
    incFollowUp('pending_offer');
    const out = renderMetrics();
    expect(out).toContain('intake_followups_total{reason="pending_offer"} 2');
    expect(out).toContain('intake_followups_total{reason="incomplete_intake"} 1');
  });

  it('resetMetrics limpia también los contadores de venta', () => {
    incOpportunity('accepted');
    incFollowUp('pending_offer');
    resetMetrics();
    const out = renderMetrics();
    expect(out).not.toContain('intake_opportunities_total{');
    expect(out).not.toContain('intake_followups_total{');
  });
});
