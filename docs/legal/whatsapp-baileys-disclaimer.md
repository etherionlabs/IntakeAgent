> **BORRADOR — requiere revisión por un profesional legal antes de su uso. No
> constituye asesoría jurídica.**

# Aviso y aceptación de riesgo — Integración con WhatsApp (Baileys)

**Aplica a:** todos los Clientes ("tenants") que usen el canal de WhatsApp de
Intake. La aceptación de este aviso se registra durante el alta (signup) de forma
**separada** de los Términos de Servicio.

---

## 1. Qué tecnología usamos

El canal de WhatsApp de Intake funciona mediante **Baileys**, una biblioteca que
se conecta a WhatsApp a través del mecanismo de **"dispositivos vinculados"**
(el mismo que usa WhatsApp Web). **No** utilizamos, en esta versión, la **API
oficial de WhatsApp Business (Cloud API)** de Meta.

---

## 2. Riesgos que el Cliente acepta

Al usar el canal de WhatsApp, el Cliente entiende y acepta que:

1. **Riesgo de suspensión o bloqueo del número.** Meta puede limitar, suspender o
   bloquear el número de WhatsApp del Cliente en cualquier momento, incluso sin
   previo aviso, por sus propias políticas. El uso de automatización mediante una
   integración no oficial puede aumentar ese riesgo.
2. **Sin garantía de disponibilidad ni de entrega.** El servicio depende de la
   infraestructura de Meta y del estado de la sesión vinculada. Pueden producirse
   desconexiones, retrasos o pérdidas de mensajes ajenos al control de Intake.
3. **Cumplimiento de las políticas de WhatsApp/Meta.** El Cliente es responsable
   del contenido que envía y de cumplir los términos de WhatsApp (incluyendo
   reglas sobre mensajería no solicitada). Intake no es responsable del uso que el
   Cliente haga del canal.
4. **Titularidad del número.** El número de WhatsApp pertenece al Cliente; la
   vinculación se realiza desde su teléfono mediante código QR. El Cliente puede
   desvincular el dispositivo en cualquier momento.
5. **Re-vinculación.** Ante una desconexión o cierre de sesión, puede ser
   necesario volver a escanear el QR para restablecer el servicio.

---

## 3. Lo que Intake sí hace

- Reconexión automática cuando es técnicamente posible y alertas cuando el bot
  queda desconectado (ver roadmap de confiabilidad).
- Aislamiento de la sesión por Cliente y resguardo del estado de sesión.
- Transparencia sobre el estado de conexión en el panel.

Estas medidas **reducen** pero **no eliminan** los riesgos del §2.

---

## 4. Limitación de responsabilidad

En la máxima medida permitida por la ley aplicable, **Intake no será responsable**
de pérdidas derivadas de la suspensión, bloqueo o indisponibilidad del número de
WhatsApp del Cliente impuestas por Meta o causadas por factores fuera del control
razonable de Intake. Esta cláusula se interpreta junto con la limitación de
responsabilidad de los Términos de Servicio.

---

## 5. Mejora futura: API oficial

Intake evalúa ofrecer, como mejora futura, la **API oficial de WhatsApp Business**
para Clientes que requieran mayor estabilidad y cumplimiento formal. Esta opción
podría implicar requisitos adicionales (verificación de empresa, plantillas
aprobadas) y costos distintos. No constituye un compromiso de fecha.

---

## 6. Aceptación

Marcando la casilla correspondiente durante el alta, el Cliente declara haber
leído y aceptado este aviso de riesgo. Fecha de aceptación e identidad quedan
registradas (tabla `LegalAcceptance`).

**[Nombre legal de la empresa]** — [Email de contacto].
