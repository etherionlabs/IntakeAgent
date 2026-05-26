# Smoke test manual — WhatsApp adapter (Plan 4)

Verifica que el adapter Baileys funciona end-to-end con un número real.

## Pre-requisitos

- `.env` con `OPENROUTER_API_KEY` válido (sin él el agente no responde, pero la
  conexión y persistencia sí se verifican).
- `config.json` apuntando al perfil y con `owner.phoneE164` (tu número personal).
- Un teléfono extra (o segundo dispositivo) con WhatsApp para probar como "cliente".

## Pasos

1. **Arrancar el proceso**

   ```bash
   npm start
   ```

   En la primera ejecución, Baileys imprime un código QR en la terminal.
   Escanéalo desde **WhatsApp Web** del número que actuará como "bot".

2. **Esperar `whatsapp.connected`** en los logs.

3. **Enviar "Hola" al número del bot desde el teléfono cliente.**

   - El bot debería responder con el `welcome.txt` del perfil.
   - Espera 5 segundos (debouncer).
   - El agente debería responder pidiendo más datos.

4. **Verificar que el job está en DB**

   ```bash
   npx prisma studio
   ```

   Abre la tabla `Job` — deberías ver una fila con `status='OPEN_INTAKE'`.

5. **Completar el intake conversando.**

   Cuando todos los `required` estén satisfechos, el bot pedirá confirmación
   y al confirmarse cambiará el job a `READY_FOR_REVIEW`.
   Tu número de dueño debería recibir un mensaje con el resumen.

6. **Probar reconexión**

   Cierra el proceso con Ctrl+C. Vuelve a `npm start`. Debería reconectarse sin
   pedir QR de nuevo (sesión persistida en `./data/baileys-session/`).

7. **Probar logout**

   Cierra sesión de WhatsApp Web manualmente desde el teléfono del bot
   (Ajustes → Dispositivos vinculados → cerrar sesión).
   El proceso pasará a estado `logged_out` y NO intentará reconectar.
   Para volver a usarlo, borra `./data/baileys-session/` y reinicia.

## Troubleshooting

- **No aparece QR** → revisa logs. Si dice `whatsapp.qr_required` pero no se imprime
  el QR ASCII, problema con `qrcode-terminal`. Re-instala: `npm i qrcode-terminal`.
- **`makeWASocket is not a function`** → la importación debe ser **named export**
  (`import { makeWASocket } from 'baileys'`), no default. Ya está corregido en T7.
- **Reconexión infinita** → mira el código de `DisconnectReason` en los logs. Si es
  `loggedOut`, borra `./data/baileys-session/` y reinicia.
- **No responde aunque está conectado** → revisa `bot_active` en la tabla `Contact`
  y `flagged_non_intake`. Verifica que el agente reciba un `OPENROUTER_API_KEY` válido.
- **Whisper no transcribe audios** → verifica que `OPENROUTER_API_KEY` esté en el env
  y que `config.media.transcribeAudio=true`.

## Notas

- La sesión persistida (`./data/baileys-session/`) está gitignored.
- En Windows, si Ctrl+C no cierra correctamente, usa el Task Manager.
- Los logs van a stdout en formato JSON (pino). Para verlos legibles: `npm start | npx pino-pretty`.
