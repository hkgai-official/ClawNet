import { z } from 'zod';
import { UserInfoSchema } from './user';

export const AuthStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('loggedOut') }),
  z.object({ kind: z.literal('loggingIn') }),
  z.object({ kind: z.literal('loggedIn'), user: UserInfoSchema }),
]);
export type AuthState = z.infer<typeof AuthStateSchema>;

export const ConnectionStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
