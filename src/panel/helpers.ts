import type { HelperOptions } from 'handlebars';

export const handlebarsHelpers = {
  /** Formato fecha-hora corto. */
  date(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  /** Devuelve un humano "hace 3 minutos" tipo. */
  ago(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '—';
    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'hace un momento';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} d`;
  },

  /** Pretty-print JSON. */
  json(obj: unknown): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  },

  /** Truncado a N caracteres con elipsis. */
  truncate(s: unknown, n: number): string {
    const str = String(s ?? '');
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + '…';
  },

  /** Comparador para usar en {{#if (eq a b)}} */
  eq(a: unknown, b: unknown): boolean {
    return a === b;
  },

  /** Status humano del job. */
  statusLabel(status: string): string {
    switch (status) {
      case 'OPEN_INTAKE':
        return 'En captura';
      case 'READY_FOR_REVIEW':
        return 'Listo para revisar';
      case 'IN_PROGRESS':
        return 'En curso (humano)';
      case 'CLOSED':
        return 'Cerrado';
      default:
        return status;
    }
  },

  /** Clase tailwind para color de status. */
  statusClass(status: string): string {
    switch (status) {
      case 'OPEN_INTAKE':
        return 'bg-blue-100 text-blue-800';
      case 'READY_FOR_REVIEW':
        return 'bg-amber-100 text-amber-800';
      case 'IN_PROGRESS':
        return 'bg-green-100 text-green-800';
      case 'CLOSED':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  },

  /** Indicador de modo de atención (chip). */
  attentionMode(
    botActive: boolean,
    flagged: boolean,
    jobStatus: string | null,
  ): { label: string; cls: string; icon: string } {
    if (flagged)
      return { label: 'No intake', cls: 'bg-red-100 text-red-800', icon: '⚠️' };
    if (!botActive)
      return { label: 'IA pausada', cls: 'bg-gray-200 text-gray-800', icon: '⏸️' };
    if (jobStatus === 'IN_PROGRESS')
      return {
        label: 'Humano atendiendo',
        cls: 'bg-purple-100 text-purple-800',
        icon: '👤',
      };
    return { label: 'IA activa', cls: 'bg-emerald-100 text-emerald-800', icon: '🟢' };
  },

  /** Operador `not` para condicionales. */
  not(v: unknown): boolean {
    return !v;
  },

  /** "or" lógico. */
  or(a: unknown, b: unknown, _opts: HelperOptions): unknown {
    return a || b;
  },
};
