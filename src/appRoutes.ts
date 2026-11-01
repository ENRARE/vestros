export const LANDING_PATH = '/'
export const APP_PATH = '/app'

function trimTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) return LANDING_PATH
  return pathname.replace(/\/+$/, '')
}

/**
 * Returns the legacy workspace pathname represented by an explicit /app route.
 * The helper intentionally accepts pathname only; query parameters stay in the
 * router location and continue to be handled by the existing navigation code.
 */
export function workspacePathname(pathname: string): string {
  const normalized = trimTrailingSlash(pathname)
  if (normalized === APP_PATH) return LANDING_PATH
  if (normalized.startsWith(`${APP_PATH}/`)) {
    return normalized.slice(APP_PATH.length) || LANDING_PATH
  }
  return normalized
}
