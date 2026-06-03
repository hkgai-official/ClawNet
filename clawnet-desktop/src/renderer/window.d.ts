import type { ClawnetApi } from '../shared/clawnet-api';

declare global {
  interface Window {
    clawnet: ClawnetApi;
  }
}

export {};
