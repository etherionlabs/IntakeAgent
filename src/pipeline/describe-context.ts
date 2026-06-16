import type { IntakeSchema } from '../config/intake-schema';
import type { IntakeState, FieldState } from '../services/intake';
import type { BusinessFacts } from '../config/schema';
import type { DescribeContext } from '../media/describer';

function trim(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export interface BuildDescribeContextArgs {
  schema: IntakeSchema;
  intake: IntakeState;
  businessFacts: BusinessFacts;
  caption?: string | null;
  /** Mensajes recientes del job (cronológicos), para el contexto de la sesión. */
  recentMessages?: { direction: 'inbound' | 'outbound'; body: string | null }[];
}

/**
 * Arma el contexto de negocio + sesión que recibe el modelo de visión, para que
 * enfoque la descripción en lo relevante para ESTE negocio y ESTA conversación.
 */
export function buildDescribeContext(args: BuildDescribeContextArgs): DescribeContext {
  const { schema, intake, businessFacts, caption, recentMessages } = args;

  // Qué recoge el negocio (con hints recortados) — enfoque del negocio.
  const collectsLines: string[] = [];
  for (const section of schema.sections) {
    const fields = section.fields.map((f) =>
      f.hint ? `${f.label} (${trim(f.hint, 70)})` : f.label,
    );
    collectsLines.push(`- ${section.label}: ${fields.join('; ')}`);
  }

  // Estado de la sesión: qué ya sabemos vs qué falta (requeridos).
  const known: string[] = [];
  const missing: string[] = [];
  for (const section of schema.sections) {
    const sec = intake[section.key] as Record<string, FieldState> | undefined;
    for (const field of section.fields) {
      const f = sec?.[field.key];
      const satisfied = f && (f.value !== null || f.declined === true);
      if (f && f.value !== null && !f.declined) {
        known.push(`${field.label}: ${String(f.value)}`);
      } else if (field.required && !satisfied) {
        missing.push(field.label);
      }
    }
  }
  const sessionParts: string[] = [];
  if (known.length) sessionParts.push(`ya sabemos — ${known.join('; ')}`);
  if (missing.length) sessionParts.push(`aún falta — ${missing.join('; ')}`);

  let recentConversation: string | undefined;
  if (recentMessages && recentMessages.length) {
    const convo = recentMessages
      .filter((m) => m.body && m.body.trim().length > 0)
      .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}: ${trim(m.body ?? '', 140)}`)
      .join(' | ');
    if (convo) recentConversation = convo;
  }

  const freeContext = businessFacts.freeContext?.trim();

  return {
    caption,
    businessName: schema.$businessName,
    businessDomain: schema.$businessDomain,
    collects: collectsLines.join('\n'),
    businessContext: freeContext ? freeContext : undefined,
    sessionState: sessionParts.length ? sessionParts.join('; ') : undefined,
    recentConversation,
  };
}
