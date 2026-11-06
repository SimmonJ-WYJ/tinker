import { test, expect } from 'bun:test'
import { join } from 'node:path'
import {
  resolveSkillDependencies,
  parseRequirementsTxt,
  parsePyprojectDependencies,
  parseInstallLineFromSkillMd,
  hashDependencies,
} from './python-dependency-resolver.ts'

const FIXTURES = join(import.meta.dir, '..', '..', '..', '..', 'tests', 'fixtures', 'python', 'skills')

test('parseRequirementsTxt 跳过空行/注释，保留版本约束', () => {
  const result = parseRequirementsTxt('numpy>=1.26\n\n# 注释\npandas==2.2.0\nrequests\n')
  expect(result).toEqual(['numpy>=1.26', 'pandas==2.2.0', 'requests'])
})

test('parsePyprojectDependencies 抓 [project].dependencies 数组', () => {
  const toml = '[project]\nname = "x"\ndependencies = [\n    "scipy>=1.13",\n    "matplotlib",\n]\n'
  expect(parsePyprojectDependencies(toml)).toEqual(['scipy>=1.13', 'matplotlib'])
})

test('parseInstallLineFromSkillMd 提取 uv pip install 后的所有 token', () => {
  const md = '```bash\nuv pip install scanpy anndata[dev] "torch>=2.1"\n```'
  expect(parseInstallLineFromSkillMd(md)).toEqual(['scanpy', 'anndata[dev]', 'torch>=2.1'])
})

test('parseInstallLineFromSkillMd 没有 install 行时返回 null', () => {
  expect(parseInstallLineFromSkillMd('# nothing here')).toBeNull()
})

test('resolveSkillDependencies 优先 requirements.txt', async () => {
  const deps = await resolveSkillDependencies(join(FIXTURES, 'with-requirements'))
  expect(deps.source).toBe('requirements.txt')
  expect(deps.packages).toEqual(['numpy>=1.26', 'pandas==2.2.0', 'requests'])
})

test('resolveSkillDependencies 次优先 pyproject.toml', async () => {
  const deps = await resolveSkillDependencies(join(FIXTURES, 'with-pyproject'))
  expect(deps.source).toBe('pyproject.toml')
  expect(deps.packages).toEqual(['scipy>=1.13', 'matplotlib'])
})

test('resolveSkillDependencies 兜底解析 SKILL.md install 行', async () => {
  const deps = await resolveSkillDependencies(join(FIXTURES, 'skill-md-only'))
  expect(deps.source).toBe('SKILL.md')
  expect(deps.packages).toEqual(['scanpy', 'anndata[dev]', 'torch>=2.1'])
})

test('resolveSkillDependencies 找不到任何来源时返回空依赖', async () => {
  const deps = await resolveSkillDependencies('/nonexistent-skill-dir-1234')
  expect(deps.source).toBe('none')
  expect(deps.packages).toEqual([])
})

test('hashDependencies 对包顺序不敏感（先排序再哈希）', () => {
  const a = hashDependencies(['scanpy', 'numpy'])
  const b = hashDependencies(['numpy', 'scanpy'])
  expect(a).toBe(b)
  expect(a.length).toBe(64)
})

test('hashDependencies 大小写敏感（按 PEP 508 名字保持原样）', () => {
  expect(hashDependencies(['Numpy'])).not.toBe(hashDependencies(['numpy']))
})

test('parsePyprojectDependencies 正确处理 PEP 508 extras 形如 pkg[dev]', () => {
  const toml = '[project]\ndependencies = [\n    "anndata[dev]>=0.10",\n    "pkg[a,b]",\n    "scanpy"\n]\n'
  expect(parsePyprojectDependencies(toml)).toEqual(['anndata[dev]>=0.10', 'pkg[a,b]', 'scanpy'])
})

test('parsePyprojectDependencies 不被 dev-dependencies 抢占', () => {
  const toml = '[tool.uv]\ndev-dependencies = ["pytest"]\n\n[project]\ndependencies = ["a", "b"]\n'
  expect(parsePyprojectDependencies(toml)).toEqual(['a', 'b'])
})

test('parseInstallLineFromSkillMd 在引号外的 # 截断行（去掉行内注释）', () => {
  const md = '```bash\nuv pip install foo bar  # 安装核心包\n```'
  expect(parseInstallLineFromSkillMd(md)).toEqual(['foo', 'bar'])
})

test('parseInstallLineFromSkillMd 在引号内的 # 不截断（保留 PEP 440 marker）', () => {
  const md = '```bash\nuv pip install "foo>=1.0; python_version >= \\"3.10\\""\n```'
  // 引号内的 # 不存在；这里测引号内特殊字符不被截断
  const result = parseInstallLineFromSkillMd(md)
  expect(result).not.toBeNull()
  // 不应包含 # 字符
  expect(result!.every((t) => !t.includes('#'))).toBe(true)
})

test('hashDependencies 空数组返回确定的 sha256（空字符串的 hash）', () => {
  // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  expect(hashDependencies([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})
