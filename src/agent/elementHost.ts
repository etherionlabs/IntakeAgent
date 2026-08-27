/**
 * CONTRATO DEL ARNÉS (genérico — candidato a extracción).
 *
 * Un elemento de vertical no es solo datos: ejecuta procesos propios, y por eso
 * necesita hablar con el runtime que lo hospeda. La pregunta es CÓMO.
 *
 * Hasta ahora lo hacía importando el núcleo directamente:
 *
 *   import { updateJobIntake } from '../../services/job';   ← Prisma + modelo Job
 *   import { incOpportunity } from '../../lib/metrics';      ← registro en memoria
 *
 * Con eso, cambiar el núcleo por otro arnés agéntico rompía el elemento, y
 * mejorar cómo persiste o cómo mide obligaba a tocar el dominio. Las dos cosas
 * que queremos —núcleo sustituible y elementos actualizables por separado—
 * quedaban bloqueadas por los mismos dos imports.
 *
 * `ElementHost` es la superficie completa que el arnés le ofrece a un elemento.
 * Es deliberadamente diminuta, y ése es su criterio de diseño: aquí solo entra
 * lo que CUALQUIER arnés agéntico tendría. Si algún día hace falta añadir un
 * método que solo este runtime sabe hacer, la abstracción está mal puesta.
 *
 * Al elemento NO se le pasa el cliente de base de datos, ni el notifier, ni la
 * config. No es disciplina: es que no los recibe.
 */
import type { ArtifactState } from '../artifact/state';
import type { ResearchQuery, ResearchResult } from '../research/types';

export interface ElementHost {
  /**
   * Persiste el estado del artefacto del caso. El elemento pasa el id porque un
   * turno puede cambiar de caso a media conversación.
   */
  saveArtifact(caseId: string, state: ArtifactState): Promise<void>;

  /**
   * Cuenta un evento de dominio para observabilidad. El nombre y las etiquetas
   * son vocabulario del elemento: el arnés los transporta sin interpretarlos.
   */
  countEvent(name: string, labels?: Record<string, string>): void;

  /**
   * Busca hechos del mundo con procedencia. OPCIONAL: un arnés puede no
   * ofrecerlo, y un elemento que lo necesite debe comprobar su presencia antes
   * de exponer la tool que lo usa.
   *
   * Admitido aquí por la misma regla que `saveArtifact`: **el anfitrión es dueño
   * de todo lo que exige credenciales o E/S**. Un elemento no debe sostener una
   * clave de API ni un cliente HTTP, igual que no sostiene una conexión a la base
   * de datos. Qué se pregunta es del dominio; con qué se pregunta, del arnés.
   */
  research?(query: ResearchQuery): Promise<ResearchResult>;
}
