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

/** Consistent page padding for all GrantHub routes */
function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-6 w-full">{children}</div>
}

export function GrantHubRouter() {
  return (
    <Routes>
      <Route index               element={<PageContainer><GrantExplorer /></PageContainer>} />
      <Route path="grants/new"   element={<PageContainer><CreateGrant /></PageContainer>} />
      <Route path="grants/:id"   element={<PageContainer><GrantDetail /></PageContainer>} />
      <Route path="orgs/new"     element={<PageContainer><CreateOrg /></PageContainer>} />
      <Route path="orgs/:slug"   element={<PageContainer><OrgProfile /></PageContainer>} />
      <Route path="apply/:grantId" element={<PageContainer><ApplyPage /></PageContainer>} />
      <Route path="dashboard"    element={<PageContainer><OrgDashboard /></PageContainer>} />
      <Route path="review/:id"   element={<PageContainer><ReviewWorkspace /></PageContainer>} />
      <Route path="my"           element={<PageContainer><MyGrants /></PageContainer>} />
      <Route path="*"            element={<Navigate to="" replace />} />
    </Routes>
  )
}
