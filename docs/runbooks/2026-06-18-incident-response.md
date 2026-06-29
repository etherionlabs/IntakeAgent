# Runbook — Respuesta a incidentes y soporte (Intake SaaS)

**Objetivo:** diagnosticar y mitigar rápido los fallos más comunes en producción.
Arquitectura: `nginx (host, TLS) → api:3001 (Docker) → postgres + worker(s)` en red
interna; SPA en Netlify. Comandos asumen el `docker-compose.yml` del repo en el VPS.

> Antes de tocar nada: identifica **alcance** (¿un tenant o todos?) y **severidad**
> (§Severidades). Anota hora de inicio y acciones en el canal de incidentes.

---

## Severidades

| Sev | Definición | Respuesta |
| --- | --- | --- |
| **SEV1** | Caída total: API o Postgres abajo; ningún tenant opera | Inmediata, todo el equipo |
| **SEV2** | Un tenant sin servicio (bot caído), pagos fallando, error rate alto | < 30 min |
| **SEV3** | Degradación parcial, latencia, fallos intermitentes | Horario hábil |

---

## Diagnóstico inicial (siempre)

```bash
# Estado de contenedores y salud
docker compose ps
# API responde?
curl -s https://api.<dominio>/health        # esperado {"ok":true}
# Logs recientes por servicio
docker compose logs --tail=100 api
docker compose logs --tail=100 worker-<tenant>
docker compose logs --tail=50 postgres
# Recursos del host
df -h && free -m && uptime
```

---

## 1. Bot de WhatsApp caído / desvinculado (SEV2)

**Síntomas:** un tenant no recibe respuestas; `GET /wa-status` indica
desconectado; alerta de "bot caído".

1. Ver estado real desde la API (con sesión del tenant) o logs del worker:
   ```bash
   docker compose logs --tail=120 worker-<tenant>
   ```
2. Distinguir el caso:
   - **Caída temporal / reconexión:** Baileys reintenta con backoff. Esperar y
     confirmar reconexión en logs. Si no reconecta:
     ```bash
     docker compose restart worker-<tenant>
     ```
   - **`loggedOut` (sesión cerrada por el teléfono/Meta):** requiere **re-vincular
     QR**. Obtener el QR vía `GET /wa-status` (panel) o logs del worker y pedir al
     dueño que escanee desde WhatsApp → Dispositivos vinculados.
   - **Número bloqueado por Meta:** ver `docs/legal/whatsapp-baileys-disclaimer.md`;
     comunicar al cliente, no es recuperable por reinicio.
3. Si la sesión Baileys se corrompió: ver runbook de backup/restore para el estado
   del volumen, o forzar re-vinculación borrando la sesión (último recurso).

---

## 2. API caída / 5xx (SEV1)

1. `docker compose ps` → ¿`api` levantado y healthy?
2. `docker compose logs --tail=200 api` → buscar stacktrace o error de arranque
   (típico: migración fallida, `DATABASE_URL`, variable faltante).
3. ¿Postgres healthy? (ver §3). La API depende de él.
4. Reinicio controlado:
   ```bash
   docker compose up -d api
   ```
5. ¿nginx/TLS? Probar local dentro del host:
   ```bash
   curl -s http://localhost:3001/health
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Si `localhost:3001` responde pero el dominio no → problema en nginx/cert.

---

## 3. PostgreSQL no responde (SEV1)

1. ```bash
   docker compose ps postgres
   docker compose logs --tail=100 postgres
   docker compose exec postgres pg_isready -U intake -d intake
   ```
2. ¿Disco lleno? `df -h`. Si el volumen `pgdata` está al 100%, liberar espacio
   (rotar backups/logs) antes de reiniciar.
3. Reinicio:
   ```bash
   docker compose up -d postgres   # espera healthy
   docker compose up -d api worker-<tenant>
   ```
4. Si hay corrupción/pérdida → **restore** según
   `docs/runbooks/2026-06-18-backup-restore-drill.md`. Declarar SEV1 y comunicar.

---

## 4. OpenRouter sin saldo / 429 (SEV2)

**Síntomas:** el agente no responde; logs con 401/402/429 de OpenRouter; alerta de
"saldo bajo".

1. Verificar saldo y estado de la API key en el panel de OpenRouter.
2. Si es **saldo agotado:** recargar o subir el límite; el bot debe degradar con
   mensaje al cliente final y avisar al dueño (sin perder el mensaje entrante).
3. Si es **429 (rate limit):** transitorio; confirmar reintentos con backoff en
   logs. Si persiste, revisar `limits` y modelo en la config del tenant.
4. Revisar `limits.monthlyCostUsd` por si un tope se alcanzó.

---

## 5. Pago fallido / suscripción `past_due` (SEV2 de negocio)

1. Confirmar el evento en el dashboard de Stripe (`invoice.payment_failed`).
2. Verificar que el webhook llegó y actualizó `Subscription.status` (logs de la
   API; tabla `StripeEvent`/`Subscription`).
3. Durante el **periodo de gracia**, el servicio sigue; se notifica al cliente.
   Tras la gracia, el enforcement suspende el bot vía `TenantManager`.
4. Acción de soporte: contactar al cliente con el enlace al **Customer Portal**
   para que actualice el método de pago. Al pagar, el webhook reactiva el bot.

---

## 6. Error rate alto / degradación (SEV3)

1. Revisar el rastreador de errores (Sentry) filtrando por `tenantId`.
2. Correlacionar con despliegues recientes (`git log`, CI). Si un deploy lo causó →
   considerar rollback (ver go-live runbook §Rollback).
3. Revisar métricas (mensajes/min, latencia LLM, bots conectados).

---

## Escalamiento

| Situación | Escalar a |
| --- | --- |
| SEV1 (caída total) | Responsable técnico de guardia + dueño del producto |
| Pérdida potencial de datos | Responsable técnico + iniciar restore drill |
| Posible brecha de seguridad | Responsable + activar protocolo del DPA §7 (notificación) |
| Bloqueo de número por Meta | Soporte → comunicar al cliente (disclaimer Baileys) |

**Contactos:** [definir guardia / on-call y canal]. **Estado del incidente:**
registrar inicio, acciones, fin y causa raíz para post-mortem.

---

## Post-incidente

- Escribir un **post-mortem** breve (qué pasó, impacto, causa raíz, acciones).
- Crear tareas de prevención (alertas que faltaron, automatización, tests).
