import retiredBuiltinSkills from './retired-builtin-skills.json'

/** 已退役的应用内置能力；仅控制应用分发与注册，不用于删除用户文件。 */
export const RETIRED_BUILTIN_PACK_IDS: ReadonlySet<string> = new Set(['lit-search', 'lit-review', 'research-gap'])
// 仅来自受信 Git baseline 4ca3395；元数据不接受用户配置扩展。
interface RetiredBuiltinSkill { hash: string; files: Readonly<Record<string, number>> }
export const RETIRED_BUILTIN_SKILLS: Readonly<Record<string, RetiredBuiltinSkill>> = retiredBuiltinSkills
export const RETIRED_BUILTIN_SKILL_SLUGS: ReadonlySet<string> = new Set(Object.keys(RETIRED_BUILTIN_SKILLS))
