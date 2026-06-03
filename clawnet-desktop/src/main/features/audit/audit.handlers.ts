import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { AuditService } from './audit.service';

export function registerAuditHandlers(router: IpcRouter, svc: AuditService): void {
  router.register('audit.events.list', {
    input: Requests['audit.events.list'].input,
    output: Requests['audit.events.list'].output,
    handler: async ({ limit, offset }) => svc.list({ limit, offset }),
  });
}
