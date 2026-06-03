import { randomUUID } from 'node:crypto';

const id = randomUUID();

export const InstanceIdentity = {
  get(): string {
    return id;
  },
};
