# Fase 6 — Legal, cumplimiento y go-to-market — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para aprobación
**Roadmap:** Fase 6 de `docs/ROADMAP-PRODUCCION.md` (cierra la brecha 9: "Sin capa legal")

> Spec maestro relacionado: `docs/superpowers/specs/2026-06-13-saas-deployment-design.md`.
> Specs hermanos: Fase 1 (`...-fase1-security-hardening-design.md`), Fase 3
> (`...-fase3-billing-stripe-design.md`), Fase 4
> (`...-fase4-self-service-onboarding-design.md`).
> Esta fase corre **en paralelo** desde la Fase 1 y debe estar verde **antes** de
> la Fase 7 (beta → lanzamiento): sus criterios de aceptación son parte del
> Go/No-Go.

---

## 1. Objetivo

Que el producto pueda **cobrar legalmente y venderse**: dotarlo de la capa
contractual (ToS + Privacidad), de cumplimiento de datos (retención, exportación
y borrado por tenant), de transparencia sobre el riesgo de WhatsApp/Baileys, y de
la superficie comercial (landing, documentación, email transaccional) que
convierte el self-service de la Fase 4 en un negocio.

La pregunta que guía cada decisión es: **"¿esto nos permite cobrarle a un cliente
sin asumir un riesgo legal o reputacional que no hayamos comunicado y deslindado
explícitamente?"**.

El punto delicado y específico de este producto: **procesamos datos personales de
TERCEROS** —los clientes finales del negocio (tenant) que escriben al WhatsApp del
bot— que ni firman nuestro contrato ni nos conocen. Eso nos coloca como
**encargado del tratamiento** y obliga a un reparto de responsabilidades claro
(§2). Y lo hacemos sobre **Baileys, una librería no oficial de WhatsApp** (§4),
que es un riesgo de negocio que hay que comunicar, no esconder.

**Alcance de esta fase:**
- Términos de Servicio + Política de Privacidad + aceptación registrada en signup (§2, §3).
- Endpoints de exportación y borrado de datos por tenant (§3).
- Política de uso de WhatsApp / cláusula de deslinde de Baileys (§4).
- Landing page con propuesta de valor, precios y CTA, desplegada en Netlify (§5).
- Documentación de cliente: guía de inicio, FAQ, soporte (§6).
- Email transaccional con proveedor (verificación, recuperación, avisos de pago) (§7).

**Fuera de alcance (deuda explícita):**
- Asesoría legal externa formal (recomendada, ver Decisiones abiertas) — esta
  fase entrega **borradores de ingeniería**, no documentos firmados por abogado.
- Migración a la **API oficial de WhatsApp Business** (deuda de negocio mayor,
  §4.4): aquí solo se documenta y se deslinda, no se migra.
- Certificaciones (SOC 2, ISO 27001): no aplican al tamaño actual.
- DPAs negociados individualmente por enterprise: se ofrece un DPA estándar
  incorporado por referencia en el ToS, no contratos a medida.

---

## 2. Roles de tratamiento: encargado vs. responsable

El modelo de datos del producto (verificado en `prisma/schema.prisma` y en el
spec maestro §3) almacena, **por `tenantId`**: `Contact` (teléfono E.164, nombre),
`Message` (contenido de los WhatsApp, media), `Job` + intake (datos del trabajo),
`AgentRun`/`CostEntry`. Casi todo eso son **datos personales de los clientes
finales del tenant**, no del tenant.

### 2.1 El reparto (lenguaje GDPR/LFPDPPP, adaptable a la jurisdicción de §"Decisiones abiertas")

| Parte | Rol | Qué decide / hace |
|-------|-----|-------------------|
| **El negocio (tenant)** | **Responsable del tratamiento** (*data controller*) | Decide **para qué** usa los datos de sus clientes (atender, levantar intake, dar seguimiento), obtiene la base legal/consentimiento de su cliente final, y es quien responde ante ese cliente final por sus derechos. |
| **Nosotros (Intake SaaS)** | **Encargado del tratamiento** (*data processor*) | Procesamos los datos **por cuenta y bajo instrucciones del tenant**, solo para prestarle el servicio. No usamos los datos de los clientes finales para fines propios. |
| **OpenRouter / proveedor LLM** | **Sub-encargado** | Recibe el contenido para generar respuestas/transcripción/visión. Debe declararse en la Política de Privacidad y en el DPA. |
| **Proveedor de email (§7)**, **Stripe (Fase 3)**, **VPS/hosting** | **Sub-encargados** | Cada uno con su propósito acotado; listados públicamente (§3.4). |

> **Consecuencia de diseño clave:** el ToS debe incluir (o incorporar por
> referencia) un **Acuerdo de Tratamiento de Datos (DPA)** que formalice que el
> tenant es responsable y nosotros encargado, liste los **sub-encargados**, y
> obligue al tenant a tener una base legal frente a sus clientes finales
> (incluido informarles de que un asistente automatizado atiende el WhatsApp).
> Sin esto, el tenant podría trasladarnos responsabilidades que son suyas.

### 2.2 Deslinde explícito hacia el tenant

El ToS debe dejar por escrito que **el tenant garantiza** que:
- tiene una relación legítima con sus clientes finales y base legal para
  tratarlos (es su lista de contactos, no comprada/spam);
- informará a sus clientes finales de que un asistente automatizado puede
  atenderlos por WhatsApp (transparencia hacia el interesado);
- no usará el bot para envío masivo no solicitado (anti-spam — además es lo que
  más dispara baneos de WhatsApp, §4).

Y que **nosotros nos deslindamos** del uso indebido que el tenant haga del canal.

### 2.3 Documentos a producir

| Documento | Dónde vive | Aceptación |
|-----------|-----------|-----------|
| **Términos de Servicio (ToS)** | `legal/terms.md` → render en landing (`/terms`) y SPA | Checkbox obligatorio en signup (§2.4) |
| **Política de Privacidad** | `legal/privacy.md` → `/privacy` | Enlazada desde signup; aceptada junto al ToS |
| **DPA (Acuerdo de Tratamiento de Datos)** | `legal/dpa.md`, incorporado por referencia en el ToS | Implícita al aceptar el ToS; descargable |
| **Política de uso de WhatsApp** (§4) | `legal/whatsapp-policy.md` → `/whatsapp-policy` | Checkbox **separado y explícito** en signup |

> Versionado: cada documento lleva `version` y `effectiveDate`. Un cambio
> material exige re-aceptación (§2.4). Los `.md` viven versionados en el repo; la
> landing y la SPA los renderizan, de modo que "publicar" = desplegar.

### 2.4 Aceptación registrada en el signup

El roadmap exige "Aceptación registrada en el signup". Se engancha al
`POST /auth/signup` de la Fase 4 (`api/src/routes/auth.ts`), **sin** crearlo de
nuevo: se añaden campos al contrato y una tabla de auditoría.

```
POST /auth/signup   (extiende el contrato de Fase 4)
  body: {
    ...campos de Fase 4 (email, password, businessName, industry)...
    acceptedTerms:        true,   // obligatorio; ToS + Privacidad + DPA
    acceptedWhatsappRisk: true,   // obligatorio y SEPARADO (§4)
    termsVersion:         "2026-06-18",
    whatsappPolicyVersion:"2026-06-18"
  }
  → 400 si falta cualquiera de las dos aceptaciones
```

Registro de auditoría (qué se aceptó, cuándo, desde dónde) — defendible si algún
día hay disputa:

```prisma
model LegalAcceptance {
  id          String   @id @default(uuid())
  tenantId    String
  userId      String                 // PanelUser que aceptó
  document    String                 // 'terms' | 'privacy' | 'dpa' | 'whatsapp_policy'
  version     String                 // versión del documento aceptada
  acceptedAt  DateTime @default(now())
  ipAddress   String?                // evidencia de aceptación
  userAgent   String?
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
}
```

- La transacción de creación de tenant (Fase 4 §4.2) escribe **una fila por
  documento aceptado** dentro del mismo `$transaction`: o se crea el tenant **con**
  su rastro de aceptación, o no se crea.
- **Re-aceptación**: si la `version` vigente de un documento es mayor que la
  última aceptada por el tenant, un middleware ligero marca un flag y la SPA pide
  re-aceptar antes de seguir operando (banner bloqueante no destructivo). Es la
  misma idea de "estado espejo" que el enforcement de la Fase 3.

---

## 3. Cumplimiento de datos: retención, exportación y borrado por tenant

Objetivo: que el tenant (como responsable) pueda ejercer —y trasladar a sus
clientes finales— los **derechos de acceso y borrado** tipo GDPR, y que tengamos
una **política de retención** explícita en vez de "se guarda todo para siempre".

### 3.1 Política de retención

| Dato | Retención por defecto | Justificación |
|------|----------------------|---------------|
| `Message` (contenido + media) | **Configurable por tenant**, default 12 meses | Es lo más sensible (conversaciones de terceros). El tenant elige; nunca infinito por defecto. |
| `Job` + intake | Mientras la suscripción esté activa + 30 días | El intake es el "producto" que el negocio usa. |
| `Contact` | Mientras la suscripción esté activa | Identidad del cliente final. |
| `AgentRun` / `CostEntry` | 24 meses | Control interno de margen (Fase 3); puede anonimizarse antes. |
| `LegalAcceptance` | Permanente (mientras exista el tenant) + plazo legal tras baja | Evidencia legal; no se borra con el resto. |
| Backups (`pg_dump`, Fase 1/spec maestro §8.2) | 7 días (rolling) | El borrado se propaga a backups por expiración del ciclo, documentado. |

- **Job de retención**: tarea programada (cron en el host o worker periódico) que
  borra `Message`/media más viejos que la ventana del tenant. Reutiliza el media
  store del worker. Idempotente y por `tenantId`.
- **Baja del tenant** (cancelación en Fase 3 → `canceled`): periodo de gracia
  (p. ej. 30 días) en el que los datos siguen disponibles para exportar; tras él,
  borrado completo automático (§3.3), salvo `LegalAcceptance`.

### 3.2 Exportación de datos por tenant (derecho de acceso)

Endpoint nuevo en la API central, **solo rol `admin` del tenant**, filtrado por
el `tenantId` del JWT (regla de aislamiento del spec maestro §3 — ninguna query
sin `tenantId`).

```
POST /tenant/data-export
  auth: JWT (admin)
  → 202 { jobId }                 // exportación asíncrona (puede ser grande)

GET  /tenant/data-export/:jobId
  → { status: 'pending'|'ready'|'failed', downloadUrl?, expiresAt? }
```

- Genera un **archivo ZIP** con un JSON por entidad (`contacts.json`,
  `jobs.json`, `messages.json`, `agent_runs.json`) **solo del `tenantId`** y la
  media referenciada. Estructura documentada (portabilidad).
- Asíncrono: para tenants con histórico grande no bloquea el request. El
  resultado se sirve por una URL firmada y de **expiración corta** (p. ej. 24 h),
  nunca pública permanente.
- Auditado: cada export deja rastro (`tenantId`, `userId`, `at`).

### 3.3 Borrado de datos por tenant (derecho al olvido)

Dos granularidades —el GDPR/LFPDPPP del cliente final suele necesitar la fina:

```
DELETE /tenant/contacts/:contactId/data
  auth: JWT (admin)
  → 200   // borra/anonimiza UN cliente final (su Contact + Messages + Jobs)

POST /tenant/data-deletion
  auth: JWT (admin)
  body: { confirm: businessName }   // confirmación explícita anti-accidente
  → 202 { jobId }                   // borrado total del tenant, asíncrono
```

- **Borrado de un cliente final** (caso típico: "tu cliente pidió que borres sus
  datos"): elimina `Contact` + sus `Message`/media + `Job`. Si hay obligación de
  conservar el `Job` por razones contables del negocio, se **anonimiza** el
  contacto (se desvincula el teléfono/nombre) en vez de romper integridad.
- **Borrado total del tenant**: borra todo lo del `tenantId` **excepto**
  `LegalAcceptance` y lo mínimo de `Subscription` que la contabilidad/Stripe
  exija. Conlleva `TenantManager.removeTenant(tenantId)` (Fase 2) para cerrar la
  conexión Baileys y borrar su sesión.
- **Backups**: el borrado en caliente no toca los `pg_dump` ya hechos; se
  documenta que la propagación a backups ocurre por **expiración del retention de
  backups** (7 días). Esto debe decirse en la Política de Privacidad para no
  prometer un borrado instantáneo que no es real.
- Todo borrado: confirmación explícita, asíncrono si es masivo, auditado, e
  **idempotente** (re-ejecutar no falla).

### 3.4 Transparencia en la Política de Privacidad

La `legal/privacy.md` debe, como mínimo:
- declarar **qué datos** se tratan (contenido de WhatsApp de terceros, teléfono,
  intake) y **con qué finalidad** (prestar el servicio al tenant);
- listar **sub-encargados** con su propósito: **OpenRouter** (LLM/transcripción/
  visión — el contenido de los mensajes sale hacia él), **Stripe** (pagos),
  proveedor de **email** (§7), **hosting/VPS** y **Netlify**;
- explicar la **retención** (§3.1) y **cómo ejercer** acceso/borrado (§3.2–3.3),
  incluyendo el matiz de los backups;
- nombrar la **jurisdicción** aplicable (Decisión abierta) y un **contacto de
  privacidad** (email).

---

## 4. Política de uso de WhatsApp: el riesgo de Baileys (transparencia y deslinde)

> **Este es el mayor riesgo de negocio del producto y debe comunicarse con total
> transparencia, no minimizarse.**

### 4.1 El hecho técnico

El producto se conecta a WhatsApp mediante **Baileys** (verificado en el README
y en el spec maestro §4: vinculación por QR, sesión en `data/baileys-session/`,
una sesión por tenant). Baileys es una **librería no oficial** que implementa el
protocolo de WhatsApp Web; **no es la API oficial de WhatsApp Business (Cloud
API)**. WhatsApp **no autoriza** clientes no oficiales y sus Términos permiten
**suspender o banear** números que los usen, especialmente ante envío masivo,
patrones automatizados o reportes de spam.

### 4.2 Por qué es un riesgo real para el cliente

- El número de WhatsApp del **negocio** (no uno nuestro) puede ser **baneado** —
  perdería su WhatsApp, no solo el bot.
- Una desconexión o ban **interrumpe el servicio** sin que esté en nuestra mano
  evitarlo del todo (mitigamos con reconexión y alertas — Fase 1 §1.3, pero no
  podemos garantizar contra una decisión de WhatsApp).
- Es **probabilístico**: depende del volumen, del comportamiento (no spamear) y
  de WhatsApp. No hay forma de eliminarlo mientras usemos Baileys.

### 4.3 Cómo lo comunicamos y deslindamos (sin letra chica oculta)

- **Documento dedicado** `legal/whatsapp-policy.md`, enlazado desde la landing
  (`/whatsapp-policy`) y el signup, en lenguaje claro: "Usamos una conexión **no
  oficial** a WhatsApp. WhatsApp podría suspender el número del negocio. Reduce el
  riesgo: no envíes mensajes masivos no solicitados, etc.".
- **Aceptación SEPARADA y explícita en el signup** (`acceptedWhatsappRisk`, §2.4)
  — no enterrada dentro del ToS. El cliente reconoce el riesgo de forma
  consciente; es nuestra mejor defensa de "lo sabías".
- **Cláusula de limitación** en el ToS: el servicio se presta "tal cual"
  respecto a la disponibilidad de WhatsApp; no garantizamos que WhatsApp no
  suspenda el número; no somos responsables de un ban derivado del uso del canal
  por el tenant.
- **Buenas prácticas anti-ban** en la guía de inicio (§6): empezar despacio,
  responder solo a quien escribe primero, no comprar listas, etc. (esto también
  protege nuestro margen y reputación).
- **Operativamente** (ya en Fase 1): alertar al dueño ante desconexión y
  documentar la re-vinculación; **respaldar/proteger** la sesión por tenant.

### 4.4 Deuda de negocio: migrar a la API oficial (recomendado a futuro)

Se debe registrar como **deuda explícita** evaluar la migración a la **WhatsApp
Business Cloud API** (oficial, vía Meta o un BSP como Twilio/360dialog):
- **A favor:** sin riesgo de ban por cliente no oficial; estabilidad; legitimidad
  comercial; plantillas aprobadas para notificaciones.
- **En contra:** costo por conversación, proceso de verificación del negocio
  (Meta Business), aprobación de plantillas, y restricción de la ventana de 24 h
  para mensajes de servicio. Encaja con la capa de canal de la Fase 2
  (`OutboundSender`/`InboundSource`): WhatsApp-oficial sería **otra
  implementación** del mismo contrato, no un rewrite.
- **Recomendación:** lanzar con Baileys (transparencia + deslinde como arriba) y
  **planificar la migración a la API oficial** como la pieza que reduce el mayor
  riesgo del negocio una vez validado el producto. No bloquea el lanzamiento;
  sí debe estar en el roadmap post-lanzamiento.

---

## 5. Landing page (Netlify)

Superficie comercial pública. Se despliega en **Netlify** junto a la SPA o como
sitio aparte; encaja con el `netlify.toml` existente (build de `spa/`, SPA
fallback a `index.html`).

### 5.1 Contenido

- **Propuesta de valor**: "Recepcionista autónomo de WhatsApp que atiende a tus
  clientes, levanta los datos del trabajo y te avisa cuando algo está listo"
  (alineado con el README). Enfoque por vertical (tapicería, paquetería,
  genérico).
- **Cómo funciona** (3 pasos): te registras → vinculas tu WhatsApp → el bot
  atiende y tú ves todo en el panel.
- **Precios**: el plan mensual fijo de la Fase 3 (monto/intervalo — Decisión
  abierta del roadmap #4). Una sola tarjeta de precio + qué incluye + trial
  (según decisión de Fase 4).
- **CTA a signup**: botón → `/signup` de la SPA (Fase 4).
- **Aviso de transparencia de WhatsApp**: enlace visible a `/whatsapp-policy`
  (§4) — no se esconde el modelo Baileys ni en la venta.
- **Pie**: enlaces a `/terms`, `/privacy`, contacto/soporte.

### 5.2 Implementación y deploy

| Opción | Cómo | Recomendación |
|--------|------|---------------|
| **A — Ruta dentro de la SPA** | `/` (landing) + `/signup`, `/login`, `/terms`, `/privacy`, `/whatsapp-policy` como rutas públicas; los `legal/*.md` se renderizan con un componente de Markdown. | **Recomendada para el MVP**: un solo deploy, reutiliza el `netlify.toml` y el design system existente; los documentos legales viven en el repo y "publicar" = desplegar. |
| **B — Sitio estático aparte** | Generador estático separado, dominio raíz; la SPA queda en `app.`/`panel.`. | Mejor SEO/marketing a futuro; más infra. Deuda, no MVP. |

> Con la Opción A, el `netlify.toml` (SPA fallback `/* → /index.html`) ya sirve;
> el router de la SPA distingue rutas públicas (landing, signup, legales) de las
> protegidas. La única var de entorno sigue siendo `VITE_API_URL` (spec maestro §6).

---

## 6. Documentación de cliente

Para reducir soporte y fricción de onboarding (alimenta la beta de la Fase 7).

- **Guía de inicio** (`docs/cliente/guia-inicio.md`, render en la SPA/landing):
  cómo registrarse, **cómo vincular WhatsApp con el QR** (paso a paso, con el
  matiz de "usa el teléfono del negocio"), cómo configurar el bot (giro,
  bienvenida, schema de intake — el wizard de Fase 4), y **buenas prácticas
  anti-ban** (§4.3).
- **FAQ**: ¿pueden banear mi número? (sí, ver política — honesto); ¿qué pasa si
  el bot se desconecta?; ¿cómo cancelo?; ¿quién ve los mensajes de mis clientes?
  (encargado del tratamiento, §2); ¿cómo exporto/borro datos? (§3); ¿qué modelos
  de IA usan? (OpenRouter).
- **Soporte**: canal **email** (`soporte@<dominio>`) y un **WhatsApp de soporte**
  del propio equipo, con horario y SLA orientativo. Documentado en la SPA
  (sección de ayuda) y en el pie de la landing. (El runbook de soporte e
  incidentes formal vive en la Fase 7.)

---

## 7. Email transaccional

El producto necesita correo transaccional fiable para: **verificación de email**
y **recuperación de contraseña** (Fases 1 y 4 ya lo asumen y dejan el hook —
Fase 4 §4.4 prevé un `EmailService` en `api/src/email/`), y **avisos de pago**
(Fase 3 deja el hook explícito: dunning de `invoice.payment_failed`,
`past_due`, cancelación).

### 7.1 Proveedor

| Proveedor | A favor | Contra |
|-----------|---------|--------|
| **Resend** | DX moderna, plantillas React, setup rápido | Más nuevo |
| **Postmark** | Excelente entregabilidad transaccional, simple | Estricto con marketing (bien: solo transaccional) |
| **Amazon SES** | Barato a escala | Más fontanería (reputación, sandbox inicial) |

> **Recomendación:** **Resend o Postmark** para el lanzamiento (entregabilidad y
> velocidad de integración sobre costo, dado el volumen inicial bajo). SES como
> destino si el volumen crece. La decisión final es de §"Decisiones abiertas".

### 7.2 Diseño

- **`EmailService`** (`api/src/email/`) con interfaz `send(template, to, vars)`,
  una sola implementación por proveedor detrás de la interfaz (mismo patrón de
  contrato/implementación que `OutboundSender`). El proveedor se elige por env
  (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`), **nunca** claves en código ni
  en logs (regla de secretos de Fase 1 §1.2).
- **Plantillas mínimas**: verificación de email, bienvenida, recuperación de
  contraseña, **aviso de pago fallido**, **aviso de suscripción cancelada/por
  vencer**. Cada una con versión y enlace a soporte.
- **Dominio verificado** (SPF + DKIM + DMARC) para entregabilidad. Solo correo
  **transaccional** (no marketing) desde este remitente.
- **Idempotencia/robustez**: el envío no debe tumbar el request principal (p. ej.
  el signup no falla si el correo tarda); reintentos del proveedor; bounces
  visibles para soporte.

---

## 8. Criterios de aceptación

- [ ] **ToS + Política de Privacidad publicados** (renderizados desde `legal/*.md`
      en `/terms` y `/privacy`) y **aceptados en el signup** (criterio del roadmap).
- [ ] El ToS incorpora (o referencia) un **DPA** que establece el reparto
      **tenant = responsable / nosotros = encargado**, lista los **sub-encargados**
      (OpenRouter, Stripe, email, hosting, Netlify) y obliga al tenant a tener base
      legal frente a sus clientes finales.
- [ ] La **aceptación queda registrada** en `LegalAcceptance` (documento + versión
      + timestamp + IP/UA), dentro de la transacción de creación del tenant.
- [ ] Existe una **aceptación separada y explícita del riesgo de WhatsApp/Baileys**
      (`acceptedWhatsappRisk`) en el signup, no enterrada en el ToS.
- [ ] La **Política de uso de WhatsApp** (`/whatsapp-policy`) comunica con
      transparencia el modelo Baileys (no oficial), el riesgo de ban del número del
      negocio y el deslinde; está enlazada desde la landing y el signup.
- [ ] La **migración a la API oficial de WhatsApp** queda registrada como deuda de
      negocio explícita en el roadmap (no se construye en esta fase).
- [ ] **Un tenant puede exportar sus datos** (`POST /tenant/data-export`,
      asíncrono, ZIP por entidad solo de su `tenantId`, URL firmada y expirable) —
      criterio del roadmap.
- [ ] **Un tenant puede solicitar borrado**: de un cliente final concreto
      (`DELETE /tenant/contacts/:id/data`) y total del tenant
      (`POST /tenant/data-deletion` con confirmación), ambos por `tenantId`,
      auditados e idempotentes; el borrado total dispara `removeTenant` (Fase 2).
- [ ] **Política de retención** implementada (job programado que purga
      `Message`/media según la ventana del tenant) y documentada en Privacidad,
      incluido el matiz de propagación a backups.
- [ ] **Landing en vivo** en Netlify con propuesta de valor, **precios** del plan
      de Fase 3 y **CTA a signup** funcionando (criterio del roadmap).
- [ ] **Documentación de cliente** publicada: guía de inicio (incluye vincular el
      QR y buenas prácticas anti-ban), FAQ y canal de soporte (email + WhatsApp).
- [ ] **Email transaccional** integrado con un proveedor (verificación,
      recuperación, **avisos de pago**), con dominio verificado (SPF/DKIM/DMARC) y
      claves solo por env; reutilizable por Fases 1, 3 y 4.

---

## 9. Decisiones abiertas

1. **Jurisdicción / país objetivo** *(la decisión que más condiciona el resto)* —
   define el marco legal aplicable (¿GDPR de la UE? ¿LFPDPPP de México? ¿CCPA de
   EE. UU.?), la ley que rige el ToS, los textos de derechos de los interesados,
   los plazos de retención obligatorios y la fiscalidad de Stripe (coincide con la
   Decisión abierta #5 del roadmap: "mercado/moneda/impuestos"). **Hay que fijarla
   antes de redactar los textos definitivos.**
2. **¿Asesoría legal externa?** — esta fase entrega **borradores de ingeniería**
   de ToS/Privacidad/DPA/política de WhatsApp. ¿Se valida con un abogado de la
   jurisdicción elegida antes de cobrar? **Recomendación: sí**, dado que tratamos
   datos de terceros y operamos sobre un canal no oficial (Baileys) — el costo de
   un error legal supera el de la consulta.
3. **Ventana de retención por defecto** — el default de `Message` (propuesto: 12
   meses) y el periodo de gracia tras baja (propuesto: 30 días): ¿se confirman?
   ¿el tenant puede ampliarlos o solo reducirlos?
4. **Proveedor de email** — Resend vs. Postmark vs. SES (§7.1). Recomendación:
   Resend/Postmark para el lanzamiento. Definir el remitente y el dominio.
5. **Landing: ruta en la SPA (Opción A) o sitio aparte (Opción B)** — recomendado
   A para el MVP. ¿Se confirma, o marketing exige un sitio separado para SEO?
6. **¿Migración a la API oficial de WhatsApp como roadmap comprometido o solo
   evaluación?** — y, si se compromete, ¿BSP (Twilio/360dialog) o Meta directo?
   (afecta el mensaje de la landing: cuánta confianza vendemos sobre estabilidad).
7. **Canal y SLA de soporte** — ¿qué horario/tiempo de respuesta se promete en la
   FAQ y la landing? (sobreprometer soporte es una deuda operativa para la Fase 7).
