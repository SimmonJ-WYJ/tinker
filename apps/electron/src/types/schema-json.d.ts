/**
 * `*.schema.json`（O1 对象标准 schema，仓库根 schema/）的模块声明。
 *
 * esbuild 内置 json loader 在打包时把 JSON 解析为对象内联进 main.cjs
 * （与 sql.d.ts 的 .sql=text 模式对偶）；tsconfig 未开 resolveJsonModule，
 * 故用 wildcard declare 提供类型。default export 即解析后的 schema 对象。
 */
declare module '*.schema.json' {
  const schema: Record<string, unknown>
  export default schema
}
