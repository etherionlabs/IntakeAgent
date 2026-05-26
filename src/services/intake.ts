import type { IntakeSchema } from '../config/intake-schema';

export interface FieldState {
  value: string | number | boolean | null;
  asked: boolean;
  declined?: boolean;
  declined_reason?: string;
  updated_at?: string;
  source_message_id?: string;
}

export interface FreeNote {
  text: string;
  added_at: string;
  source_message_id: string | null;
}

export interface IntakeState {
  [section: string]: Record<string, FieldState> | { photo_count: number; audio_count: number } | FreeNote[];
  media: { photo_count: number; audio_count: number };
  free_notes: FreeNote[];
  // Narrow section access: access via string keys gives the union type above,
  // but explicit media/free_notes are known to be their specific types
}

export function createEmptyIntakeFromSchema(schema: IntakeSchema): IntakeState {
  const intake: IntakeState = {
    media: { photo_count: 0, audio_count: 0 },
    free_notes: [],
  };
  for (const section of schema.sections) {
    const sec: Record<string, FieldState> = {};
    for (const field of section.fields) {
      sec[field.key] = { value: null, asked: false };
    }
    intake[section.key] = sec;
  }
  return intake;
}
