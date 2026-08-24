import type {
  ClientCodeSummary,
  CreateClientCodeInput,
  StaffGateway,
} from './staffGateway.js';

export interface CodeAdminSnapshot {
  readonly codes: readonly ClientCodeSummary[];
  readonly oneTimeCode: string | null;
}

export interface CodeAdminModel {
  getSnapshot(): CodeAdminSnapshot;
  load(): Promise<void>;
  create(input: CreateClientCodeInput): Promise<void>;
  revoke(codeId: string): Promise<void>;
  acknowledgeCodeCopied(): void;
}

export function createCodeAdminModel(gateway: StaffGateway): CodeAdminModel {
  let snapshot: CodeAdminSnapshot = Object.freeze({ codes: Object.freeze([]), oneTimeCode: null });
  let creating = false;

  const refreshCodes = async (): Promise<void> => {
    const codes = await gateway.listCodes();
    snapshot = Object.freeze({ ...snapshot, codes: Object.freeze([...codes]) });
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    load: refreshCodes,
    create: async (input: CreateClientCodeInput) => {
      if (snapshot.oneTimeCode !== null) {
        throw new Error('code_acknowledgment_required');
      }
      if (creating) throw new Error('code_creation_in_progress');
      creating = true;
      try {
        const created = await gateway.createCode(input);
        snapshot = Object.freeze({ ...snapshot, oneTimeCode: created.oneTimeCode });
        try {
          await refreshCodes();
        } catch {
          // The plaintext can never be retrieved again, so preserving its reveal takes priority.
        }
      } finally {
        creating = false;
      }
    },
    revoke: async (codeId: string) => {
      await gateway.revokeCode(codeId);
      await refreshCodes();
    },
    acknowledgeCodeCopied: () => {
      snapshot = Object.freeze({ ...snapshot, oneTimeCode: null });
    },
  });
}
