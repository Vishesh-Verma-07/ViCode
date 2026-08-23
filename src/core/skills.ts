import { readFileSync, existsSync, readdirSync } from "fs"
import { join } from "path"

export interface Skill {
  name: string
  origin: "project" | "global"
  content: string
}

const PROJECT_SKILLS_DIR = ".vicode/skills"

function readSkillFile(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, "utf-8").trim()
  } catch {
    return null
  }
}

function isValidSkillContent(content: string): boolean {
  return content.length > 0
}

export function discoverSkills(projectPath: string, globalSkillsDir?: string): Skill[] {
  const skills: Skill[] = []

  const projectSkillsDir = join(projectPath, PROJECT_SKILLS_DIR)
  const globalDir = globalSkillsDir ?? join(process.env.HOME || process.env.USERPROFILE || "", ".vicode", "skills")

  let projectSkills: Map<string, Skill> = new Map()
  let globalSkills: Map<string, Skill> = new Map()

  if (existsSync(projectSkillsDir)) {
    const projectFiles = getSkillFiles(projectSkillsDir)
    for (const file of projectFiles) {
      const content = readSkillFile(file)
      if (content && isValidSkillContent(content)) {
        const name = extractSkillName(content)
        if (name) {
          projectSkills.set(name, { name, origin: "project", content })
        }
      }
    }
  }

  if (existsSync(globalDir)) {
    const globalFiles = getSkillFiles(globalDir)
    for (const file of globalFiles) {
      const content = readSkillFile(file)
      if (content && isValidSkillContent(content)) {
        const name = extractSkillName(content)
        if (name) {
          globalSkills.set(name, { name, origin: "global", content })
        }
      }
    }
  }

  // Project skills take precedence over global skills with the same name
  const allNames = new Set([
    ...projectSkills.keys(),
    ...globalSkills.keys(),
  ])

  for (const name of allNames) {
    if (projectSkills.has(name)) {
      skills.push(projectSkills.get(name)!)
    } else if (globalSkills.has(name)) {
      skills.push(globalSkills.get(name)!)
    }
  }

  return skills
}

function getSkillFiles(skillsDir: string): string[] {
  try {
    return readdirSync(skillsDir).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
}

function extractSkillName(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m)
  if (!match) return null
  return match[1] ? match[1].trim() : null
}