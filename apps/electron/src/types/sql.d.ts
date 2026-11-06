/**
 * `.sql` 文件 import 的类型声明
 *
 * 主进程 esbuild 用 `--loader:.sql=text` 在编译时把 SQL 文件 inline 成字符串
 * 字面量；本声明让 tsc 也把 `import sql from './x.sql'` 视作 `string`。
 */
declare module '*.sql' {
  const content: string
  export default content
}
