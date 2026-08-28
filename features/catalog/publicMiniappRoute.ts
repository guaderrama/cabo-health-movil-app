import type {
  CatalogPublicMiniapp,
  ExternalHttpsCatalogPublicMiniapp,
} from '../../constants/publicMiniapps';

export type PublicMiniappRoute = Readonly<
  | {
      pathname: '/apps/[slug]';
      params: Readonly<{ slug: string }>;
    }
  | {
      pathname: '/external-miniapp/[resourceId]';
      params: Readonly<{ resourceId: string }>;
    }
>;

export type ExternalMiniappRouteState = Readonly<
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; miniapp: Readonly<ExternalHttpsCatalogPublicMiniapp> }
>;

export interface ExternalMiniappExpectedDestination {
  readonly resourceId: string;
  readonly destinationUrl: string;
  readonly destinationOrigin: string;
}

export interface ExternalMiniappRouteInput {
  readonly resourceId: string | string[] | undefined;
  readonly catalog: readonly Readonly<CatalogPublicMiniapp>[];
  readonly isInitialLoading: boolean;
}

export interface ExternalMiniappRouteStateMachine {
  resolve(input: Readonly<ExternalMiniappRouteInput>): ExternalMiniappRouteState;
}

export function buildPublicMiniappRoute(
  miniapp: Readonly<CatalogPublicMiniapp>,
): PublicMiniappRoute {
  return miniapp.destinationKind === 'cabohealth'
    ? Object.freeze({
        pathname: '/apps/[slug]' as const,
        params: Object.freeze({ slug: miniapp.slug }),
      })
    : Object.freeze({
        pathname: '/external-miniapp/[resourceId]' as const,
        params: Object.freeze({ resourceId: miniapp.slug }),
      });
}

export function resolveExternalMiniappRouteState(input: Readonly<ExternalMiniappRouteInput & {
  expectedDestination?: Readonly<ExternalMiniappExpectedDestination>;
}>): ExternalMiniappRouteState {
  if (typeof input.resourceId !== 'string') return Object.freeze({ kind: 'unavailable' });
  const miniapp = input.catalog.find((candidate): candidate is Readonly<ExternalHttpsCatalogPublicMiniapp> => (
    candidate.slug === input.resourceId && candidate.destinationKind === 'external_https'
  ));
  if (miniapp) {
    const expected = input.expectedDestination;
    if (expected && (
      expected.resourceId !== miniapp.slug
      || expected.destinationUrl !== miniapp.destinationUrl
      || expected.destinationOrigin !== miniapp.destinationOrigin
    )) return Object.freeze({ kind: 'unavailable' });
    return Object.freeze({ kind: 'ready', miniapp });
  }
  return input.isInitialLoading
    ? Object.freeze({ kind: 'loading' })
    : Object.freeze({ kind: 'unavailable' });
}

export function createExternalMiniappRouteStateMachine(): Readonly<ExternalMiniappRouteStateMachine> {
  let expectedDestination: Readonly<ExternalMiniappExpectedDestination> | null = null;
  let isUnavailable = false;

  return Object.freeze({
    resolve(input: Readonly<ExternalMiniappRouteInput>): ExternalMiniappRouteState {
      if (isUnavailable) return Object.freeze({ kind: 'unavailable' });
      const state = resolveExternalMiniappRouteState({
        ...input,
        ...(expectedDestination ? { expectedDestination } : {}),
      });
      if (state.kind === 'ready') {
        if (expectedDestination === null) {
          expectedDestination = Object.freeze({
            resourceId: state.miniapp.slug,
            destinationUrl: state.miniapp.destinationUrl,
            destinationOrigin: state.miniapp.destinationOrigin,
          });
        }
        return state;
      }
      if (state.kind === 'unavailable' || expectedDestination !== null) {
        isUnavailable = true;
        return Object.freeze({ kind: 'unavailable' });
      }
      return state;
    },
  });
}
