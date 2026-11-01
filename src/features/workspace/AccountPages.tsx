import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import {
  AlertCircle, ArrowUpRight, BookOpen, Check, CheckCircle2, ExternalLink,
  FileText, LogOut, Network, Save, Settings2, ShieldCheck, WalletCards,
} from 'lucide-react'
import { toast } from 'sonner'
import { ACTIVE_ARC_CHAIN } from '@/arcChains'
import { CHAIN_ENV } from '@/networkConfig'
import { CONTRACT_ADDRESS, CONTRACT_CONFIG_ERROR, CONTRACT_DEPLOYED } from '@/contractConfig'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { getProfile, updateProfile } from '@/granthub/api'
import { useAuth } from '@/granthub/useAuth'
import { AuthBanner } from '@/granthub/components/AuthBanner'
import { GRANTHUB_FINANCIAL_ENABLED } from '@/granthub/feature-flags'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { AVATAR_PRESETS } from '@/features/profile/avatar'
import { useProfilePreferences } from '@/features/profile/ProfilePreferences'
import { SectionHeader } from '@/components/ui/Primitives'

export function SettingsPage() {
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr, signOut } = useAuth()
  const { avatarId, setAvatarId } = useProfilePreferences()
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [github, setGithub] = useState('')
  const [portfolio, setPortfolio] = useState('')
  const [skills, setSkills] = useState('')
  const [team, setTeam] = useState('')
  const [publicFields, setPublicFields] = useState<string[]>(['display_name', 'bio', 'skills'])
  const [loadedSessionAddr, setLoadedSessionAddr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sessionAddr) return

    let active = true
    void getProfile(sessionAddr).then(profile => {
      if (!active) return
      setDisplayName(profile.display_name ?? '')
      setBio(profile.bio ?? '')
      setGithub(profile.github ?? '')
      setPortfolio(profile.portfolio ?? '')
      setSkills((profile.skills ?? []).join(', '))
      setTeam((profile.team ?? []).join('\n'))
      setPublicFields(['display_name', 'bio', 'skills'].filter(field => profile[field as keyof typeof profile] !== undefined))
    }).catch(error => {
      if (active) toast.error((error as Error).message)
    }).finally(() => {
      if (active) setLoadedSessionAddr(sessionAddr)
    })
    return () => { active = false }
  }, [sessionAddr])

  const profileLoading = Boolean(sessionAddr && loadedSessionAddr !== sessionAddr)

  const togglePublic = (field: string) => setPublicFields(fields => fields.includes(field) ? fields.filter(value => value !== field) : [...fields, field])
  const save = async () => {
    if (!sessionAddr) return
    setSaving(true)
    try {
      await updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        github: github.trim(),
        portfolio: portfolio.trim(),
        skills: skills.split(',').map(value => value.trim()).filter(Boolean),
        team: team.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        public_fields: publicFields,
      })
      toast.success('Profile settings saved')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!walletAddr) {
    return (
      <div className="account-page max-w-5xl mx-auto px-6 py-6">
        <SectionHeader title="Settings" sub="Profile, wallet, and workspace controls" />
        <AuthBanner />
      </div>
    )
  }

  if (profileLoading) {
    return (
      <div className="account-page max-w-5xl mx-auto px-6 py-6">
        <SectionHeader title="Settings" sub="Profile, wallet, and workspace controls" />
        <div className="settings-card settings-loading">Loading profile settings...</div>
      </div>
    )
  }

  return (
    <div className="account-page max-w-5xl mx-auto px-6 py-6">
      <SectionHeader title="Settings" sub="Profile, wallet, and workspace controls" />

      <div className="settings-layout">
        <section className="settings-card settings-profile-card">
          <div className="settings-card-heading">
            <div>
              <p className="settings-eyebrow">Profile</p>
              <h2 className="display settings-card-title">Make the workspace yours.</h2>
            </div>
            <span className="settings-local-badge">Saved locally</span>
          </div>

          <div className="settings-profile-summary">
            <ProfileAvatar avatarId={avatarId} size={58} />
            <div className="min-w-0">
              <h3 className="settings-profile-name">{displayName || 'Wallet profile'}</h3>
              <p className="settings-profile-caption">{sessionAddr ? 'GrantHub profile connected' : 'Wallet preferences available'}</p>
              <p className="settings-wallet mono">{walletAddr}</p>
            </div>
          </div>

          <div className="settings-divider" />
          <div className="settings-section-heading">
            <div>
              <h3>Avatar</h3>
              <p>Choose a restrained profile mark for your account surfaces.</p>
            </div>
            <WalletCards size={16} />
          </div>
          <div className="avatar-picker" role="radiogroup" aria-label="Profile avatar">
            {AVATAR_PRESETS.map(option => {
              const selected = option.id === avatarId
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`avatar-option${selected ? ' is-selected' : ''}`}
                  onClick={() => setAvatarId(option.id)}
                  aria-pressed={selected}
                  aria-label={`Use ${option.label} avatar`}
                >
                  <ProfileAvatar avatarId={option.id} size={34} />
                  <span>{option.label}</span>
                  {selected && <Check size={13} aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <div className="settings-divider" />
          <div className="settings-section-heading">
            <div>
              <h3>GrantHub public profile</h3>
              <p>Profile details are server-backed and only editable after wallet sign-in.</p>
            </div>
            <FileText size={16} />
          </div>

          {sessionAddr ? (
            <>
              <div className="settings-form-grid">
                <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="Your name or project" />
                <Field label="GitHub" value={github} onChange={setGithub} placeholder="github.com/..." />
                <Field label="Portfolio" value={portfolio} onChange={setPortfolio} placeholder="https://..." />
                <Field label="Skills" value={skills} onChange={setSkills} placeholder="Solidity, research, design" hint="Comma-separated" />
              </div>
              <label className="settings-textarea-label">Bio<textarea value={bio} onChange={event => setBio(event.target.value)} rows={3} /></label>
              <label className="settings-textarea-label">Team members<textarea value={team} onChange={event => setTeam(event.target.value)} rows={3} placeholder="One name or address per line" /></label>
              <div className="settings-visibility">
                <p>Visible on your public profile</p>
                {[
                  ['display_name', 'Display name'], ['bio', 'Bio'], ['github', 'GitHub'],
                  ['portfolio', 'Portfolio'], ['skills', 'Skills'], ['team', 'Team'],
                ].map(([field, label]) => (
                  <label key={field}>
                    <input type="checkbox" checked={publicFields.includes(field)} onChange={() => togglePublic(field)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="settings-actions"><button type="button" onClick={() => void save()} disabled={saving} className="settings-primary-button"><Save size={13} /> {saving ? 'Saving...' : 'Save profile'}</button></div>
            </>
          ) : <AuthBanner />}
        </section>

        <div className="settings-side-stack">
          <section className="settings-card">
            <div className="settings-section-heading">
              <div><p className="settings-eyebrow">Network & environment</p><h2 className="display settings-card-title">Where Vestros is running</h2></div>
              <Network size={16} />
            </div>
            <div className="settings-rows">
              <SettingRow label="Environment">Arc {CHAIN_ENV}</SettingRow>
              <SettingRow label="Active chain">{ACTIVE_ARC_CHAIN.name} · {ACTIVE_ARC_CHAIN.id}</SettingRow>
              <SettingRow label="Vesting contract">
                <span className={CONTRACT_DEPLOYED ? 'settings-status-success' : 'settings-status-warning'}>{CONTRACT_DEPLOYED ? 'Configured' : 'Not configured'}</span>
              </SettingRow>
            </div>
            {CONTRACT_DEPLOYED ? (
              <a className="settings-inline-link" href={buildAddressExplorerUrl(ACTIVE_ARC_CHAIN.id, CONTRACT_ADDRESS)} target="_blank" rel="noopener noreferrer">View contract on explorer <ExternalLink size={12} /></a>
            ) : <p className="settings-note">{CONTRACT_CONFIG_ERROR}</p>}
          </section>

          <section className="settings-card">
            <div className="settings-section-heading">
              <div><p className="settings-eyebrow">Security</p><h2 className="display settings-card-title">Wallet and session</h2></div>
              <ShieldCheck size={16} />
            </div>
            <div className="settings-rows">
              <SettingRow label="Wallet">Connected</SettingRow>
              <SettingRow label="GrantHub session"><span className={sessionAddr ? 'settings-status-success' : 'settings-status-muted'}>{sessionAddr ? 'Authenticated' : 'Not signed in'}</span></SettingRow>
              <SettingRow label="Financial writes"><span className={GRANTHUB_FINANCIAL_ENABLED ? 'settings-status-warning' : 'settings-status-success'}>{GRANTHUB_FINANCIAL_ENABLED ? 'Operator enabled' : 'Paused by default'}</span></SettingRow>
            </div>
            {sessionAddr && <button type="button" onClick={signOut} className="settings-secondary-button"><LogOut size={13} /> Sign out of GrantHub</button>}
            <p className="settings-note">Wallet signatures are only requested for authenticated GrantHub actions.</p>
          </section>

          <section className="settings-card">
            <div className="settings-section-heading">
              <div><p className="settings-eyebrow">Workspace</p><h2 className="display settings-card-title">A clear starting point</h2></div>
              <Settings2 size={16} />
            </div>
            <div className="settings-rows">
              <SettingRow label="Public entry">/</SettingRow>
              <SettingRow label="Workspace entry">/app</SettingRow>
            </div>
            <p className="settings-note">Use the landing page for product context and the workspace for schedules, grants, treasury, and reporting.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="settings-field">
      {label}
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      {hint && <span>{hint}</span>}
    </label>
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="settings-row"><span>{label}</span><strong>{children}</strong></div>
}

function DocsSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return <section id={id} className="docs-section"><p className="docs-eyebrow">{eyebrow}</p><h2 className="display docs-section-title">{title}</h2>{children}</section>
}

function DocsList({ items }: { items: string[] }) {
  return <ul className="docs-list">{items.map(item => <li key={item}>{item}</li>)}</ul>
}

function DocsCallout({ tone, title, children }: { tone: 'success' | 'warning' | 'info'; title: string; children: ReactNode }) {
  return <div className={`docs-callout docs-callout-${tone}`}><div className="docs-callout-title"><CheckCircle2 size={15} />{title}</div><p>{children}</p></div>
}

export function HelpPage() {
  const quickLinks = [
    { label: 'Open My Vesting', to: '/vesting', icon: WalletCards },
    { label: 'Explore Grants', to: '/granthub', icon: BookOpen },
    { label: 'Create Grant Program', to: '/granthub/grants/new', icon: FileText },
    { label: 'Organisation Overview', to: '/granthub/dashboard', icon: Network },
    { label: 'Treasury', to: '/treasury', icon: ShieldCheck },
  ]

  return (
    <div className="docs-page max-w-6xl mx-auto px-6 py-6">
      <div className="docs-header">
        <div>
          <p className="docs-eyebrow">VESTROS / DOCUMENTATION</p>
          <h1 className="display docs-title">A clear guide to the workspace.</h1>
          <p className="docs-lead">Product workflows, environment notes, and the exact gates that matter before financial GrantHub operations move forward.</p>
        </div>
        <div className="docs-header-meta"><span>Arc {CHAIN_ENV}</span><span>Chain {ACTIVE_ARC_CHAIN.id}</span></div>
      </div>

      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="Documentation sections">
          <p>On this page</p>
          {[
            ['overview', 'Overview'], ['built', 'What has been built'], ['readiness', 'Mainnet readiness'],
            ['vesting-workflow', 'Vesting workflow'], ['granthub-workflow', 'GrantHub workflow'],
            ['restrictions', 'Financial restrictions'], ['quick-links', 'Quick links'],
          ].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </aside>

        <div className="docs-content">
          <DocsSection id="overview" eyebrow="01 / Overview" title="Infrastructure for schedules and decisions.">
            <div className="docs-overview-grid">
              <div className="docs-info-card"><WalletCards size={17} /><h3>Vestros</h3><p>USDC vesting infrastructure on Arc for teams, contributors, and beneficiaries. Track schedules, claims, unlocks, and treasury visibility from one workspace.</p></div>
              <div className="docs-info-card"><BookOpen size={17} /><h3>GrantHub</h3><p>Grant lifecycle management for organisations: programs, applications, reviews, approvals, awards, and funding state.</p></div>
              <div className="docs-info-card"><ShieldCheck size={17} /><h3>Operational clarity</h3><p>Analytics, reports, activity, organisation controls, and environment separation keep onchain and offchain work visible.</p></div>
            </div>
          </DocsSection>

          <DocsSection id="built" eyebrow="02 / Product surface" title="What has been built.">
            <div className="docs-built-grid">
              {[
                ['Core USDC Vesting', 'Owner-controlled schedules with cliff, linear unlocks, claims, revocation, and permission checks.'],
                ['Bulk Vesting', 'CSV template and import flow for preparing multiple schedules in sequence.'],
                ['Timeline, Treasury, Analytics', 'Read-only views for unlock forecasts, allocations, beneficiary breakdowns, and reporting.'],
                ['Grant Explorer and creation', 'Public discovery plus authenticated organisation grant drafts, publishing, editing, and closing.'],
                ['Applications and Review Queue', 'Structured applicant information, eligibility, reviewer notes, scoring, shortlist, approval, and rejection.'],
                ['Awards and pending funding', 'Approved records stay pending funding until independently verified financial activation.'],
                ['Authentication and sessions', 'Shared wallet-signature sessions persist across routes and are invalidated on wallet mismatch or expiry.'],
                ['Environment separation', 'Arc Testnet and Arc Mainnet chain, token, explorer, and contract settings are selected independently.'],
                ['Deployment readiness', 'Ledger/keystore signing guards, non-destructive migrations, verification tests, and rehearsal documentation are in place.'],
              ].map(([title, body]) => <div key={title} className="docs-built-item"><span className="docs-built-marker" /><div><h3>{title}</h3><p>{body}</p></div></div>)}
            </div>
          </DocsSection>

          <DocsSection id="readiness" eyebrow="03 / Launch gates" title="Mainnet readiness is conditional by design.">
            <DocsCallout tone="success" title="Core Vestros: conditional go">The core USDCVesting application and configuration are internally consistent for a controlled Arc Mainnet deployment. Mainnet still requires a fresh deployment, verified source, recorded address, and operator sign-off.</DocsCallout>
            <DocsCallout tone="warning" title="GrantHub financial features: conditional no-go">Discovery, organisations, grants, applications, reviews, and award records are available offchain. Deposits and onchain award activation remain disabled by default until the security, ownership, rehearsal, and production-auth gates are complete.</DocsCallout>
            <div className="docs-readiness-grid">
              <div><p className="docs-mini-label">Ready in the repository</p><DocsList items={['Separate Arc Testnet/Mainnet chain facts and explorer links.', 'Server-side financial flag defaults to disabled.', 'Receipt verification tests for deposits and award activation.', 'Ledger and encrypted keystore signing paths for mainnet deployment.']} /></div>
              <div><p className="docs-mini-label">Still required before launch</p><DocsList items={['Third-party GrantHub contract/security review.', 'Controlled live testnet deposit and activation rehearsal.', 'Multisig ownership for production pools and vesting control.', 'Production token revocation/rotation and shared rate limiting.']} /></div>
            </div>
            <div className="docs-sequence"><p className="docs-mini-label">Recommended deployment sequence</p><ol className="docs-steps"><li>Deploy and verify the mainnet vesting contract with an external signer.</li><li>Record mainnet contract and deployment transaction variables separately from testnet.</li><li>Complete the controlled Arc Testnet GrantHub rehearsal against exact pool and vesting addresses.</li><li>Reconcile legacy deposits and define confirmation/finality handling.</li><li>Complete review and multisig controls before any financial flag is enabled.</li></ol></div>
            <p className="docs-note">Current environment: Arc {CHAIN_ENV} · {ACTIVE_ARC_CHAIN.name} · chain {ACTIVE_ARC_CHAIN.id}. See the repository&apos;s mainnet-readiness and GrantHub rehearsal documents for operator checklists.</p>
          </DocsSection>

          <DocsSection id="vesting-workflow" eyebrow="04 / Vesting" title="From schedule creation to claim.">
            <div className="docs-workflow-grid">
              {[['01', 'Create schedule', 'Connect the beneficiary or owner wallet and create a schedule with amount, start, cliff, and vesting duration.'], ['02', 'Import in bulk', 'Prepare multiple rows with the CSV template, validate them, and import schedules in sequence.'], ['03', 'Track progress', 'Use My Vesting, Timeline, Treasury, Activity, Analytics, and Reports to follow chain-backed state.'], ['04', 'Claim funds', 'Beneficiaries claim only the onchain claimable amount after the schedule unlocks.']].map(([number, title, body]) => <div key={number} className="docs-workflow-item"><span>{number}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
            </div>
          </DocsSection>

          <DocsSection id="granthub-workflow" eyebrow="05 / GrantHub" title="A reviewable grant lifecycle.">
            <div className="docs-workflow-grid">
              {[['01', 'Create an organisation', 'The creator becomes the organisation administrator and can manage programs, reviewers, applications, and awards.'], ['02', 'Draft and publish', 'Create a draft grant with budget, dates, eligibility, deliverables, vesting terms, and custom questions, then publish it.'], ['03', 'Apply and review', 'Applicants submit structured proposals. Authorized reviewers inspect eligibility, project quality, feasibility, budget, and impact.'], ['04', 'Approve or reject', 'Owners and administrators make final decisions. Shortlist, request information, feedback, approval, and rejection are recorded.'], ['05', 'Pending award', 'Approved awards remain pending funding. They do not imply a transfer or activate a vesting schedule automatically.']].map(([number, title, body]) => <div key={number} className="docs-workflow-item"><span>{number}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
            </div>
          </DocsSection>

          <DocsSection id="restrictions" eyebrow="06 / Financial controls" title="Financial operations stay behind explicit gates.">
            <div className="docs-restriction-card"><AlertCircle size={18} /><div><h3>Funding and award activation are paused by default.</h3><p>The server rejects deposit, confirmation, and activation writes unless the authorized financial flag is enabled. UI notices belong only on relevant funding surfaces; discovery, applications, evaluation, and approval remain usable without financial writes.</p><p>When authorized, deposit confirmation independently verifies chain ID, transaction success, token, pool, sender, amount, and events. Award activation independently verifies the configured GrantVesting contract, funding transfer, beneficiary, amount, schedule, and event records before updating the database.</p></div></div>
          </DocsSection>

          <DocsSection id="quick-links" eyebrow="07 / Shortcuts" title="Open the workspace surface you need.">
            <div className="docs-quick-links">{quickLinks.map(link => { const Icon = link.icon; return <Link key={link.label} to={link.to} className="docs-quick-link"><Icon size={15} /><span>{link.label}</span><ArrowUpRight size={13} /></Link> })}</div>
            <a className="docs-repository-link" href="https://github.com/ENRARE/vestros" target="_blank" rel="noopener noreferrer">Open the Vestros repository <ExternalLink size={13} /></a>
          </DocsSection>
        </div>
      </div>
    </div>
  )
}
