/** Applications, profiles, review decisions, and workflow history. */
import { db, auditLog, notify } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'
import { blocksDuplicateApplication, canMakeFinalApplicationDecision, formatUsdcRaw, isGrantAcceptingApplications, parseRawUsdc, parseUsdcRaw } from '../granthub-utils'

type AppRow = {
  id: string; grant_id: string; applicant_addr: string; applicant_name: string
  email: string; country: string; applicant_type: string; github_url: string
  portfolio_url: string; project_name: string; summary: string; problem: string
  solution: string; project_category: string; development_stage: string
  tech_stack: string; ecosystem_benefit: string; use_of_funds: string
  budget_breakdown: string; completion_date: number | null; previous_experience: string
  custom_answers: string; attachments: string; requested_raw: number
  milestones: string; status: string; submitted_at: number | null
  created_at: number; updated_at: number; grant_title?: string; org_id?: string
  org_name?: string
}
type GrantRow = {
  id: string; org_id: string; title: string; status: string
  declared_budget: number; min_award: number; max_award: number
  start_date: number | null; deadline: number | null; end_date: number | null
  custom_questions: string; allow_multiple_applications: number
}
type ProfileRow = {
  address: string; display_name: string; bio: string; github: string
  portfolio: string; skills: string; team: string; public_fields: string
  updated_at: number
}
type ReviewRow = {
  id: string; application_id: string; reviewer_addr: string; score: number | null
  comment: string; decision: string | null; criteria_scores: string
  eligibility_checks: string; created_at: number; updated_at: number
}

const REVIEW_CRITERIA = [
  'eligibility', 'project_quality', 'feasibility', 'ecosystem_relevance',
  'budget_justification', 'team_capability', 'expected_impact',
]

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return JSON.parse(value ?? '') as T } catch { return fallback }
}

function orgRole(orgId: string, address: string): string | null {
  const row = db.prepare<{ role: string }, [string, string]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`,
  ).get(orgId, address.toLowerCase())
  return row?.role ?? null
}

function isOrgMember(orgId: string, address: string, roles: string[]): boolean {
  const role = orgRole(orgId, address)
  return role != null && roles.includes(role)
}

function fmtReview(review: ReviewRow) {
  return {
    ...review,
    notes: review.comment,
    criteria_scores: parseJson<Record<string, number>>(review.criteria_scores, {}),
    eligibility_checks: parseJson<string[]>(review.eligibility_checks, []),
  }
}

function fmtApp(a: AppRow, viewerRole?: 'admin' | 'reviewer') {
  const milestones = parseJson<unknown[]>(a.milestones, [])
  const links = milestones
    .filter((m): m is { label: string; value: string } =>
      typeof m === 'object' && m !== null && typeof (m as { label?: unknown }).label === 'string' &&
      typeof (m as { value?: unknown }).value === 'string')
    .filter(m => m.label === 'repo_url' || m.label === 'demo_url' || m.label.startsWith('link_'))
    .map(m => m.value)
  const attachmentLinks = parseJson<Array<{ url?: string }>>(a.attachments, [])
    .map(item => item.url).filter((url): url is string => Boolean(url))

  return {
    ...a,
    milestones,
    custom_answers: parseJson<Record<string, string>>(a.custom_answers, {}),
    attachments: parseJson<Array<{ name: string; url: string }>>(a.attachments, []),
    project_title: a.project_name,
    description: a.summary,
    requested_amount: formatUsdcRaw(a.requested_raw),
    links: [...new Set([...links, ...attachmentLinks])],
    ...(viewerRole ? { viewer_role: viewerRole } : {}),
  }
}

function grantForApplication(grantId: string): GrantRow | null {
  return db.prepare<GrantRow, string>(`SELECT * FROM grants WHERE id = ?`).get(grantId) ?? null
}

function validateUrl(value: string, label: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return `${label} must use http or https`
  } catch { return `${label} must be a valid URL` }
  return null
}

function applicationStatusError(grant: GrantRow): string | null {
  if (!isGrantAcceptingApplications(grant.status)) return 'Grant is not accepting applications'
  const now = Math.floor(Date.now() / 1000)
  if (grant.start_date != null && now < grant.start_date) return 'Applications are not open yet'
  const close = grant.deadline ?? grant.end_date
  if (close != null && now > close) return 'The application deadline has passed'
  return null
}

function normalizeMilestones(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object').slice(0, 50)
}

function normalizeLinks(value: unknown): Array<{ label: string; value: string }> {
  return String(value ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    .slice(0, 20).map((value, index) => ({ label: `link_${index + 1}`, value }))
}

function normalizedApplication(body: Record<string, unknown>, existing?: AppRow) {
  const get = (key: string, alias?: string) => body[key] ?? (alias ? body[alias] : undefined)
  const rawValue = get('requested_raw', 'requested_amount')
  const requestedRaw = rawValue == null || String(rawValue).trim() === ''
    ? existing?.requested_raw ?? 0
    : body.requested_raw != null ? parseRawUsdc(rawValue) : parseUsdcRaw(rawValue)
  const milestones = body.milestones != null
    ? normalizeMilestones(body.milestones)
    : existing ? parseJson<unknown[]>(existing.milestones, []) : normalizeLinks(body.links)
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter(item => item && typeof item === 'object').slice(0, 20)
    : existing ? parseJson<unknown[]>(existing.attachments, []) : []
  const customAnswers = body.custom_answers && typeof body.custom_answers === 'object'
    ? body.custom_answers : existing ? parseJson<Record<string, string>>(existing.custom_answers, {}) : {}

  return {
    applicantName: String(get('applicant_name') ?? existing?.applicant_name ?? '').trim(),
    email: String(get('email') ?? existing?.email ?? '').trim(),
    country: String(get('country') ?? existing?.country ?? '').trim(),
    applicantType: String(get('applicant_type') ?? existing?.applicant_type ?? 'individual').trim(),
    githubUrl: String(get('github_url') ?? existing?.github_url ?? '').trim(),
    portfolioUrl: String(get('portfolio_url') ?? existing?.portfolio_url ?? '').trim(),
    projectName: String(get('project_name', 'project_title') ?? existing?.project_name ?? '').trim(),
    summary: String(get('summary', 'description') ?? existing?.summary ?? '').trim(),
    problem: String(get('problem') ?? existing?.problem ?? '').trim(),
    solution: String(get('solution') ?? existing?.solution ?? '').trim(),
    projectCategory: String(get('project_category') ?? existing?.project_category ?? '').trim(),
    developmentStage: String(get('development_stage') ?? existing?.development_stage ?? '').trim(),
    techStack: String(get('tech_stack') ?? existing?.tech_stack ?? '').trim(),
    ecosystemBenefit: String(get('ecosystem_benefit') ?? existing?.ecosystem_benefit ?? '').trim(),
    useOfFunds: String(get('use_of_funds') ?? existing?.use_of_funds ?? '').trim(),
    budgetBreakdown: String(get('budget_breakdown') ?? existing?.budget_breakdown ?? '').trim(),
    completionDate: get('completion_date') == null
      ? existing?.completion_date ?? null : Number(get('completion_date')) || null,
    previousExperience: String(get('previous_experience') ?? existing?.previous_experience ?? '').trim(),
    requestedRaw, milestones, customAnswers, attachments,
  }
}

function validateApplication(
  value: ReturnType<typeof normalizedApplication>,
  grant: GrantRow,
  isSubmit: boolean,
): string | null {
  if (!isSubmit) return null
  const required: Array<[string, string]> = [
    ['applicantName', 'full name or team representative'], ['email', 'email'],
    ['country', 'country'], ['projectName', 'project name'], ['summary', 'project description'],
    ['problem', 'problem statement'], ['solution', 'proposed solution'],
    ['projectCategory', 'project category'], ['developmentStage', 'development stage'],
    ['techStack', 'technology stack'], ['ecosystemBenefit', 'ecosystem benefit'],
    ['useOfFunds', 'use of funds'], ['budgetBreakdown', 'budget breakdown'],
  ]
  for (const [key, label] of required) if (!value[key as keyof typeof value]) return `${label} is required`
  if (!['individual', 'team'].includes(value.applicantType)) return 'Applicant type is invalid'
  if (!Number.isSafeInteger(value.completionDate) || (value.completionDate ?? 0) <= 0) return 'Expected completion date is required'
  if (value.requestedRaw <= 0) return 'Requested amount must be positive'
  const min = grant.min_award ?? 0
  const max = grant.max_award ?? 0
  if (min > 0 && value.requestedRaw < min * 1_000_000) return 'Requested amount is below the grant minimum'
  if (max > 0 && value.requestedRaw > max * 1_000_000) return 'Requested amount exceeds the grant maximum'
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
  if (!emailOk) return 'Email address is invalid'
  for (const [url, label] of [[value.githubUrl, 'GitHub URL'], [value.portfolioUrl, 'Portfolio URL']] as const) {
    const error = validateUrl(url, label)
    if (error) return error
  }
  for (const attachment of value.attachments) {
    if (!attachment || typeof attachment !== 'object') return 'Supporting links are invalid'
    const url = String((attachment as Record<string, unknown>).url ?? '')
    const error = validateUrl(url, 'Supporting link')
    if (error) return error
  }
  const questions = parseJson<Array<{ id: string; prompt: string; required?: boolean }>>(grant.custom_questions, [])
  for (const question of questions) {
    if (question.required && !String(value.customAnswers[question.id] ?? '').trim()) {
      return `Answer required: ${question.prompt}`
    }
  }
  return null
}

function notifyOrgAdmins(orgId: string, type: string, entityId: string, message: string) {
  const admins = db.prepare<{ address: string }, string>(
    `SELECT address FROM org_members WHERE org_id = ? AND role = 'admin'`,
  ).all(orgId)
  for (const admin of admins) notify(admin.address, type, entityId, message)
}

export async function handleApplications(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname

  const matchProfile = p.match(/^\/api\/profiles\/([^/]+)$/)
  if (req.method === 'GET' && matchProfile) {
    const addr = matchProfile[1].toLowerCase()
    const row = db.prepare<ProfileRow, string>(`SELECT * FROM profiles WHERE address = ?`).get(addr)
    if (!row) return Response.json({ address: addr, display_name: '', bio: '', skills: [], github: '', portfolio: '' })
    const pub = parseJson<string[]>(row.public_fields, [])
    const session = requireAuth(req)
    const isOwn = session?.address === addr
    const out: Record<string, unknown> = { address: row.address }
    for (const f of ['display_name','bio','github','portfolio','skills','team'] as const) {
      if (isOwn || pub.includes(f)) out[f] = f === 'skills' || f === 'team' ? parseJson<unknown[]>(row[f], []) : row[f]
    }
    return Response.json(out)
  }

  if (req.method === 'PUT' && p === '/api/profiles') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json() as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO profiles (address,display_name,bio,github,portfolio,skills,team,public_fields,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET
        display_name=excluded.display_name, bio=excluded.bio, github=excluded.github,
        portfolio=excluded.portfolio, skills=excluded.skills, team=excluded.team,
        public_fields=excluded.public_fields, updated_at=excluded.updated_at`).run(
      session.address, String(body.display_name ?? ''), String(body.bio ?? ''), String(body.github ?? ''),
      String(body.portfolio ?? ''), JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
      JSON.stringify(Array.isArray(body.team) ? body.team : []),
      JSON.stringify(Array.isArray(body.public_fields) ? body.public_fields : ['display_name','bio','skills']), now,
    )
    return Response.json({ ok: true })
  }

  const matchGApp = p.match(/^\/api\/grants\/([^/]+)\/applications$/)
  if (req.method === 'GET' && matchGApp) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const grant = grantForApplication(matchGApp[1])
    if (!grant) return Response.json({ error: 'Not found' }, { status: 404 })
    const role = orgRole(grant.org_id, session.address)
    if (!role || !['admin', 'reviewer'].includes(role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const apps = db.prepare<AppRow, string>(`SELECT * FROM applications
      WHERE grant_id = ? AND status != 'draft' ORDER BY submitted_at DESC, created_at DESC`).all(matchGApp[1])
    return Response.json(apps.map(app => fmtApp(app, role === 'admin' ? 'admin' : 'reviewer')))
  }

  if (req.method === 'GET' && p === '/api/applications/mine') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const apps = db.prepare<AppRow, string>(`SELECT a.*, g.title as grant_title, g.org_id, o.name as org_name
      FROM applications a LEFT JOIN grants g ON g.id = a.grant_id LEFT JOIN orgs o ON o.id = g.org_id
      WHERE a.applicant_addr = ? ORDER BY a.created_at DESC`).all(session.address)
    return Response.json(apps.map(fmtApp))
  }

  const matchHistory = p.match(/^\/api\/applications\/([^/]+)\/history$/)
  if (req.method === 'GET' && matchHistory) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchHistory[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = grantForApplication(app.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    if (app.applicant_addr !== session.address && !isOrgMember(grant.org_id, session.address, ['admin', 'reviewer'])) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    return Response.json(db.prepare(`SELECT id,actor_addr,action,note,created_at FROM audit_log
      WHERE entity = 'application' AND entity_id = ? ORDER BY created_at DESC`).all(matchHistory[1]))
  }

  const matchAppId = p.match(/^\/api\/applications\/([^/]+)$/)
  if (req.method === 'GET' && matchAppId) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchAppId[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = grantForApplication(app.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    const isApplicant = app.applicant_addr === session.address
    const role = orgRole(grant.org_id, session.address)
    if (!isApplicant && (!role || !['admin', 'reviewer'].includes(role))) return Response.json({ error: 'Forbidden' }, { status: 403 })
    return Response.json(fmtApp(app, role === 'admin' ? 'admin' : role === 'reviewer' ? 'reviewer' : undefined))
  }

  const matchSubmit = p.match(/^\/api\/grants\/([^/]+)\/applications$/)
  if (req.method === 'POST' && matchSubmit) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const grant = grantForApplication(matchSubmit[1])
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    const statusError = applicationStatusError(grant)
    if (statusError) return Response.json({ error: statusError }, { status: 409 })
    const body = await req.json() as Record<string, unknown>
    const existing = db.prepare<{ id: string; status: string }, [string, string]>(
      `SELECT id,status FROM applications WHERE grant_id = ? AND applicant_addr = ?
       AND status != 'rejected' ORDER BY created_at DESC LIMIT 1`,
    ).get(grant.id, session.address)
    if (existing && blocksDuplicateApplication(existing.status, grant.allow_multiple_applications === 1)) {
      return Response.json({ error: 'You already have an application for this grant', existing_application_id: existing.id }, { status: 409 })
    }
    let value: ReturnType<typeof normalizedApplication>
    try { value = normalizedApplication(body) } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
    const isSubmit = body.submit === true
    const validationError = validateApplication(value, grant, isSubmit)
    if (validationError) return Response.json({ error: validationError }, { status: 400 })
    const now = Math.floor(Date.now() / 1000)
    const id = randomUUID()
    db.prepare(`INSERT INTO applications
      (id,grant_id,applicant_addr,applicant_name,email,country,applicant_type,github_url,portfolio_url,
       project_name,summary,problem,solution,project_category,development_stage,tech_stack,ecosystem_benefit,
       use_of_funds,budget_breakdown,completion_date,previous_experience,custom_answers,attachments,milestones,
       requested_raw,status,submitted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, grant.id, session.address, value.applicantName, value.email, value.country, value.applicantType,
      value.githubUrl, value.portfolioUrl, value.projectName, value.summary, value.problem, value.solution,
      value.projectCategory, value.developmentStage, value.techStack, value.ecosystemBenefit, value.useOfFunds,
      value.budgetBreakdown, value.completionDate, value.previousExperience, JSON.stringify(value.customAnswers),
      JSON.stringify(value.attachments), JSON.stringify(value.milestones), value.requestedRaw,
      isSubmit ? 'submitted' : 'draft', isSubmit ? now : null, now, now,
    )
    auditLog(session.address, isSubmit ? 'submit' : 'draft', 'application', id)
    if (isSubmit) notifyOrgAdmins(grant.org_id, 'application_submitted', id, `A new application was submitted for ${grant.title}.`)
    return Response.json(fmtApp(db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(id)!), { status: 201 })
  }

  const matchPatch = p.match(/^\/api\/applications\/([^/]+)$/)
  if (req.method === 'PATCH' && matchPatch) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchPatch[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    if (app.applicant_addr !== session.address) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (app.status !== 'draft') return Response.json({ error: 'Cannot edit submitted application' }, { status: 409 })
    const grant = grantForApplication(app.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    const body = await req.json() as Record<string, unknown>
    let value: ReturnType<typeof normalizedApplication>
    try { value = normalizedApplication(body, app) } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
    const isSubmit = body.submit === true
    if (isSubmit) {
      const statusError = applicationStatusError(grant)
      if (statusError) return Response.json({ error: statusError }, { status: 409 })
    }
    const validationError = validateApplication(value, grant, isSubmit)
    if (validationError) return Response.json({ error: validationError }, { status: 400 })
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE applications SET applicant_name=?,email=?,country=?,applicant_type=?,github_url=?,portfolio_url=?,
      project_name=?,summary=?,problem=?,solution=?,project_category=?,development_stage=?,tech_stack=?,ecosystem_benefit=?,
      use_of_funds=?,budget_breakdown=?,completion_date=?,previous_experience=?,custom_answers=?,attachments=?,milestones=?,
      requested_raw=?,status=?,submitted_at=?,updated_at=? WHERE id=?`).run(
      value.applicantName, value.email, value.country, value.applicantType, value.githubUrl, value.portfolioUrl,
      value.projectName, value.summary, value.problem, value.solution, value.projectCategory, value.developmentStage,
      value.techStack, value.ecosystemBenefit, value.useOfFunds, value.budgetBreakdown, value.completionDate,
      value.previousExperience, JSON.stringify(value.customAnswers), JSON.stringify(value.attachments),
      JSON.stringify(value.milestones), value.requestedRaw, isSubmit ? 'submitted' : 'draft', isSubmit ? now : null, now, matchPatch[1],
    )
    auditLog(session.address, isSubmit ? 'submit' : 'draft_update', 'application', matchPatch[1])
    if (isSubmit) notifyOrgAdmins(grant.org_id, 'application_submitted', matchPatch[1], `An application was submitted for ${grant.title}.`)
    return Response.json(fmtApp(db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchPatch[1])!))
  }

  const matchReview = p.match(/^\/api\/applications\/([^/]+)\/reviews$/)
  if (req.method === 'POST' && matchReview) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchReview[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = grantForApplication(app.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    const role = orgRole(grant.org_id, session.address)
    if (!role || !['admin', 'reviewer'].includes(role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const body = await req.json() as Record<string, unknown>
    const decision = String(body.decision ?? '')
    if (!['shortlist', 'request_info', 'approve', 'reject', 'note'].includes(decision)) return Response.json({ error: 'Invalid decision' }, { status: 400 })
    if (!canMakeFinalApplicationDecision(role, decision)) return Response.json({ error: 'Only organization admins can make final decisions' }, { status: 403 })
    if (['approved', 'rejected'].includes(app.status) && decision !== 'note') return Response.json({ error: 'Final application decisions cannot be changed' }, { status: 409 })
    const score = body.score == null || body.score === '' ? null : Number(body.score)
    if (score != null && (!Number.isInteger(score) || score < 1 || score > 5)) return Response.json({ error: 'Score must be between 1 and 5' }, { status: 400 })
    const criteriaScores = body.criteria_scores && typeof body.criteria_scores === 'object' ? body.criteria_scores as Record<string, unknown> : {}
    const safeCriteria: Record<string, number> = {}
    for (const key of REVIEW_CRITERIA) {
      if (criteriaScores[key] == null || criteriaScores[key] === '') continue
      const value = Number(criteriaScores[key])
      if (!Number.isInteger(value) || value < 1 || value > 5) return Response.json({ error: `Invalid score for ${key}` }, { status: 400 })
      safeCriteria[key] = value
    }
    const checks = Array.isArray(body.eligibility_checks) ? body.eligibility_checks.map(String).slice(0, 20) : []
    const revNow = Math.floor(Date.now() / 1000)
    const reviewId = randomUUID()
    db.prepare(`INSERT INTO reviews
      (id,application_id,reviewer_addr,score,comment,decision,criteria_scores,eligibility_checks,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(application_id, reviewer_addr) DO UPDATE SET
      score=excluded.score,comment=excluded.comment,decision=excluded.decision,
      criteria_scores=excluded.criteria_scores,eligibility_checks=excluded.eligibility_checks,updated_at=excluded.updated_at`).run(
      reviewId, matchReview[1], session.address, score, String(body.notes ?? body.comment ?? ''), decision,
      JSON.stringify(safeCriteria), JSON.stringify(checks), revNow, revNow,
    )
    const statusMap: Record<string, string> = { shortlist: 'shortlisted', request_info: 'reviewing', approve: 'approved', reject: 'rejected' }
    const nextStatus = statusMap[decision]
    if (nextStatus) db.prepare(`UPDATE applications SET status=?,updated_at=? WHERE id=?`).run(nextStatus, revNow, matchReview[1])
    auditLog(session.address, `review:${decision}`, 'application', matchReview[1], String(body.notes ?? body.comment ?? ''))
    if (decision !== 'note') {
      notify(app.applicant_addr, `application_${decision}`, matchReview[1], `Your GrantHub application is now ${nextStatus ?? 'under review'}.`)
    }
    return Response.json({ id: reviewId, decision }, { status: 201 })
  }

  const matchGetReviews = p.match(/^\/api\/applications\/([^/]+)\/reviews$/)
  if (req.method === 'GET' && matchGetReviews) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchGetReviews[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = grantForApplication(app.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    if (app.applicant_addr !== session.address && !isOrgMember(grant.org_id, session.address, ['admin', 'reviewer'])) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const reviews = db.prepare<ReviewRow, string>(`SELECT * FROM reviews WHERE application_id = ? ORDER BY created_at DESC`).all(matchGetReviews[1])
    return Response.json(reviews.map(fmtReview))
  }

  return null
}
