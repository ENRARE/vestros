// GrantHub domain types — aligned with server/db.ts schema

export type GrantStatus = 'draft' | 'open' | 'review' | 'closed'
export type AppStatus = 'draft' | 'submitted' | 'reviewing' | 'shortlisted' | 'approved' | 'rejected' | 'pending_funding' | 'funded' | 'awarded'
export type AwardStatus = 'pending' | 'activating' | 'active' | 'failed' | 'cancelled' | 'vesting_activated'

// ── Organization ──────────────────────────────────────────────────────────────

export interface Organization {
  id: string
  slug?: string          // alias: some endpoints return id as slug
  name: string
  description: string
  website: string
  twitter: string
  github: string
  logo_url: string
  owner_addr?: string    // returned by org detail endpoints
  treasury_address: string
  created_at: number
  updated_at: number
  members?: Array<{ address: string; role: string }>
  member_count?: number
  grant_count?: number
}

export interface GrantHubProfile {
  address: string
  display_name?: string
  bio?: string
  github?: string
  portfolio?: string
  skills?: string[]
  team?: string[]
}

// ── Grant Program ─────────────────────────────────────────────────────────────

export interface GrantProgram {
  id: string
  org_id: string
  org_name?: string
  org_slug?: string            // alias returned by some list endpoints
  org_logo?: string
  title: string
  description: string
  goals?: string
  eligibility?: string
  requirements: string
  funding_terms?: string
  deliverables?: string
  custom_questions?: CustomQuestion[]
  allow_multiple_applications?: boolean
  faqs?: unknown[]
  tags?: string[]              // frontend convenience field
  category: string
  // Budget fields — declared_budget is raw number from DB; total_budget/max_award are string aliases in fmtGrant
  declared_budget?: number
  total_budget?: string        // fmtGrant alias for declared_budget
  min_award?: number
  max_award?: string | number  // fmtGrant alias
  status: GrantStatus
  deadline?: number | null
  close_date?: number | null   // alias for deadline in frontend forms
  start_date?: number | null
  end_date?: number | null
  vesting_cliff_days?: number
  vesting_total_days?: number
  cliff_days?: number          // alias
  vesting_days?: number        // alias
  revocable?: boolean
  confirmed_funded?: string    // confirmed onchain deposit total (string from backend)
  pool_contract_address?: string | null
  pool_chain_id?: number | null
  created_at: number
  updated_at: number
  applicant_count?: number
  awarded_count?: number
}

// ── Application ───────────────────────────────────────────────────────────────

export interface Milestone {
  label?: string
  title?: string
  description?: string
  value?: string
  amount?: string
  days_after_start?: number
}

export interface GrantApplication {
  id: string
  grant_id: string
  grant_title?: string
  org_id?: string
  org_name?: string
  applicant_addr: string
  applicant_name?: string
  email?: string
  country?: string
  applicant_type?: 'individual' | 'team'
  github_url?: string
  portfolio_url?: string
  project_name: string
  project_title?: string       // alias
  summary: string
  description?: string         // alias for summary in some UI
  problem: string
  solution: string
  project_category?: string
  development_stage?: string
  tech_stack?: string
  ecosystem_benefit?: string
  use_of_funds?: string
  budget_breakdown?: string
  completion_date?: number | null
  previous_experience?: string
  custom_answers?: Record<string, string>
  attachments?: Array<{ name: string; url: string }>
  milestones: Milestone[]
  requested_raw: number        // raw USDC (6 dec)
  requested_amount?: string    // formatted alias
  status: AppStatus
  submitted_at: number | null
  created_at: number
  updated_at: number
  reviews?: ReviewDecision[]
  links?: string[]             // optional portfolio/reference links
  name?: string                // alias for display_name
  bio?: string                 // alias from profile
  review_count?: number
  avg_score?: number | null
  viewer_role?: 'admin' | 'reviewer'
}

// ── Review ────────────────────────────────────────────────────────────────────

export interface ReviewDecision {
  id: string
  application_id: string
  reviewer_addr: string
  score: number | null
  comment?: string
  notes?: string                // alias for comment
  decision: 'shortlist' | 'request_info' | 'approve' | 'reject' | 'note' | null
  criteria_scores?: Record<string, number>
  eligibility_checks?: string[]
  created_at: number
  updated_at: number
}

// ── Award ─────────────────────────────────────────────────────────────────────

export interface GrantAward {
  id: string
  application_id: string
  grant_id: string
  grant_title?: string
  org_id: string
  org_name?: string
  beneficiary_addr: string
  amount_raw: number           // raw USDC (6 dec)
  amount?: string              // formatted alias
  vesting_start?: number
  vesting_cliff_days: number
  vesting_total_days: number
  revocable: boolean
  contract_address: string | null   // GrantVesting contract address
  chain_id: number | null
  schedule_id: string | null        // GrantVesting schedule ID
  tx_hash: string | null
  status: AwardStatus
  authorized_by: string | null
  authorized_at: number | null
  activated_at: number | null
  created_at: number
  updated_at: number
  // Legacy aliases (may appear from older frontend code)
  vesting_schedule_id?: string | null
  vesting_duration_days?: number
  recipient_addr?: string
}

// ── Sponsor / Deposit ─────────────────────────────────────────────────────────

export interface Deposit {
  id: string
  grant_id: string
  sponsor_addr: string
  amount_raw: number
  tx_hash: string | null
  block_number: number | null
  confirmed: boolean
  verified: boolean
  verified_chain_id?: number | null
  verified_pool_contract_address?: string | null
  verified_token_address?: string | null
  verified_at?: number | null
  deposited_at: number
}

// ── Query params ──────────────────────────────────────────────────────────────

export interface ListGrantsParams {
  status?: GrantStatus
  orgId?: string
  category?: string
  q?: string
  sort?: 'created_at' | 'deadline' | 'declared_budget' | 'title'
  page?: number
}

export interface ApiError {
  error: string
}

export interface CustomQuestion {
  id: string
  prompt: string
  required: boolean
}

export interface GrantNotification {
  id: string
  type: string
  entity_id: string | null
  message: string
  read: boolean
  created_at: number
}

// ── Convenience constants ─────────────────────────────────────────────────────

export const CATEGORIES = ['general','infrastructure','defi','tooling','research','education','community'] as const
