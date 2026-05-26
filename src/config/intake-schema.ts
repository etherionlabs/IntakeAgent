import { z } from 'zod';

const FieldTypeZ = z.enum([
  'string',
  'text',
  'integer',
  'number',
  'boolean',
  'enum',
  'multi_enum',
  'phone',
  'date',
  'currency',
]);

const FieldZ = z
  .object({
    key: z.string().regex(/^[a-z_][a-z0-9_]*$/i, 'key debe ser un identificador'),
    label: z.string().min(1),
    type: FieldTypeZ,
    required: z.boolean().default(false),
    hint: z.string().optional(),
    options: z.array(z.string().min(1)).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(
    (f) =>
      (f.type !== 'enum' && f.type !== 'multi_enum') ||
      (Array.isArray(f.options) && f.options.length > 0),
    { message: 'type enum/multi_enum requiere options no vacío' },
  );

const SectionZ = z.object({
  key: z.string().regex(/^[a-z_][a-z0-9_]*$/i),
  label: z.string().min(1),
  fields: z.array(FieldZ).min(1),
});

export const IntakeSchemaZ = z.object({
  $businessName: z.string().min(1),
  $businessDomain: z.string().min(1),
  $language: z.string().min(2).default('es-MX'),
  sections: z.array(SectionZ).min(1),
});

export type IntakeSchema = z.infer<typeof IntakeSchemaZ>;
export type IntakeSection = z.infer<typeof SectionZ>;
export type IntakeField = z.infer<typeof FieldZ>;

export type ValidationResult =
  | { ok: true; schema: IntakeSchema }
  | { ok: false; error: string };

export function validateIntakeSchema(input: unknown): ValidationResult {
  const parsed = IntakeSchemaZ.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  // Validación adicional: no duplicates dentro de sección
  const schema = parsed.data;
  for (const section of schema.sections) {
    const keys = section.fields.map((f) => f.key);
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) {
        return {
          ok: false,
          error: `key duplicada en sección "${section.key}": ${k}`,
        };
      }
      seen.add(k);
    }
  }
  return { ok: true, schema };
}

export function getFieldByPath(
  schema: IntakeSchema,
  path: string,
): IntakeField | null {
  const [sectionKey, fieldKey] = path.split('.');
  const section = schema.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  return section.fields.find((f) => f.key === fieldKey) ?? null;
}

export function listRequiredPaths(schema: IntakeSchema): string[] {
  const out: string[] = [];
  for (const s of schema.sections) {
    for (const f of s.fields) {
      if (f.required) out.push(`${s.key}.${f.key}`);
    }
  }
  return out;
}
