/** 在已验证的图片上下文中组合识别动作、视觉对象和画面位置；不独立授予调用/文件许可。 */
const VISUAL_OBJECTS = '女生|男生|女人|男人|女孩|男孩|女士|先生|人物|人像|主体|背景|衣服|泳衣|颜色|文字|字体|标题|图片|图像|海报|照片'
const INSERT_ACTIONS = '加入|加上|添加|加进去|加进来|加进|加到|放进去|放进来|放入|放进|放到|放在|移入|合成|合并'
const EDIT_ACTIONS = `${INSERT_ACTIONS}|换|改|变|挪|移|调`
// 对象后的所有格只接受视觉属性，不能把“她的记录/联系方式”当作人物本身。
const OBJECT_TO_ACTION = '(?:\\s|也|再|都|一起|给我|稍微|现在|重新|的位置|的衣服|的颜色|的背景){0,8}'
const OBJECT_FIRST = new RegExp(`^(?:把|将).{0,40}(?:${VISUAL_OBJECTS})${OBJECT_TO_ACTION}(${EDIT_ACTIONS})(.*)$`)
const PRONOUN_FIRST = new RegExp(`^(?:把|将)\\s*(?:她们|他们|她|他)${OBJECT_TO_ACTION}(${EDIT_ACTIONS})(.*)$`)
const ACTION_FIRST = new RegExp(`^(${INSERT_ACTIONS}).{0,40}(?:${VISUAL_OBJECTS})(.*)$`)
const PRONOUN_AFTER_ACTION = new RegExp(`^(${INSERT_ACTIONS})\\s*(?:她们|他们|她|他)(.*)$`)
const INSERT_ACTION = new RegExp(`^(?:${INSERT_ACTIONS})$`)
const SCENE = /^(?:(?:到|在|进|入|至|原来|之前|这|那|当前|选中|上一|刚才|[一二两三四五六七八九十\d]+|张|幅|个|位|人|的|都|站|坐|她|他)\s*)*(?:旁边|画面|图片|图像|图中|海报|照片|左边|右边|左侧|右侧|背景|前景|中间|身边|一起|同框|合影|站|坐|穿|拿)(?:里面|之中|中间|里|中|上|内)?(?=$|[\s，,。.!]|并|然后|再|同时|接着|吧|就行)/
function visualDestination(tail: string): boolean {
  const text = tail.trim()
  if (!text || /^(?:吧|就行|一下)$/.test(text)) return true
  if (/^的/.test(text) && !/^的(?:衣服|颜色|背景|照片|图片|头像|人像|姿势|动作|位置)/.test(text)) return false
  return SCENE.test(text)
}
export function isContextualVisualEdit(message: string): boolean {
  const request = message.replace(/^(?:(?:你(?:先)?(?:看看|看下|看一下)|看看|看下|看一下|麻烦你|帮我|请|给我|继续|再|直接|现在|然后)\s*[，,：:]?\s*)+/, '')
  const objectFirst = request.match(OBJECT_FIRST) ?? request.match(PRONOUN_FIRST)
  if (objectFirst) return !INSERT_ACTION.test(objectFirst[1]!) || visualDestination(objectFirst[2]!)
  const actionFirst = request.match(ACTION_FIRST) ?? request.match(PRONOUN_AFTER_ACTION)
  if (actionFirst) return visualDestination(actionFirst[2]!)
  if (/^让(?:她们|他们|她|他|(?:这|那)?(?:些|[一二两三四五六七八九十\d]+)(?:个|位)?(?:人物|女生|男生|人))(?:(?:[一二两三四五六七八九十\d]+|个|位|人|也|都|再|一起|先)\s*){0,10}(?:站|坐|穿|拿|移|同框|合影|微笑)/.test(request)) return true
  const english = request.match(/^(?:add|include|insert|place|put|move|dress)\s+(?:(?:this|that|the|an?|uploaded|new|reference)\s+){0,4}(?:woman|man|girl|boy|person|people|character|her|him|them|image|picture|photo|poster)\b(.*)$/i)
  if (!english) return false
  const tail = english[1]!.trim()
  return !tail || /^(?:please|now)$/i.test(tail)
    || /^(?:beside\b|next to\b|left\b|right\b|wearing\b|so\b|[,;])/.test(tail.toLowerCase())
    || /^(?:in|into|on|to)\s+(?:(?:this|that|the|an?)\s+)?(?:picture|image|poster|photo|background|foreground|left|right|scene)(?=$|[,;]|\s+(?:beside|next to|on the|at the|and|while)\b)/i.test(tail)
    || /^in\s+(?:a\s+)?(?:swimsuit|dress|shirt|coat)(?=$|[,;]|\s+(?:beside|next to|and|while)\b)/i.test(tail)
}
