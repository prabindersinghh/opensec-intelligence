---
name: skill-creator
description: "Guide for creating, testing, and publishing cmdr skills"
---

# Skill Creator

## Instructions

When the user asks to create a new cmdr skill:

1. **Plan the skill** — define what domain it covers, what keywords trigger it
2. **Scaffold** — use `/skills scaffold <name>` or create the directory structure manually
3. **Write SKILL.md** — the main instruction file with YAML frontmatter
4. **Add scripts** — optional helper scripts in the `scripts/` subdirectory
5. **Test** — verify the skill loads and activates on the right keywords

## Skill Directory Structure

```
skill-name/
  SKILL.md          # Required — instructions with YAML frontmatter
  scripts/          # Optional — helper scripts
    helper.sh
    setup.py
  README.md         # Optional — additional reference docs
```

## SKILL.md Format

```markdown
---
name: my-skill
description: "What this skill does (shown in /skills list)"
---

# Skill Title

## Instructions

Clear, specific instructions for the agent.
Use imperative voice. Be concise.

## Examples

Show concrete examples of desired behavior.

## References

Link to relevant documentation or standards.
```

## Keyword Matching

Skills are activated when the user's message matches keywords in the injector.
To add keywords for your skill, update `src/skills/injector.ts` and add a pattern entry.

## Skill Locations

- **Bundled**: `src/skills/bundled/` — ships with cmdr
- **User**: `~/.cmdr/skills/` — personal skills, all projects
- **Project**: `.cmdr/skills/` — project-specific skills
