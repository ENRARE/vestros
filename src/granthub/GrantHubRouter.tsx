import { Routes, Route, Navigate } from 'react-router-dom'
import { GrantExplorer } from './pages/GrantExplorer'
import { GrantDetail } from './pages/GrantDetail'
import { OrgProfile } from './pages/OrgProfile'
import { ApplyPage } from './pages/ApplyPage'
import { OrgDashboard } from './pages/OrgDashboard'
import { ReviewWorkspace } from './pages/ReviewWorkspace'
import { MyGrants } from './pages/MyGrants'
import { CreateGrant } from './pages/CreateGrant'
import { CreateOrg } from './pages/CreateOrg'
import { FundingPage } from '@/features/organization/FundingPage'
import { isGrantHubRouteComingSoon, type GrantHubRouteKey } from './featureAvailability'
import { ComingSoonOverlay } from '@/components/ui/ComingSoonOverlay'

/** Consistent page padding for all GrantHub routes */
function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-6 w-full space-y-4">{children}</div>
  )
}

function GrantHubRoute({ route, children }: { route: GrantHubRouteKey; children: React.ReactNode }) {
  return (
    <ComingSoonOverlay
      locked={isGrantHubRouteComingSoon(route)}
      dismissible={false}
      description="This feature is not available yet."
      secondaryText=""
      className="min-h-[calc(100vh-8rem)]"
    >
      <PageContainer>{children}</PageContainer>
    </ComingSoonOverlay>
  )
}

export function GrantHubRouter() {
  return (
    <Routes>
      <Route index element={<GrantHubRoute route="explorer"><GrantExplorer /></GrantHubRoute>} />
      <Route path="grants/new" element={<GrantHubRoute route="create-grant"><CreateGrant /></GrantHubRoute>} />
      <Route path="create" element={<GrantHubRoute route="create-grant"><CreateGrant /></GrantHubRoute>} />
      <Route path="grants/:id/edit" element={<GrantHubRoute route="create-grant"><CreateGrant /></GrantHubRoute>} />
      <Route path="grants/:id" element={<GrantHubRoute route="grant-detail"><GrantDetail /></GrantHubRoute>} />
      <Route path="orgs/new" element={<GrantHubRoute route="create-org"><CreateOrg /></GrantHubRoute>} />
      <Route path="orgs/:slug" element={<GrantHubRoute route="org-profile"><OrgProfile /></GrantHubRoute>} />
      <Route path="apply/:grantId" element={<GrantHubRoute route="apply"><ApplyPage /></GrantHubRoute>} />
      <Route path="dashboard" element={<GrantHubRoute route="dashboard"><OrgDashboard /></GrantHubRoute>} />
      <Route path="review/:id" element={<GrantHubRoute route="review"><ReviewWorkspace /></GrantHubRoute>} />
      <Route path="my" element={<GrantHubRoute route="my-grants"><MyGrants /></GrantHubRoute>} />
      <Route path="applications" element={<GrantHubRoute route="applications"><MyGrants /></GrantHubRoute>} />
      <Route path="awards" element={<GrantHubRoute route="awards"><MyGrants /></GrantHubRoute>} />
      <Route path="funding" element={<GrantHubRoute route="funding"><FundingPage /></GrantHubRoute>} />
      <Route path="*"            element={<Navigate to="" replace />} />
    </Routes>
  )
}
