import { describe, it, expect } from 'vitest';
import {
  evaluateJob,
  buildFollowUpDirective,
  policyFromConfig,
  type FollowUpPolicy,
} from '../../src/services/followUp';
import { createEmptyIntakeFromSchema, upsertOpportunities, bulkUpdate } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';
import type { Config } from '../../src/config/schema';
import type { Job, Contact, Message } from '@prisma/client';

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Teléfono', type: 'phone', required: false },
      ],
    },
  ],
};

const NOW = new Date('2026-07-29T15:00:00.000Z');
const policy: FollowUpPolicy = { afterHours: 24, maxFollowUps: 2, minHoursBetween: 24 };

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 3600_000);
}

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    contactId: 'c1',
    status: 'OPEN_INTAKE',
    intake: JSON.stringify(createEmptyIntakeFromSchema(schema)),
    intakeComplete: false,
    summary: null,
    outcome: null,
    followUpCount: 0,
    lastFollowUpAt: null,
    openedAt: hoursAgo(72),
    readyAt: null,
    closedAt: null,
    archivedAt: null,
    tenantId: 't1',
    ...over,
  } as Job;
}

function makeContact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    phoneE164: '+521',
    displayName: null,
    botActive: true,
    channel: 'whatsapp',
    flaggedNonIntake: false,
    flaggedReason: null,
    archivedAt: null,
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(72),
    tenantId: 't1',
    ...over,
  } as Contact;
}

function lastMsg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    jobId: 'j1',
    contactId: 'c1',
    direction: 'outbound',
    kind: 'text',
    body: '¿Te interesa el polarizado?',
    mediaPath: null,
    mediaDescription: null,
    externalMsgId: null,
    channel: 'whatsapp',
    raw: null,
    createdAt: hoursAgo(30),
    tenantId: 't1',
    ...over,
  } as Message;
}

/** Job con una oferta sin responder — el candidato canónico. */
function jobWithPendingOffer(over: Partial<Job> = {}): Job {
  const intake = upsertOpportunities(
    createEmptyIntakeFromSchema(schema),
    [{ service: 'polarizado 20%', status: 'offered' }],
    NOW.toISOString(),
    null,
  );
  return makeJob({ intake: JSON.stringify(intake), ...over });
}

function evaluate(job: Job, contact = makeContact(), last: Message | null = lastMsg()) {
  return evaluateJob({ job, contact, lastMessage: last, schema, policy, now: NOW });
}

describe('evaluateJob — a quién le damos seguimiento', () => {
  it('persigue una oferta que el cliente dejó en el aire', () => {
    const v = evaluate(jobWithPendingOffer());
    expect(v?.reason).toBe('pending_offer');
    expect(v?.body.join(' ')).toContain('polarizado 20%');
    expect(Math.round(v!.silentHours)).toBe(30);
  });

  it('persigue un intake incompleto cuando no hay ofertas pendientes', () => {
    const v = evaluate(makeJob());
    expect(v?.reason).toBe('incomplete_intake');
    // Usa la etiqueta del schema, no el path.
    expect(v?.body.join(' ')).toContain('Nombre');
    expect(v?.body.join(' ')).not.toContain('client.name');
  });

  it('prioriza la oferta pendiente sobre el intake incompleto', () => {
    // El job tiene AMBOS: oferta sin responder y el nombre sin capturar.
    const v = evaluate(jobWithPendingOffer());
    expect(v?.reason).toBe('pending_offer');
  });

  it('no persigue si el cliente ya contestó (el pipeline normal lo atiende)', () => {
    const v = evaluate(jobWithPendingOffer(), makeContact(), lastMsg({ direction: 'inbound' }));
    expect(v).toBeNull();
  });

  it('no persigue antes de que se cumpla el silencio mínimo', () => {
    const v = evaluate(jobWithPendingOffer(), makeContact(), lastMsg({ createdAt: hoursAgo(3) }));
    expect(v).toBeNull();
  });

  it('respeta el tope de seguimientos por job', () => {
    expect(evaluate(jobWithPendingOffer({ followUpCount: 2 }))).toBeNull();
    expect(evaluate(jobWithPendingOffer({ followUpCount: 1 }))).not.toBeNull();
  });

  it('respeta la espera mínima entre seguimientos', () => {
    const reciente = jobWithPendingOffer({ followUpCount: 1, lastFollowUpAt: hoursAgo(2) });
    expect(evaluate(reciente)).toBeNull();
    const viejo = jobWithPendingOffer({ followUpCount: 1, lastFollowUpAt: hoursAgo(48) });
    expect(evaluate(viejo)).not.toBeNull();
  });

  it('nunca escribe a quien pausó el bot, fue marcado como spam o está archivado', () => {
    const job = jobWithPendingOffer();
    expect(evaluate(job, makeContact({ botActive: false }))).toBeNull();
    expect(evaluate(job, makeContact({ flaggedNonIntake: true }))).toBeNull();
    expect(evaluate(job, makeContact({ archivedAt: hoursAgo(1) }))).toBeNull();
  });

  it('solo persigue jobs en intake abierto y sin archivar', () => {
    expect(evaluate(jobWithPendingOffer({ status: 'READY_FOR_REVIEW' }))).toBeNull();
    expect(evaluate(jobWithPendingOffer({ status: 'CLOSED' }))).toBeNull();
    expect(evaluate(jobWithPendingOffer({ archivedAt: hoursAgo(1) }))).toBeNull();
  });

  it('no persigue un job sin mensajes', () => {
    expect(evaluate(jobWithPendingOffer(), makeContact(), null)).toBeNull();
  });

  it('no persigue si no queda nada pendiente', () => {
    // Intake completo (el único requerido lleno) y ninguna oferta en el aire.
    const filled = bulkUpdate(schema, createEmptyIntakeFromSchema(schema), [
      { path: 'client.name', value: 'María' },
    ], { now: NOW.toISOString(), source_message_id: null });
    if (!filled.ok) throw new Error('fixture inválido');
    const withDecided = upsertOpportunities(
      filled.intake,
      [{ service: 'polarizado', status: 'declined' }],
      NOW.toISOString(),
      null,
    );
    expect(evaluate(makeJob({ intake: JSON.stringify(withDecided) }))).toBeNull();
  });

  it('un campo declinado cuenta como satisfecho (no se persigue)', () => {
    const declined = bulkUpdate(schema, createEmptyIntakeFromSchema(schema), [
      { path: 'client.name', declined: true, declined_reason: 'no quiso darlo' },
    ], { now: NOW.toISOString(), source_message_id: null });
    if (!declined.ok) throw new Error('fixture inválido');
    expect(evaluate(makeJob({ intake: JSON.stringify(declined.intake) }))).toBeNull();
  });
});

describe('policyFromConfig', () => {
  it('toma los valores del config', () => {
    const config = {
      disclosure: { text: 'Te atiende un asistente automatizado.' },
  followUp: { enabled: true, afterHours: 6, maxFollowUps: 1, minHoursBetween: 12, sweepMinutes: 15 },
    } as Config;
    expect(policyFromConfig(config)).toEqual({
      afterHours: 6,
      maxFollowUps: 1,
      minHoursBetween: 12,
    });
  });
});

describe('buildFollowUpDirective — ensamblado genérico', () => {
  const base = { silentHours: 30, previousFollowUps: 0, context: [], body: [] };

  it('deja claro que el turno no lo disparó el cliente', () => {
    const d = buildFollowUpDirective({ ...base, body: ['Falta capturar: Nombre.'] });
    expect(d).toContain('SEGUIMIENTO PROACTIVO');
    expect(d).toContain('NO lo disparó el cliente');
    expect(d).toContain('30 h sin responder');
  });

  it('coloca el cuerpo que aporta el módulo', () => {
    const d = buildFollowUpDirective({ ...base, body: ['Quedó en el aire: polarizado 20%.'] });
    expect(d).toContain('polarizado 20%');
  });

  it('coloca el contexto de los módulos antes del cuerpo', () => {
    const d = buildFollowUpDirective({
      ...base,
      context: ['Lo que te contó que necesita: se le calienta muchísimo el auto'],
      body: ['Quedó en el aire: PPF.'],
    });
    expect(d.indexOf('se le calienta')).toBeLessThan(d.indexOf('PPF'));
  });

  it('acota el mensaje: uno solo, sin reclamo y sin inventar urgencias', () => {
    const d = buildFollowUpDirective({ ...base, body: ['Falta capturar: Nombre.'] });
    expect(d).toMatch(/UN solo mensaje/);
    expect(d).toMatch(/sin reclamo/i);
    expect(d).toMatch(/NO inventes/);
    expect(d).toContain('seguimiento número 1');
  });

  /**
   * El ensamblado no menciona ventas: si lo hiciera, una vertical de captación
   * pura arrastraría copy comercial en cada seguimiento.
   */
  it('es neutral: sin módulos que aporten, no habla de vender', () => {
    const d = buildFollowUpDirective({ ...base, body: ['Falta capturar: Nombre.'] });
    expect(d.toLowerCase()).not.toMatch(/ofrec|servicio|objeci/);
  });
});
