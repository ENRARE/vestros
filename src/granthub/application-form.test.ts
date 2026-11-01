import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  APPLICATION_STEPS,
  APPLICATION_REQUIRED_NOTE,
  validateApplicationStep,
  type ApplicationForm,
  type MilestoneInput,
} from './application-form.ts'

const form: ApplicationForm = {
  applicant_name: 'Ada Lovelace', email: 'ada@example.com', country: 'GB', applicant_type: 'individual',
  github_url: '', portfolio_url: '', bio: '', project_name: 'Arc tooling', summary: 'A useful tool',
  problem: 'A real problem', solution: 'A practical solution', project_category: 'tooling',
  development_stage: 'prototype', tech_stack: 'TypeScript', ecosystem_benefit: 'More builders',
  previous_experience: '', requested_amount: '100', use_of_funds: 'Engineering', budget_breakdown: 'Engineering: 100',
  completion_date: '2030-01-01', links: '',
}
const milestones: MilestoneInput[] = [{ title: 'Prototype', description: 'Ship it', amount: '100', days_after_start: 30 }]

void describe('GrantHub application step model', () => {
  void it('uses the compact required-fields note below the form card', () => {
    assert.equal(APPLICATION_REQUIRED_NOTE, 'Fields marked * are required')
  })

  void it('exposes the five application steps in order', () => {
    assert.deepEqual(APPLICATION_STEPS.map(step => step.label), [
      'Applicant info', 'Project info', 'Funding proposal', 'Milestones & links', 'Review & submit',
    ])
  })

  void it('requires the current step before moving forward', () => {
    assert.equal(validateApplicationStep(0, { ...form, email: '' }, milestones, [], {}), 'Email is required')
    assert.equal(validateApplicationStep(1, { ...form, project_name: '' }, milestones, [], {}), 'Project name is required')
    assert.equal(validateApplicationStep(2, { ...form, requested_amount: '' }, milestones, [], {}), 'Requested amount is required')
  })

  void it('restores required milestone and custom-question validation', () => {
    assert.equal(
      validateApplicationStep(3, form, [{ ...milestones[0], title: '' }], [], {}),
      'Milestone 1 title is required',
    )
    assert.equal(
      validateApplicationStep(3, form, milestones, [{ id: 'q1', prompt: 'Why?', required: true }], {}),
      'Answer required: Why?',
    )
  })
})
