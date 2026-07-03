> **BORRADOR — requiere revisión por un profesional legal antes de su uso. No
> constituye asesoría jurídica.** Los textos entre corchetes `[ ]` son
> marcadores de posición que deben completarse antes de publicar.

# Política de Privacidad — Intake

**Responsable del servicio:** [Nombre legal de la empresa] ("Intake", "nosotros").
**Domicilio:** [Domicilio]. **Contacto de privacidad:** [Email de contacto].
**Fecha de vigencia:** [Fecha de vigencia].

Esta Política explica cómo Intake trata datos personales cuando un negocio (el
"Cliente" o "tenant") usa el servicio para atender por WhatsApp (y, en el futuro,
SMS y voz) a sus propios clientes finales.

---

## 1. Dos roles distintos de datos

Intake procesa **dos categorías** de datos personales con roles legales
distintos:

1. **Datos de la cuenta del Cliente** (el dueño del negocio y sus usuarios del
   panel): aquí Intake actúa como **responsable** del tratamiento.
2. **Datos de los clientes finales** del negocio (las personas que escriben al
   WhatsApp del negocio): aquí Intake actúa como **encargado del tratamiento**,
   siguiendo las instrucciones del Cliente, que es el **responsable**. El detalle
   de este tratamiento se rige por el **Acuerdo de Tratamiento de Datos (DPA)**
   (`docs/legal/dpa.md`).

---

## 2. Qué datos recogemos

**De la cuenta del Cliente:**
- Datos de registro: nombre del negocio, email, contraseña (almacenada como
  *hash* bcrypt), industria.
- Datos de facturación gestionados por nuestro procesador de pagos (ver §5).
- Datos técnicos: logs de acceso, dirección IP, eventos del panel.

**De los clientes finales del Cliente (como encargados):**
- Número de teléfono en formato E.164 y nombre mostrado en WhatsApp.
- Contenido de los mensajes (texto, imágenes, audios) y sus transcripciones/
  descripciones generadas por IA.
- Datos del "intake" del trabajo que el Cliente decide recoger (definidos por el
  Cliente en su perfil).

No solicitamos intencionadamente categorías especiales de datos; el Cliente es
responsable de no inducir a sus clientes finales a compartirlas.

---

## 3. Para qué usamos los datos y base legal

| Finalidad | Base legal (orientativa) |
| --- | --- |
| Prestar el servicio (atender mensajes, levantar el intake, notificar al dueño) | Ejecución del contrato / instrucciones del responsable |
| Autenticación y seguridad del panel | Interés legítimo / contrato |
| Facturación y prevención de fraude | Obligación legal / contrato |
| Soporte y comunicaciones del servicio | Interés legítimo / contrato |
| Mejora del servicio (métricas agregadas, no contenido identificable) | Interés legítimo |

> El encuadre exacto de base legal depende de [Jurisdicción] y debe confirmarse
> con asesoría legal.

No usamos el contenido de los mensajes de los clientes finales para entrenar
modelos propios ni los vendemos.

---

## 4. Procesamiento por IA

El contenido se envía a proveedores de modelos de IA (ver §5) únicamente para
generar respuestas, transcribir audios y describir imágenes, en el marco de la
prestación del servicio. Estos proveedores actúan como subencargados.

---

## 5. Subencargados y terceros

Para operar usamos proveedores que pueden tratar datos por cuenta nuestra:

| Proveedor | Finalidad | Datos implicados |
| --- | --- | --- |
| OpenRouter (y los modelos que enruta) | LLM, transcripción de audio, descripción de imágenes | Contenido de mensajes |
| Twilio (cuando se activen SMS/voz) | Envío/recepción de SMS y llamadas | Teléfono, contenido |
| Stripe | Procesamiento de pagos | Datos de facturación del Cliente |
| [Proveedor de email transaccional] | Verificación de email, avisos | Email del Cliente |
| [Proveedor de hosting/VPS] | Infraestructura | Todos |

La lista vigente de subencargados se mantiene en el DPA. Notificaremos los
cambios materiales conforme al DPA.

---

## 6. Conservación

- Datos de cuenta y de negocio: mientras la cuenta esté activa y durante
  [periodo de retención] tras la baja, salvo obligación legal de conservarlos más.
- Datos de clientes finales: según las instrucciones del Cliente y la política de
  retención del DPA; el Cliente puede solicitar exportación o borrado.
- Backups: se conservan hasta [retención de backups] y luego se rotan.

---

## 7. Transferencias internacionales

Si los datos se tratan fuera de [Jurisdicción] (por ejemplo, por proveedores en
otra región), se aplicarán las garantías exigidas por la ley aplicable. [Detallar
mecanismos según jurisdicción.]

---

## 8. Seguridad

Aplicamos medidas razonables: cifrado en tránsito (TLS), contraseñas con *hash*,
aislamiento por tenant, acceso restringido, backups y registro de eventos. Ningún
sistema es 100% seguro; ver también el aviso sobre WhatsApp/Baileys
(`docs/legal/whatsapp-baileys-disclaimer.md`).

---

## 9. Derechos de los titulares

Según la ley aplicable, los titulares pueden ejercer derechos de acceso,
rectificación, supresión, oposición y portabilidad. Para datos de **clientes
finales**, las solicitudes deben dirigirse al **Cliente** (responsable); Intake
asistirá al Cliente para atenderlas. Para datos de **cuenta**, escribe a
[Email de contacto].

---

## 10. Cambios

Podemos actualizar esta Política. Publicaremos la versión vigente con su fecha y,
si el cambio es material, lo comunicaremos por un medio razonable.

---

## 11. Contacto

[Nombre legal de la empresa] — [Domicilio] — [Email de contacto].
