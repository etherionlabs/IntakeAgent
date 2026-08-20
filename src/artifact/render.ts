/**
 * RENDER DEL ARTEFACTO PARA EL MODELO (genérico — candidato a extracción).
 *
 * Traduce el estado del artefacto al bloque de texto que ve el modelo en cada
 * turno. El core renderiza lo que es cierto para cualquier artefacto —campos,
 * media, notas y qué falta para completarlo— y deja un punto de extensión para
 * que el DOMINIO añada sus propios bloques.
 *
 * Por qué el punto de extensión: antes este renderer escribía a mano el
 * diagnóstico de venta y los servicios adicionales, e incluso nombraba las tools
 * (`register_discovery`, `register_opportunity`) en su salida. Eso ataba el
 * runtime del artefacto al dominio de ventas en los dos sentidos. Ahora esos
 * bloques son secciones que el dominio registra; el core no sabe qué contienen.
 */
import type { IntakeSchema } from '../config/intake-schema';
import type { ArtifactState, FieldState } from './state';
import { missingRequiredPaths } from './state';

export interface RenderCtx {
  jobId: string;
  status: string;
}

/**
 * Bloque de render aportado por el dominio.
 *
 * Devuelve las líneas a insertar (vacío = no aportar nada en este turno). Recibe
 * el estado completo porque el dominio es el único que sabe interpretar sus
 * propios bloques.
 */
export interface ArtifactRenderSection {
  /** Nombre para diagnóstico/tests; no se imprime. */
  name: string;
  render(state: ArtifactState): string[];
}

/**
 * Arma el bloque `=== ESTADO DEL INTAKE ===`.
 *
 * Las `sections` del dominio se insertan DESPUÉS de las notas libres y ANTES de
 * la línea de pendientes: el modelo lee primero los hechos, luego la lectura que
 * el dominio hace de ellos, y al final lo que le falta para cerrar.
 */
export function renderArtifactForModel(
  schema: IntakeSchema,
  state: ArtifactState,
  ctx: RenderCtx,
  sections: ArtifactRenderSection[] = [],
): string {
  const lines: string[] = [];
  lines.push(`=== ESTADO DEL INTAKE (job #${ctx.jobId}, status=${ctx.status}) ===`);

  for (const section of schema.sections) {
    lines.push(`${section.label}:`);
    const sec = state[section.key] as Record<string, FieldState>;
    for (const field of section.fields) {
      const f = sec?.[field.key];
      const reqMark = field.required ? ' (REQUERIDO)' : '';
      // El path canónico [section.field] y las opciones de enum se incluyen
      // SIEMPRE: sin esto el modelo inventa paths a partir del label en español
      // (ej. "Dirección" → logistics.dirección) y update_intake falla, perdiendo
      // datos que el cliente ya dio. El label es para humanos; el path, para tools.
      const path = `[${section.key}.${field.key}]`;
      const opts =
        (field.type === 'enum' || field.type === 'multi_enum') && field.options
          ? ` (opciones: ${field.options.join(' | ')})`
          : '';
      const meta = `${path}${opts}`;
      if (!f || (f.value === null && !f.declined)) {
        const icon = field.required ? '✗' : '○';
        const askedNote = f?.asked ? ' [ya preguntado]' : '';
        lines.push(`  ${icon} ${field.label} ${meta}${reqMark}${askedNote}`);
      } else if (f.declined) {
        lines.push(
          `  ⊘ ${field.label} ${meta}${reqMark} — declinado: "${f.declined_reason ?? ''}"`,
        );
      } else {
        const v = typeof f.value === 'string' ? `"${f.value}"` : String(f.value);
        lines.push(`  ✓ ${field.label} ${meta}: ${v}`);
      }
    }
  }

  lines.push(`Media:`);
  lines.push(`  📷 fotos recibidas: ${state.media.photo_count}`);
  lines.push(`  🎤 audios recibidos: ${state.media.audio_count}`);

  if (state.free_notes.length > 0) {
    lines.push(`Notas libres:`);
    for (const n of state.free_notes) {
      lines.push(`  - ${n.text}`);
    }
  }

  for (const section of sections) {
    lines.push(...section.render(state));
  }

  const missing = missingRequiredPaths(schema, state);
  lines.push(
    missing.length === 0
      ? 'Pendientes mínimos para cerrar intake: ninguno (puedes presentar resumen)'
      : `Pendientes mínimos para cerrar intake: ${missing.join(', ')}`,
  );

  return lines.join('\n');
}
