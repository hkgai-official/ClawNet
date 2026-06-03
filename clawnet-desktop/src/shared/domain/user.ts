import { z } from 'zod';

export const UserInfoSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().optional(),
  userCode: z.string().optional(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});
export type UserInfo = z.infer<typeof UserInfoSchema>;
