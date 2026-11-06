import {test,expect} from 'bun:test'
import {codingSandbox} from './coding-sandbox'
test('智能审批仅在隔离成功后自动执行，禁止联网和无限制回退',()=>{
 const policy=codingSandbox('/project')
 expect(policy.enabled).toBe(true)
 expect(policy.failIfUnavailable).toBe(true)
 expect(policy.autoAllowBashIfSandboxed).toBe(true)
 expect(policy.allowUnsandboxedCommands).toBe(false)
 expect(policy.network?.deniedDomains).toEqual(['*'])
 expect(policy.filesystem?.allowWrite).toEqual(['/project'])
 expect(policy.filesystem?.denyWrite).toContain('/project/.git')
})
