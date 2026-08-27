/**
 * Registro de módulos disponibles para componer verticales.
 *
 * Añadir un módulo es añadir una entrada aquí; ninguna vertical existente se
 * entera. Es el equivalente de `skills/` para capacidades con estado.
 */
import type { DomainModule } from './modules';
import { intakeModule } from './intake/module';
import { rutasModule } from './rutas/module';
import { salesModule } from './sales/module';

export const MODULE_REGISTRY: Readonly<Record<string, DomainModule>> = {
  [intakeModule.name]: intakeModule,
  [salesModule.name]: salesModule,
  [rutasModule.name]: rutasModule,
};

/** Composición de Intake tal como se vende hoy: captar y además asesorar. */
export const INTAKE_MODULES = ['intake', 'ventas'] as const;
