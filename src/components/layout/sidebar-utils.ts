import type { NavGroup, NavItem, NavRole } from './navConfig'
import { workspacePathname } from '../../appRoutes.ts'

export function navTarget(item: NavItem): string {
  return item.query ? `${item.to}?tab=${encodeURIComponent(item.query)}` : item.to
}

function normalizePath(pathname: string): string {
  if (pathname.length <= 1) return '/'
  return pathname.replace(/\/+$/, '')
}

function pathPatternScore(pattern: string, pathname: string): number {
  const patternParts = normalizePath(pattern).split('/').filter(Boolean)
  const pathParts = normalizePath(pathname).split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return -1

  let score = patternParts.length * 10
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]
    const pathPart = pathParts[index]
    if (patternPart === '*') return score
    if (patternPart.startsWith(':')) continue
    if (patternPart !== pathPart) return -1
    score += 100
  }
  return score + pattern.length
}

function matchingPathScore(item: NavItem, pathname: string): { score: number; primary: boolean } | null {
  const pathnames = [pathname, workspacePathname(pathname)]
  let primaryScore = -1
  for (const candidate of pathnames) {
    primaryScore = Math.max(primaryScore, pathPatternScore(item.to, candidate))
  }
  if (primaryScore >= 0) return { score: primaryScore, primary: true }

  let bestAlternate = -1
  for (const pattern of item.activePaths ?? []) {
    for (const candidate of pathnames) {
      bestAlternate = Math.max(bestAlternate, pathPatternScore(pattern, candidate))
    }
  }
  return bestAlternate >= 0 ? { score: bestAlternate, primary: false } : null
}

export function isNavItemActive(item: NavItem, pathname: string, search: string): boolean {
  const pathMatch = matchingPathScore(item, pathname)
  if (!pathMatch) return false
  if (!item.query || !pathMatch.primary) return true

  const tab = new URLSearchParams(search).get('tab') ?? 'overview'
  return tab === item.query
}

export function visibleNavGroups(groups: NavGroup[], roles: Set<NavRole>): NavGroup[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => item.roles.some(role => roles.has(role))),
    }))
    .filter(group => group.items.length > 0)
}

export function searchNavGroups(groups: NavGroup[], query: string): NavGroup[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return groups

  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => (
        item.label.toLowerCase().includes(normalized) ||
        group.label.toLowerCase().includes(normalized)
      )),
    }))
    .filter(group => group.items.length > 0)
}

export function activeNavGroupId(groups: NavGroup[], pathname: string, search: string): string | null {
  const activeItemId = activeNavItemId(groups, pathname, search)
  return groups.find(group => group.items.some(item => item.id === activeItemId))?.id ?? null
}

export function activeNavItemId(groups: NavGroup[], pathname: string, search: string): string | null {
  const matches = groups.flatMap((group, groupIndex) => group.items
    .map((item, itemIndex) => {
      const pathMatch = matchingPathScore(item, pathname)
      if (!pathMatch) return null
      if (item.query && pathMatch.primary) {
        const tab = new URLSearchParams(search).get('tab') ?? 'overview'
        if (tab !== item.query) return null
      }
      return {
        id: item.id,
        groupIndex,
        itemIndex,
        score: pathMatch.score + (item.query ? 50 : 0),
      }
    })
    .filter((match): match is { id: string; groupIndex: number; itemIndex: number; score: number } => match !== null))

  matches.sort((a, b) => b.score - a.score || a.groupIndex - b.groupIndex || a.itemIndex - b.itemIndex)
  return matches[0]?.id ?? null
}
