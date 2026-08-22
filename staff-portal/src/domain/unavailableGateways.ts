import type { AuditGateway } from './auditLog.js';
import type { CatalogDraftGateway } from './catalogDrafts.js';

export class StaffCapabilityUnavailableError extends Error {
  constructor() {
    super('staff_capability_unavailable');
    this.name = 'StaffCapabilityUnavailableError';
  }
}

export function createUnavailableCatalogDraftGateway(): CatalogDraftGateway {
  const unavailable = async (): Promise<never> => {
    throw new StaffCapabilityUnavailableError();
  };
  return Object.freeze({
    list: unavailable,
    create: unavailable,
    update: unavailable,
    archive: unavailable,
  });
}

export function createUnavailableAuditGateway(): AuditGateway {
  return Object.freeze({
    list: async () => {
      throw new StaffCapabilityUnavailableError();
    },
  });
}
