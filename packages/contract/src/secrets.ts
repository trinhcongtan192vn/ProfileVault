import { z } from 'zod';

/** Tên khóa bí mật trong `secrets.bin` (SPEC-00 §5). */
export const SecretKeySchema = z.enum(['fury.token', 'hmac.key', 'llm.apiKey']);
export type SecretKey = z.infer<typeof SecretKeySchema>;
export const SECRET_KEYS = SecretKeySchema.options;
