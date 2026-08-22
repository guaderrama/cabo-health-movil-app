import { redirectClientResourceSystemPath } from '../features/clientAccess/clientResourceDeepLink';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return redirectClientResourceSystemPath(path);
}
