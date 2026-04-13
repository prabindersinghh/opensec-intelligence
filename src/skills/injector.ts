/**
 * SkillInjector — selects relevant skills based on user message content.
 *
 * Injects at most 2 skills per turn to avoid context bloat.
 */

import type { Skill } from './loader.js'

// ---------------------------------------------------------------------------
// Keyword → skill mapping
// ---------------------------------------------------------------------------

const SKILL_KEYWORDS: Array<{ pattern: RegExp; skills: string[] }> = [
  { pattern: /\bpdf\b|\.pdf\b/i, skills: ['pdf'] },
  { pattern: /\bword\b|\.docx?\b|\bdocument\b/i, skills: ['docx'] },
  { pattern: /\bspreadsheet\b|\bexcel\b|\.xlsx?\b|\bcsv\b/i, skills: ['xlsx'] },
  { pattern: /\bpresentation\b|\bslides?\b|\bpowerpoint\b|\.pptx?\b/i, skills: ['pptx'] },
  { pattern: /\bfrontend\b|\breact\b|\bhtml\b|\bcss\b|\bui\b|\bweb\s*page\b|\bdashboard\b/i, skills: ['frontend-design'] },
  { pattern: /\btest(ing)?\b|\be2e\b|\bend.to.end\b|\bplaywright\b|\bcypress\b|\bvitest\b|\bjest\b/i, skills: ['webapp-testing'] },
  { pattern: /\bmcp\b|\bmodel context protocol\b|\bmcp\s*server\b/i, skills: ['mcp-builder'] },
  { pattern: /\bskill\b|\bcreate\s+skill\b/i, skills: ['skill-creator'] },
  { pattern: /\bbug\b|\bfix\b|\bdebug\b|\berror\b|\bcrash\b|\bstack\s*trace\b/i, skills: ['debugging'] },
  { pattern: /\brefactor\b|\bclean\s*up\b|\brestructure\b|\bextract\b|\bsplit\b/i, skills: ['refactoring'] },
  { pattern: /\bsecur(e|ity)\b|\bxss\b|\binjection\b|\bvulnerab\b|\bcve\b|\bowasp\b/i, skills: ['security-guidance'] },
]

const MAX_SKILLS_PER_TURN = 2

// ---------------------------------------------------------------------------
// SkillInjector
// ---------------------------------------------------------------------------

export class SkillInjector {
  /**
   * Given a user message and available skills, return the most relevant ones.
   * Returns at most MAX_SKILLS_PER_TURN skills.
   */
  selectSkills(message: string, available: Skill[]): Skill[] {
    const names = new Set<string>()

    for (const entry of SKILL_KEYWORDS) {
      if (entry.pattern.test(message)) {
        for (const name of entry.skills) {
          names.add(name.toLowerCase())
        }
      }
    }

    if (names.size === 0) return []

    const matched: Skill[] = []
    for (const skill of available) {
      if (names.has(skill.name.toLowerCase()) && matched.length < MAX_SKILLS_PER_TURN) {
        matched.push(skill)
      }
    }

    return matched
  }

  /**
   * Format selected skills as prompt injection text.
   * Wrapped in <skill> tags for clear delineation.
   */
  formatForPrompt(skills: Skill[]): string {
    if (skills.length === 0) return ''

    const parts: string[] = []
    for (const skill of skills) {
      const scriptNote = skill.scripts.length > 0
        ? `\n\nHelper scripts available at:\n${skill.scripts.map(s => `  - ${s}`).join('\n')}`
        : ''

      parts.push(`<skill name="${skill.name}">\n${skill.instructions}${scriptNote}\n</skill>`)
    }

    return '\n\n' + parts.join('\n\n')
  }
}
