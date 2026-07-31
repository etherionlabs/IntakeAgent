/**
 * Detección de idioma para el PRIMER mensaje del cliente.
 *
 * La bienvenida se manda como respuesta al primer mensaje, antes de que corra el
 * modelo: es un texto fijo y así el aviso de IA no depende de que el modelo se
 * acuerde de darlo. Eso deja fuera preguntarle al modelo en qué idioma escribió
 * el cliente — habría que pagar una llamada y esperar por ella para poder saludar.
 *
 * Así que es una heurística de palabras, con un sesgo deliberado: ante la duda
 * NO cambia de idioma. Saludar en español a un angloparlante es un tropiezo que
 * el modelo corrige en el turno siguiente; saludar en inglés a un tapicero de
 * Guadalajara porque escribió "ok" es peor y pasa más veces.
 */

export type Lang = 'es' | 'en';

/** Palabras frecuentes que NO se comparten entre los dos idiomas. */
const ES_WORDS = new Set([
  'hola', 'buenas', 'buenos', 'días', 'dias', 'tardes', 'noches', 'gracias', 'por', 'favor',
  'necesito', 'quiero', 'quisiera', 'busco', 'tengo', 'puedo', 'puede', 'pueden', 'saber',
  'cuánto', 'cuanto', 'cuesta', 'precio', 'precios', 'cotización', 'cotizacion', 'presupuesto',
  'para', 'con', 'una', 'unos', 'unas', 'del', 'los', 'las', 'que', 'qué', 'como', 'cómo',
  'dónde', 'donde', 'cuándo', 'cuando', 'muy', 'más', 'mas', 'pero', 'también', 'tambien',
  'negocio', 'trabajo', 'servicio', 'servicios', 'cliente', 'clientes', 'mensaje', 'mensajes',
  'ustedes', 'usted', 'nosotros', 'esto', 'esta', 'este', 'eso', 'hacer', 'hacen', 'hace',
  'me', 'te', 'le', 'lo', 'mi', 'su', 'es', 'son', 'está', 'estoy', 'soy', 'ser', 'tiene',
]);

const EN_WORDS = new Set([
  'hello', 'hi', 'hey', 'good', 'morning', 'afternoon', 'evening', 'thanks', 'thank', 'please',
  'need', 'want', 'looking', 'have', 'can', 'could', 'would', 'know', 'much', 'many',
  'how', 'what', 'where', 'when', 'why', 'which', 'who', 'price', 'pricing', 'cost', 'quote',
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'your', 'you',
  'business', 'work', 'service', 'services', 'customer', 'customers', 'message', 'messages',
  'is', 'are', 'was', 'im', 'am', 'do', 'does', 'did', 'about', 'from', 'get', 'help',
  'interested', 'more', 'info', 'information', 'tell', 'me', 'partner', 'program',
]);

// 'me' está en los dos idiomas: se descuenta para que no incline la balanza sola.
const AMBIGUOUS = new Set(['me', 'no', 'a', 'e', 'i', 'o', 'u', 'ok', 'okay', 'si', 'so', 'un']);

/** Señales que solo existen en español y valen por varias palabras. */
const ES_STRONG = /[ñáéíóúü¿¡]/i;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Idioma del texto, o `fallback` si no hay evidencia suficiente.
 *
 * `fallback` es el idioma del negocio: lo que se usa cuando el cliente manda una
 * foto sin texto, un "ok" o cualquier cosa que no distingue.
 */
export function detectLanguage(text: string | null | undefined, fallback: Lang): Lang {
  if (!text || !text.trim()) return fallback;

  // Un solo carácter español decide: 'ñ' o una tilde no aparecen escribiendo inglés.
  if (ES_STRONG.test(text)) return 'es';

  let es = 0;
  let en = 0;
  for (const w of words(text)) {
    if (AMBIGUOUS.has(w)) continue;
    if (ES_WORDS.has(w)) es += 1;
    if (EN_WORDS.has(w)) en += 1;
  }

  // Empate o silencio → no se cambia de idioma.
  if (en > es) return 'en';
  if (es > en) return 'es';
  return fallback;
}

/** Idioma del negocio a partir del `$language` del intake ('es-MX' → 'es'). */
export function langFromLocale(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'es';
}
