# Runbook — Lanzamiento (Fase 7: Beta cerrada → Go-Live)

**Objetivo:** llevar Intake de "completo en staging" a producción con clientes
reales, validando primero con una beta cerrada y un control Go/No-Go explícito.

Referencias: `docs/ROADMAP-PRODUCCION.md` (Fase 7),
`docs/runbooks/production-checklist.md`,
`docs/runbooks/2026-06-18-backup-restore-drill.md`,
`docs/runbooks/2026-06-18-incident-response.md`.

---

## Etapa 0 — Prerrequisitos (todo verde antes de empezar)

- [ ] Fases 1–6 implementadas y con sus criterios de aceptación cumplidos.
- [ ] CI en verde (tests raíz+api, SPA, typecheck) en la rama a desplegar.
- [ ] Backups automáticos activos **y restore drill ejecutado con éxito** en
      staging (no solo configurado).
- [ ] Monitoreo, alertas y rastreo de errores (Sentry) operativos con `tenantId`.
- [ ] Secretos de producción generados y fuertes (no los de ejemplo):
      `POSTGRES_PASSWORD`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, claves Stripe,
      `OPENROUTER_API_KEY` con límite de gasto.
- [ ] ToS, Privacidad, DPA y aviso Baileys publicados y enlazados desde el signup.

---

## Etapa 1 — Beta cerrada (2 tenants)

Objetivo: validar el flujo **self-service real** (no alta manual) con los dos
tenants iniciales (tapicería + paquetería).

1. Aprovisionar producción según `production-checklist.md` (Postgres, API, nginx+
   TLS, SPA en Netlify, backups).
2. Cada tenant pasa por el flujo completo **como lo hará un cliente**:
   - [ ] Signup (email + negocio + industria) y verificación de email.
   - [ ] Suscripción Stripe (modo real o trial según decisión de negocio).
   - [ ] Aprovisionamiento automático del bot vía `TenantManager`.
   - [ ] Vinculación de WhatsApp por QR.
   - [ ] Configuración guiada (perfil de intake de su industria).
   - [ ] Mensaje de prueba end-to-end → aparece job en el dashboard.
3. Operar 1–2 semanas. Recoger fricción de onboarding, fallos de bot, dudas de
   cobro. Registrar y priorizar.

**Salida de la beta:** lista de bugs/mejoras bloqueantes resuelta; métricas de
estabilidad aceptables; al menos un **cobro real** procesado y conciliado.

---

## Etapa 2 — Validación de costos y márgenes

- [ ] Revisar costo unitario por tenant (OpenRouter, infra) vs precio del plan.
- [ ] Confirmar que el plan fijo cubre el uso observado con margen.
- [ ] Definir umbrales de alerta de costo por tenant.

---

## Etapa 3 — Go / No-Go

Reunión corta con responsable técnico + dueño del producto. Decisión **Go** solo
si **todo** lo siguiente es cierto:

- [ ] Criterios de aceptación de Fases 1–6 cumplidos.
- [ ] Backups con restore probado (fecha del último drill: ____).
- [ ] Monitoreo y alertas activos; probada al menos una alerta real.
- [ ] Cobro real funcionando (un pago de verdad cobrado y conciliado).
- [ ] Self-service end-to-end probado por alguien externo al equipo.
- [ ] ToS/Privacidad/DPA/Baileys publicados; canal de soporte definido.
- [ ] Márgenes por tenant validados.
- [ ] Runbooks de incidentes y backup/restore accesibles para la guardia.

Si algún ítem es No → **No-Go**: registrar el bloqueante, asignar dueño y
re-agendar.

---

## Etapa 4 — Lanzamiento

1. Congelar cambios no esenciales (code freeze corto).
2. Desplegar la versión aprobada (CI → staging → prod aprobado).
3. Smoke de producción:
   ```bash
   curl -s https://api.<dominio>/health      # {"ok":true}
   ```
   - [ ] Login en la SPA carga el dashboard.
   - [ ] Signup de prueba completo en prod (cuenta interna).
   - [ ] WhatsApp de prueba → job en dashboard.
   - [ ] Webhook de Stripe de prueba procesado.
4. Activar la landing y abrir el registro público.
5. Vigilancia reforzada las primeras 48 h (guardia atenta a alertas).

---

## Plan de Rollback

- **Disparadores:** error rate alto sostenido, fallo de migración, pagos no
  conciliando, pérdida de datos.
- **App/imagen:** redeploy de la imagen anterior conocida buena
  (`docker compose up -d` con el tag previo).
- **Base de datos:** las migraciones deben ser compatibles hacia atrás siempre que
  sea posible. Si una migración rompe → restore desde backup según el runbook de
  backup/restore (asumir SEV1 y comunicar).
- **DNS/nginx:** mantener la config previa para revertir rápido.
- Registrar el rollback como incidente y hacer post-mortem.

---

## Comunicaciones

- **Interno:** canal de incidentes con estado en vivo durante el lanzamiento.
- **Clientes beta:** aviso de ventana de lanzamiento y canal de soporte.
- **Post-lanzamiento:** confirmar "todo estable" o comunicar incidencias con
  honestidad y próximos pasos.
