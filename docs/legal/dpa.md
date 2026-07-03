> **BORRADOR — requiere revisión por un profesional legal antes de su uso. No
> constituye asesoría jurídica.** Los textos entre corchetes `[ ]` son
> marcadores de posición que deben completarse antes de firmar.

# Acuerdo de Tratamiento de Datos (DPA) — Intake

Este Acuerdo de Tratamiento de Datos ("DPA") forma parte de los Términos de
Servicio entre [Nombre legal de la empresa] ("Intake", **Encargado**) y el
negocio que contrata el servicio (el "Cliente", **Responsable**), y regula el
tratamiento de datos personales de los clientes finales del Cliente.

**Fecha de vigencia:** la del contrato principal. **Jurisdicción:** [Jurisdicción].

---

## 1. Roles

- El **Cliente** es el **Responsable**: determina las finalidades y medios del
  tratamiento de los datos de sus clientes finales.
- **Intake** es el **Encargado**: trata esos datos **solo** siguiendo las
  instrucciones documentadas del Cliente (el uso del servicio constituye dichas
  instrucciones), salvo obligación legal.

---

## 2. Objeto, duración, naturaleza y finalidad

- **Objeto:** prestación del servicio de recepción y gestión de mensajes
  (WhatsApp y, en su caso, SMS/voz) y levantamiento del intake.
- **Duración:** mientras esté vigente el contrato principal, más el periodo de
  borrado del §8.
- **Naturaleza y finalidad:** recepción, almacenamiento, transcripción/
  descripción por IA, generación de respuestas y notificación al dueño.

## 3. Tipos de datos y categorías de titulares

- **Titulares:** clientes finales del Cliente que contactan al negocio.
- **Datos:** número de teléfono (E.164), nombre de WhatsApp, contenido de
  mensajes (texto/imagen/audio), transcripciones/descripciones, y los campos de
  intake definidos por el Cliente.
- El Cliente se compromete a no usar el servicio para tratar categorías
  especiales de datos salvo que tenga base legal y lo instruya por escrito.

---

## 4. Obligaciones de Intake (Encargado)

1. Tratar los datos solo según las instrucciones del Cliente.
2. Garantizar la confidencialidad del personal autorizado.
3. Aplicar medidas técnicas y organizativas adecuadas (ver §6).
4. Respetar las condiciones para recurrir a subencargados (§5).
5. Asistir al Cliente, en la medida posible, para atender solicitudes de derechos
   de los titulares.
6. Asistir al Cliente en la seguridad, notificación de brechas y evaluaciones de
   impacto, según la ley aplicable.
7. A elección del Cliente, suprimir o devolver los datos al final (§8).
8. Poner a disposición la información necesaria para demostrar cumplimiento.

---

## 5. Subencargados

El Cliente **autoriza** el uso de los subencargados listados en la Política de
Privacidad (§5) — incluyendo, de forma orientativa: OpenRouter, Twilio, Stripe,
[proveedor de email] y [proveedor de hosting]. Intake:

- Impondrá a cada subencargado obligaciones de protección equivalentes.
- Notificará con antelación razonable los cambios de subencargados, dando al
  Cliente la posibilidad de objetar por motivos razonables.
- Responderá del cumplimiento de sus subencargados.

---

## 6. Seguridad

Medidas mínimas: cifrado en tránsito (TLS); contraseñas con *hash*; aislamiento
lógico por `tenantId`; control de acceso por roles; registro de eventos; backups
cifrados/controlados; principio de mínimo privilegio. El detalle operativo puede
evolucionar manteniendo un nivel de protección equivalente o superior.

---

## 7. Brechas de seguridad

Intake notificará al Cliente **sin demora indebida** tras tener conocimiento de
una violación de seguridad que afecte a los datos del Cliente, con la información
razonablemente disponible para que el Cliente cumpla sus obligaciones de
notificación.

---

## 8. Devolución y supresión

Al terminar el servicio, y a elección del Cliente, Intake **suprimirá o
devolverá** los datos personales del Cliente y eliminará las copias existentes,
salvo que la ley exija conservarlas, en un plazo de [plazo de borrado] y sin
perjuicio de la rotación normal de backups.

---

## 9. Auditoría

Intake pondrá a disposición del Cliente la información razonable para demostrar
cumplimiento y permitirá auditorías proporcionadas, con preaviso y sujeto a
confidencialidad, sin comprometer la seguridad de otros clientes.

---

## 10. Transferencias internacionales

Cuando aplique, las partes implementarán los mecanismos de transferencia exigidos
por [Jurisdicción]. [Detallar.]

---

## 11. Limitación específica del canal WhatsApp

El Cliente reconoce el aviso sobre el uso de Baileys
(`docs/legal/whatsapp-baileys-disclaimer.md`): el canal de WhatsApp depende de un
tercero (Meta) y de una integración no oficial, con riesgos que escapan al
control de Intake. Esta limitación se entiende sin perjuicio de las obligaciones
de protección de datos de este DPA.

---

## 12. Prelación

En caso de conflicto entre este DPA y el contrato principal respecto al
tratamiento de datos personales, prevalece este DPA.

**[Nombre legal de la empresa]** — Encargado · **Cliente** — Responsable.
