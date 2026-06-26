import { describe, it, expect, beforeEach } from 'vitest';
import { incMessage, incLlmError, incHttp, setBotsConnected, renderMetrics, resetMetrics } from '../../src/lib/metrics';

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
