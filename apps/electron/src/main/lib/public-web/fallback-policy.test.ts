import {test,expect} from 'bun:test'
import {denyLookupShellFallback,createLookupShellGuard} from './fallback-policy'
test('the reported ordinary Tesla lookup cannot escalate to repeated Python/curl approval prompts',()=>{
 const message='帮我检索下最新的特斯拉股票的消息 和公司动态'
 for(const command of ['python -c "import urllib.request; urllib.request.urlopen(\'https://example.com\')"','curl https://example.com','node -e "fetch(\'https://example.com\')"'])expect(denyLookupShellFallback(message,'search','Bash',{command})).toBe(true)
 expect(denyLookupShellFallback(message,'search','mcp__asci-web__search',{query:'Tesla'})).toBe(false)
})
test('explicit coding/terminal requests and unrelated local analysis retain normal host permission handling',()=>{
 const command='python -c "import urllib.request"'
 expect(denyLookupShellFallback('检索最新股票','coding','Bash',{command})).toBe(false)
 expect(denyLookupShellFallback('用 Python 查询最新股票','search','Bash',{command})).toBe(false)
 expect(denyLookupShellFallback('Write a Python script to search news','search','Bash',{command})).toBe(false)
 expect(denyLookupShellFallback('帮我计算数据','search','Bash',{command:'python -c "print(1+1)"'})).toBe(false)
})
test('guard returns deny before the SDK can ask for terminal approval',async()=>{
 const guard=createLookupShellGuard('search Tesla stock news','search')
 const result=await guard({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'curl https://example.com'}} as never,undefined,{signal:new AbortController().signal})
 expect(result).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}})
})

test('general web guard survives vague continuation and lookup wording variations', () => {
 for (const message of ['hello', '继续', '帮我找寻下rklb的公司近况', '核实这些来源']) {
  expect(denyLookupShellFallback(message, 'search', 'Bash', {command:'python -c "import urllib.request; urllib.request.urlopen(url)"'})).toBe(true)
 }
})
