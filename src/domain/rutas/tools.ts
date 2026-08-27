/**
 * MÓDULO `rutas`: sus tools.
 *
 * Cuatro, y el orden en que aparecen es el orden del proceso: investigar antes
 * de proponer, proponer antes de elegir, elegir antes de avanzar. El modelo ve
 * ese orden en su catálogo.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TurnContext } from '../../agent/types';
import type { AgentTool, ElementToolProvider } from '../../agent/toolRegistry';
import type { ElementHost } from '../../agent/elementHost';
import { groupByConfidence } from '../../research/parse';
import {
  activarRuta,
  faltaEnRuta,
  listRutas,
  registrarAvance,
  rutaEnCurso,
  upsertRuta,
  validateRutaUpdate,
  type OportunidadLaboral,
} from './state';

const InvestigarArgsZ = z.object({
  pregunta: z.string().min(10, 'la pregunta debe ser concreta'),
  lugar: z.string().optional(),
  contexto: z.string().optional(),
});

/**
 * La única puerta al mundo real. Todo lo que el agente afirme sobre vacantes,
 * requisitos, salarios o cursos tiene que haber pasado por aquí.
 */
export function buildInvestigarTool(ctx: TurnContext, host: ElementHost): AgentTool {
  return {
    name: 'investigar',
    description:
      'Busca información REAL y pública sobre empleo: vacantes, empleadores, requisitos de entrada, ' +
      'salarios, certificaciones, cursos y programas de formación. Úsala ANTES de proponer cualquier ' +
      'ruta o mencionar cualquier puesto, empresa, salario o curso. Haz UNA pregunta concreta por ' +
      'llamada (ej. "¿qué piden para entrar como HVAC helper sin experiencia?"). Los resultados vienen ' +
      'separados en verificado (con fuente abrible), inferido (deducción) y desconocido: NO presentes ' +
      'lo inferido como si fuera un hecho.',
    inputSchema: InvestigarArgsZ,
    execute: async (rawArgs) => {
      const parse = InvestigarArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      if (!host.research) {
        return { ok: false, error: 'este entorno no tiene investigación disponible' };
      }

      try {
        const r = await host.research({
          question: parse.data.pregunta,
          location: parse.data.lugar,
          context: parse.data.contexto,
        });
        host.countEvent('research_queries', { resultado: r.findings.length > 0 ? 'con_hallazgos' : 'vacio' });
        const g = groupByConfidence(r);
        return {
          ok: true,
          verificado: g.verificado.map((f) => ({ hecho: f.claim, fuente: f.source?.url })),
          inferido: g.inferido.map((f) => f.claim),
          desconocido: g.desconocido.map((f) => f.claim),
          sin_resolver: r.unresolved,
        };
      } catch (e) {
        // Un fallo de investigación se dice, no se disfraza de "no hay nada":
        // el modelo debe saber que no puede proponer, en vez de rellenar el hueco.
        host.countEvent('research_queries', { resultado: 'error' });
        return {
          ok: false,
          error: `la investigación falló: ${e instanceof Error ? e.message : String(e)}. ` +
            'NO inventes datos para compensar: dile al usuario que no pudiste verificarlo.',
        };
      }
    },
  };
}

const OportunidadZ = z.object({
  titulo: z.string().min(2),
  empleador: z.string().optional(),
  ubicacion: z.string().optional(),
  salario: z.string().optional(),
  confianza: z.enum(['verificado', 'inferido', 'desconocido']).default('inferido'),
  url: z.string().optional(),
});

const RegistrarRutaArgsZ = z.object({
  id: z.string().optional(),
  destino: z.string().min(3, 'el destino es el puesto o categoría concreta'),
  viabilidad: z.enum(['alta', 'media', 'baja']),
  proxima_accion: z.string().min(10, 'tiene que ser algo que la persona pueda hacer hoy'),
  brechas: z.array(z.string().min(3)).default([]),
  pasos: z
    .array(
      z.object({
        orden: z.number().int().positive(),
        accion: z.string().min(5),
        cierra: z.string().optional(),
        costo: z.string().optional(),
        duracion: z.string().optional(),
      }),
    )
    .default([]),
  oportunidades: z.array(OportunidadZ).default([]),
  tiempo_estimado: z.string().optional(),
  costo_estimado: z.string().optional(),
});

export function buildRegistrarRutaTool(ctx: TurnContext, host: ElementHost): AgentTool {
  return {
    name: 'registrar_ruta',
    description:
      'Guarda una ruta laboral: destino, qué tan alcanzable es, qué le separa (brechas), los pasos que ' +
      'cierran esas brechas, las oportunidades encontradas y la PRÓXIMA ACCIÓN concreta. Registra 2 o 3 ' +
      'rutas como mucho. Usa el mismo id para corregir una que ya registraste. Las oportunidades solo ' +
      'pueden ir como confianza=verificado si traen la url que salió de investigar.',
    inputSchema: RegistrarRutaArgsZ,
    execute: async (rawArgs) => {
      const parse = RegistrarRutaArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const args = parse.data;

      const oportunidades: OportunidadLaboral[] = args.oportunidades.map((o) => ({
        titulo: o.titulo,
        ...(o.empleador ? { empleador: o.empleador } : {}),
        ...(o.ubicacion ? { ubicacion: o.ubicacion } : {}),
        ...(o.salario ? { salario: o.salario } : {}),
        confianza: o.confianza,
        source: o.url ? { url: o.url, title: o.titulo, consultedAt: ctx.now } : null,
      }));

      const update = { ...args, oportunidades };
      const invalido = validateRutaUpdate(update);
      if (invalido) return { ok: false, error: `ruta inválida: ${invalido}` };
      const falta = faltaEnRuta(update);
      if (falta.length > 0) return { ok: false, error: `a la ruta le falta: ${falta.join(', ')}` };

      const { state, ruta, degradadas } = upsertRuta(
        ctx.intake,
        update,
        ctx.now,
        () => randomUUID().slice(0, 8),
      );
      await host.saveArtifact(ctx.job.id, state);
      ctx.intake = state;
      host.countEvent('rutas', { viabilidad: ruta.viabilidad });

      return {
        ok: true,
        ruta_id: ruta.id,
        total_rutas: listRutas(state).length,
        // Se le devuelve lo degradado para que no lo presente como vacante real.
        degradadas_sin_fuente: degradadas,
      };
    },
  };
}

const ActivarRutaArgsZ = z.object({ ruta_id: z.string().min(1) });

export function buildActivarRutaTool(ctx: TurnContext, host: ElementHost): AgentTool {
  return {
    name: 'activar_ruta',
    description:
      'Marca cuál es la ruta que la persona va a recorrer. Solo una puede estar activa; la anterior ' +
      'vuelve a quedar como propuesta (cambiar de ruta no es renunciar a la otra). Llámala cuando la ' +
      'persona elija, no antes.',
    inputSchema: ActivarRutaArgsZ,
    execute: async (rawArgs) => {
      const parse = ActivarRutaArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      const next = activarRuta(ctx.intake, parse.data.ruta_id, ctx.now);
      if (!next) return { ok: false, error: `no existe la ruta ${parse.data.ruta_id}` };

      await host.saveArtifact(ctx.job.id, next);
      ctx.intake = next;
      host.countEvent('rutas_activadas');
      return { ok: true, activa: rutaEnCurso(next)?.destino };
    },
  };
}

const AvanceArgsZ = z
  .object({
    paso_orden: z.number().int().positive().optional(),
    bloqueo: z.string().min(5).optional(),
    proxima_accion: z.string().min(10).optional(),
    estado: z.enum(['activa', 'bloqueada', 'descartada', 'lograda']).optional(),
  })
  .refine((d) => d.paso_orden || d.bloqueo || d.proxima_accion || d.estado, {
    message: 'manda al menos uno: paso_orden, bloqueo, proxima_accion o estado',
  });

export function buildRegistrarAvanceTool(ctx: TurnContext, host: ElementHost): AgentTool {
  return {
    name: 'registrar_avance',
    description:
      'Registra qué pasó al recorrer la ruta activa: un paso completado, un bloqueo (ej. "aplicó a 5 y ' +
      'nadie respondió en 2 semanas"), o la siguiente acción. Un bloqueo es lo que dispara replanificar: ' +
      'regístralo en cuanto lo sepas en vez de dejar la ruta como si siguiera avanzando.',
    inputSchema: AvanceArgsZ,
    execute: async (rawArgs) => {
      const parse = AvanceArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      const { state, error } = registrarAvance(ctx.intake, parse.data, ctx.now);
      if (error) return { ok: false, error };

      await host.saveArtifact(ctx.job.id, state);
      ctx.intake = state;
      if (parse.data.bloqueo) host.countEvent('rutas_bloqueadas');

      const activa = rutaEnCurso(state);
      return {
        ok: true,
        estado: activa?.estado,
        pasos_pendientes: activa?.pasos.filter((p) => !p.hecho).length ?? 0,
      };
    },
  };
}

/** Pack del módulo. `investigar` solo se expone si el arnés ofrece investigación. */
export const rutasToolProviders: readonly ElementToolProvider[] = [
  { name: 'investigar', build: buildInvestigarTool },
  { name: 'registrar_ruta', build: buildRegistrarRutaTool },
  { name: 'activar_ruta', build: buildActivarRutaTool },
  { name: 'registrar_avance', build: buildRegistrarAvanceTool },
];
