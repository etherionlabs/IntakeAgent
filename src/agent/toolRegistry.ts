/**
 * REGISTRO DE TOOLS (genérico — candidato a extracción).
 *
 * El runner ya era neutral: recibe una lista de tools y las ejecuta sin saber qué
 * hacen. Lo que no era neutral es CÓMO se armaba esa lista — un array escrito a
 * mano en `tools.ts`, mezclando capacidades del runtime con tools de venta. Con
 * eso, añadir una vertical obligaba a editar el archivo que arma las tools de
 * todas: exactamente el `if <dominio>` que queremos evitar.
 *
 * Aquí una tool se declara como PROVEEDOR: se nombra, se dice cuándo está
 * disponible y se construye. Un pack de dominio es una lista de proveedores.
 */
import type { z } from 'zod';
import type { TurnContext, AgentDeps } from './types';

/** Forma común a todas las tools del agent. Compatible con @openrouter/sdk `tool()`. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any) => Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }>;
}

/**
 * Declaración de una tool disponible para el agente.
 *
 * `isAvailable` es lo que permite EXPONER u OCULTAR una tool por turno sin
 * condicionales sueltos: una tool que el modelo no puede usar (no hay fotos, no
 * hay editor configurado, no hay otro trabajo abierto) no debe aparecer en su
 * catálogo, porque si aparece la llama y malgasta pasos.
 */
export interface ToolProvider {
  /** Nombre de la tool tal como la ve el modelo. Único dentro del pack. */
  name: string;
  /** ¿Se expone en este turno? Ausente = siempre. */
  isAvailable?(ctx: TurnContext, deps: AgentDeps): boolean;
  build(ctx: TurnContext, deps: AgentDeps): AgentTool;
}

/**
 * Resuelve un pack de proveedores al catálogo del turno, conservando el orden
 * declarado. El orden importa: es el que ve el modelo, y moverlo cambia su
 * comportamiento sin que ningún test lo note.
 */
export function buildToolsFrom(
  providers: readonly ToolProvider[],
  ctx: TurnContext,
  deps: AgentDeps,
): AgentTool[] {
  return providers
    .filter((p) => (p.isAvailable ? p.isAvailable(ctx, deps) : true))
    .map((p) => p.build(ctx, deps));
}
