/**
 * 简易 kebab-case → camelCase 命令行参数解析。
 *
 * 用法：
 *   const args = parseKebabArgs<{ fromLocal?: string }>(process.argv.slice(2))
 *   args.fromLocal  // 来自 --from-local <value>
 *
 * 行为约定：
 * - 仅支持 `--key value` 形式，`--key` 后必须紧跟值（值不能以 `--` 开头）
 * - 缺值或值以 `--` 开头的 flag 直接跳过
 * - 不支持 `--key=value`、布尔 flag、短选项 `-k`
 *
 * 之前在 build-runtimes.ts 与 setup-runtimes.ts 各有一份，抽到此处共用。
 */
export function parseKebabArgs<T extends Record<string, string | undefined>>(argv: string[]): T {
  const out = {} as T
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const val = argv[i + 1]
    if (!flag?.startsWith('--')) continue
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof T
    if (val === undefined || val.startsWith('--')) continue
    out[key] = val as T[keyof T]
    i++
  }
  return out
}
