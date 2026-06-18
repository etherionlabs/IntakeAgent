/** Deriva el teléfono E.164 de un JID de Baileys ("549...:12@s.whatsapp.net"). */
export function extractPhoneFromJid(jid: string): string | null {
  const m = jid.match(/^(\d+)/);
  return m ? `+${m[1]}` : null;
}
