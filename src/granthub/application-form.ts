import type { CustomQuestion } from './types'

export interface MilestoneInput {
  title: string
  description: string
  amount: string
  days_after_start: number
}

export interface ApplicationForm {
  applicant_name: string
  email: string
  country: string
  applicant_type: 'individual' | 'team'
  github_url: string
  portfolio_url: string
  bio: string
  project_name: string
  summary: string
  problem: string
  solution: string
  project_category: string
  development_stage: string
  tech_stack: string
  ecosystem_benefit: string
  previous_experience: string
  requested_amount: string
  use_of_funds: string
  budget_breakdown: string
  completion_date: string
  links: string
}

export const APPLICATION_STEPS = [
  { id: 'applicant', label: 'Applicant info' },
  { id: 'project', label: 'Project info' },
  { id: 'funding', label: 'Funding proposal' },
  { id: 'milestones', label: 'Milestones & links' },
  { id: 'review', label: 'Review & submit' },
] as const

export const APPLICATION_REQUIRED_NOTE = 'Fields marked * are required'

function required(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required`
}

function validateApplicant(form: ApplicationForm): string | null {
  for (const [value, label] of [
    [form.applicant_name, 'Full name or team representative'],
    [form.email, 'Email'],
    [form.country, 'Country'],
  ] as const) {
    const error = required(value, label)
    if (error) return error
  }
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'Email address is invalid'
  return null
}

function validateProject(form: ApplicationForm): string | null {
  for (const [value, label] of [
    [form.project_name, 'Project name'],
    [form.summary, 'Project description'],
    [form.problem, 'Problem statement'],
    [form.solution, 'Proposed solution'],
    [form.project_category, 'Project category'],
    [form.development_stage, 'Development stage'],
    [form.tech_stack, 'Technology stack'],
    [form.ecosystem_benefit, 'Ecosystem benefit'],
  ] as const) {
    const error = required(value, label)
    if (error) return error
  }
  return null
}

function validateFunding(form: ApplicationForm): string | null {
  for (const [value, label] of [
    [form.requested_amount, 'Requested amount'],
    [form.use_of_funds, 'Use of funds'],
    [form.budget_breakdown, 'Budget breakdown'],
    [form.completion_date, 'Expected completion date'],
  ] as const) {
    const error = required(value, label)
    if (error) return error
  }
  return null
}

function validateMilestones(
  milestones: MilestoneInput[],
  questions: CustomQuestion[],
  answers: Record<string, string>,
): string | null {
  if (milestones.length === 0) return 'Add at least one milestone'
  for (const [index, milestone] of milestones.entries()) {
    if (!milestone.title.trim()) return `Milestone ${index + 1} title is required`
    if (!Number.isSafeInteger(milestone.days_after_start) || milestone.days_after_start < 1) {
      return `Milestone ${index + 1} timing must be at least one day`
    }
  }
  for (const question of questions) {
    if (question.required && !answers[question.id]?.trim()) return `Answer required: ${question.prompt}`
  }
  return null
}

export function validateApplicationStep(
  step: number,
  form: ApplicationForm,
  milestones: MilestoneInput[],
  questions: CustomQuestion[],
  answers: Record<string, string>,
): string | null {
  if (step === 0) return validateApplicant(form)
  if (step === 1) return validateProject(form)
  if (step === 2) return validateFunding(form)
  if (step === 3) return validateMilestones(milestones, questions, answers)
  return null
}
