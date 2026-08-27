/**
 * Implementación de `ElementHost` para ESTE arnés (Prisma + métricas en memoria).
 *
 * Es la única pieza que traduce entre lo que un elemento de vertical pide y cómo
 * lo resuelve el runtime actual. Portar Intake a otro arnés agéntico consiste,
 * del lado del dominio, en escribir otro archivo como éste — los elementos no
 * se tocan.
 */
import type { PrismaClient } from '@prisma/client';
import type { ElementHost } from '../agent/elementHost';
import type { ArtifactState } from '../artifact/state';
import { incDomainEvent } from '../lib/metrics';
import type { Researcher } from '../research/types';
import { updateJobIntake } from './job';

export function createElementHost(
  prisma: PrismaClient,
  tenantId: string,
  /** Sin investigador, el host no ofrece `research` y las tools que lo usan no se exponen. */
  researcher?: Researcher,
): ElementHost {
  return {
    async saveArtifact(caseId: string, state: ArtifactState): Promise<void> {
      await updateJobIntake(prisma, tenantId, caseId, state);
    },
    countEvent(name: string, labels: Record<string, string> = {}): void {
      incDomainEvent(name, labels);
    },
    ...(researcher ? { research: (query) => researcher.research(query) } : {}),
  };
}
