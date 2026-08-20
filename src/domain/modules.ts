/**
 * BIBLIOTECA DE MÓDULOS DE DOMINIO.
 *
 * Una vertical no se escribe: se COMPONE. Declara por nombre los módulos que
 * necesita —igual que hoy declara sus skills— y cada módulo aporta su estado,
 * sus tools, sus bloques de prompt, sus técnicas y su motivo de seguimiento.
 *
 *   captación pura   = [intake]
 *   venta consultiva = [intake, ventas]      ← Intake hoy
 *   otra vertical    = [intake, <su módulo>]
 *
 * El contrato NO está diseñado por anticipación: son los seis slots que los dos
 * módulos existentes ya necesitaban, recogidos en una declaración. Lo que un
 * módulo todavía no ha pedido, no está aquí.
 */
import type { ToolProvider } from '../agent/toolRegistry';
import type { ArtifactRenderSection } from '../artifact/render';
import type { ArtifactState } from '../artifact/state';
import type { IntakeSchema } from '../config/intake-schema';

/** Lo que un módulo quiere perseguir cuando el cliente se queda callado. */
export interface FollowUpClaim {
  /** Identificador del motivo. Lo nombra el módulo. */
  reason: string;
  /** Qué perseguir, en líneas para la directiva del agente. */
  body: string[];
}

export interface DomainModule {
  name: string;

  /** Bloques que añade al artefacto al crearlo vacío. */
  emptyState(): Record<string, unknown>;

  /** Tools que expone al modelo. */
  toolProviders: readonly ToolProvider[];

  /** Bloques que añade al estado del artefacto en el prompt. */
  renderSections: readonly ArtifactRenderSection[];

  /** Técnicas de la biblioteca `skills/` que el módulo trae consigo. */
  skills: readonly string[];

  /**
   * ¿Hay algo que perseguir? El módulo devuelve su reclamo o null.
   *
   * Cuando varios módulos reclaman, gana el de `followUpPriority` más bajo. La
   * prioridad va aquí como DEFECTO del módulo, no como verdad absoluta: en
   * cuanto una vertical necesite otro orden, esto tendrá que subir a la
   * composición. Hoy no hay evidencia de que haga falta, así que no se inventa.
   */
  resolveFollowUp?(state: ArtifactState, schema: IntakeSchema): FollowUpClaim | null;

  /** Menor gana. Solo se consulta si el módulo reclama. */
  followUpPriority?: number;

  /**
   * Contexto que el módulo aporta al preámbulo del seguimiento AUNQUE no sea el
   * que reclama. Es composición real: `ventas` enriquece el seguimiento de
   * `intake` recordando el dolor y la objeción sin resolver.
   */
  followUpContext?(state: ArtifactState): string[];
}

/**
 * Resuelve nombres a módulos. Un nombre desconocido revienta en vez de omitirse
 * en silencio: al contrario que una skill (texto que se pierde), un módulo
 * ausente cambia qué tools ve el modelo y qué estado se persiste. Fallar al
 * arrancar es preferible a un agente medio construido en producción.
 */
export function resolveModules(
  names: readonly string[],
  registry: Readonly<Record<string, DomainModule>>,
): DomainModule[] {
  return names.map((name) => {
    const mod = registry[name];
    if (!mod) {
      throw new Error(
        `módulo de dominio desconocido: "${name}". Disponibles: ${Object.keys(registry).join(', ')}`,
      );
    }
    return mod;
  });
}

/** Une los bloques vacíos de todos los módulos. */
export function emptyStateFor(modules: readonly DomainModule[]): Record<string, unknown> {
  return Object.assign({}, ...modules.map((m) => m.emptyState()));
}

export function toolProvidersFor(modules: readonly DomainModule[]): ToolProvider[] {
  return modules.flatMap((m) => [...m.toolProviders]);
}

export function renderSectionsFor(modules: readonly DomainModule[]): ArtifactRenderSection[] {
  return modules.flatMap((m) => [...m.renderSections]);
}

/** Skills que aportan los módulos, sin duplicados y en orden de declaración. */
export function skillsFor(modules: readonly DomainModule[]): string[] {
  return [...new Set(modules.flatMap((m) => [...m.skills]))];
}
