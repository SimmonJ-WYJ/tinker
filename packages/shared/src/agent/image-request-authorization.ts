/** 当前用户回合的纯图片授权边界；不读取文件、SDK 或模型输出。 */
export const IMAGE_GENERATION_TOOL = 'mcp__asci-image__generate_image'
export interface ImageAuthorizationDecision { action: 'allow' | 'ask' | 'deny'; reason: string }
export interface ImageAuthorization {
  /** 宿主流内用户回合标识，权限缓存不得跨回合复用。 */
  getScopeId?(): string
  authorize(toolName: string, input: Record<string, unknown>, toolUseID?: string): ImageAuthorizationDecision
  approve(toolName: string, input: Record<string, unknown>, toolUseID?: string): void
}
export interface ImageAuthorizationContext {
  userMessage: string
  selectedImageId?: string
  /** 宿主在回合开始时解析的稳定版本，禁止跟随生成结果漂移。 */
  latestImageId?: string
  /** 宿主从已消费用户回合重建，只传任务语义，不传旧批准。 */
  previousImageTask?: boolean
  /** 宿主验证当前消息所附文件为本会话真实图片。 */
  hasCurrentImageAttachment?: boolean
  referenceImageIds?: readonly string[]
  referenceImagePaths?: readonly string[]
}
/** 参数按键排序，供重复 hook / SDK 通知和执行边界比较同一请求。 */
export function imageRequestKey(input: Record<string, unknown>): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]))
    return value
  }
  return JSON.stringify(normalize(input))
}

function stripRequestPrefix(message: string): string {
  return message.replace(/^(?:(?:请|帮我|给我|继续|再|直接|现在|麻烦|然后)\s*)+/, '').replace(/^(?:(?:please|can you|could you|help me|continue(?: to)?|now|then|i want you to)\s+)+/i, '')
}

function isGenerationClause(message: string): boolean {
  const request = stripRequestPrefix(message)
  if (/^生图(?:\s|吧|就行|$)/.test(request)) return !/失败|错误|权限|命令|提示词|是什么/.test(request)
  if (/^(?:生成|绘制|画|制作|设计|做)/.test(request)) {
    if (/^(?:生成|绘制|制作|设计|做)\s*(?:图片|图像|海报|插画)(?:的)?(?:命令|提示词|代码|脚本|教程|方法|流程|权限|一直失败|总是失败|是什么|是不是)/.test(request)) return false
    const target=[...request.matchAll(/图片|图像|海报|插画|张图/g)].at(-1)
    const afterTarget=target ? request.slice(target.index!+target[0].length) : ''
    if (/多少钱|花费|费用|是不是|是否|[吗么]|为何|为什么|怎么|如何|命令|提示词|失败|错误/.test(afterTarget)) return false
    return /^(?:生成|绘制|画|制作|设计|做).{0,100}(?:图片|图像|海报|插画|张图)|^画一[只个张幅]/.test(request)
  }
  if (!/^(?:generate|create|make|draw|render)\b/i.test(request)) return false
  const noun = request.match(/\b(?:images?|pictures?|posters?|illustrations?|photos?)\b/i)
  if (noun) {
    const afterTarget=request.slice(noun.index!+noun[0].length)
    if (/^\s+(?:costs?|is|would|does|can|should|prompts?|scripts?|code|commands?|tutorials?)\b|\bhow much\b/i.test(afterTarget)) return false
    return !/\b(?:script|code|prompt|command|tutorial|instructions?|explanation)\b/i.test(request.slice(0, noun.index))
  }
  return /^draw\s+(?:me\s+)?(?:a|an|the)\b/i.test(request)
}

function requestedImageCount(message: string): number {
  const clause = message.split(/[，,。.!?？！？；;\n]/).map(part => part.trim()).find(isGenerationClause)
  if (!clause) return 1
  const request = stripRequestPrefix(clause)
  const chinese: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const english = request.match(/^(?:generate|create|make|draw|render)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:images?|pictures?|posters?)\b/i)
  if (english) return ['one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(english[1]!.toLowerCase()) + 1
  const match = request.match(/^(?:生成|绘制|画|制作|设计|做)\s*(\d{1,3}|[一二两三四五六七八九十])\s*(?:张|幅)/)
    ?? request.match(/^(?:generate|create|make|draw|render)\s+(\d{1,3})\s+(?:images?|pictures?|posters?)\b/i)
  const count = match ? chinese[match[1]!] ?? Number(match[1]) : 1
  return Math.max(1, Math.min(20, count))
}

/** 附件标签、引用与代码是数据，不能提供或扩大用户操作授权。 */
function visibleUserMessage(message: string): string {
  return message
    .replace(/<([a-z_][\w:-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<attached_files\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*`|“[^”]*”|「[^」]*」|"[^"\n]*"/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/^[^\n]*(?:他说|她说|转述|引用|\b(?:said|says|quote|quoted)\b)[^\n]*[：:]\s*\n[\s\S]*$/gim, ' ')
    .trim()
}

export function requestsImage(context: ImageAuthorizationContext): boolean {
  const visible = visibleUserMessage(context.userMessage)
  const contextualDiscussion = /费用|多少钱|花费|权限|提示词|命令|教程|方法|是否|是不是|怎么|如何|为什么|为何|[吗么？?]|群聊|好友|通讯录|上传|发送|删除|支付|购买|\b(?:cost|price|permission|prompt|command|tutorial|how|why|chat|contact|upload|send|delete|pay|buy)\b/i.test(visible)
  const clauses = visible.split(/[，,。.!?？！？；;\n]/).map(part => part.trim()).filter(Boolean)
  // 否定整次生成/执行会撤回授权；命名画面局部的约束不撤回整体请求。
  if (clauses.some(clause => {
    const negative = clause.match(/(?:不要|别|无需|不用|不需要)\s*(?:再次|重新|继续|再|先)?\s*(?:生成|生图|绘制|画|制作|设计|操作|执行|开始|动手)|\b(?:do not|don't|never)\s+(?:generate|create|draw|render|make|proceed|act|do anything)\b/i)
    if (!negative) return false
    const subject = clause.slice(0, negative.index)
    return !/(?:背景|标题|文字|字体|阴影|人物|衣服|颜色)(?:里|中|上|部分)?\s*$|\b(?:background|title|text|font|shadow|clothes|color)\s*$/i.test(subject)
  })) return false
  return clauses.some(message => {
    if (isGenerationClause(message)) return true
    const request=stripRequestPrefix(message)
    if (/代码|逻辑|函数|实现|脚本|程序|组件|\b(?:code|script|function|component)\b/i.test(request)) return false
    // 省略宾语的续作只能借用已消费图片任务，不能仅凭磁盘存在图片。
    const contextual = context.previousImageTask || context.selectedImageId || context.hasCurrentImageAttachment
    if (context.previousImageTask && !contextualDiscussion && /^(?:(?:请|帮我|给我)\s*)*(?:再次生成|重新生成|再生成|再来一张|重试一下|重试)(?:吧|一下)?$|^(?:please\s+)?(?:generate(?: it)? again|regenerate|try again)$/i.test(message)) return true
    const hasReference = Boolean(context.referenceImageIds?.length || context.referenceImagePaths?.length)
    const visualEdit = /^(?:把|将).{0,40}(?:女生|男生|女人|男人|人物|背景|衣服|泳衣|颜色|文字|字体|标题).{0,40}(?:加入(?:到)?(?:旁边|画面|图中)|加到(?:旁边|画面|图中)|放到(?:旁边|画面|图中)|换|改|变|移|调)|^让(?:她|他|人物).{0,30}(?:站|坐|穿|拿|移)|^(?:add|move|place|dress)\s+(?:(?:this|that|the)\s+)?(?:woman|man|girl|boy|person|character)\b.{0,30}\b(?:beside|next to|left|right|background|picture|image|wearing)\b/i.test(request)
    if (contextual && hasReference && visualEdit && !contextualDiscussion) return true
    const pictureTarget=/^(?:修改|调整|替换|重画|重做|翻译)(?:这|那|选中|当前|刚才|上一|原)?(?:张)?(?:图片|图像|图|海报)/.test(request)
      || /^(?:change|edit|replace|translate|modify)\s+(?:(?:this|that|the|selected)\s+)?(?:image|picture|poster|photo)\b/i.test(request)
    const selectedTransform=/^(?:换成|改成|改为)|^(?:change|translate)\s+(?:it\s+)?(?:to|into)\b/i.test(request)
    return Boolean((pictureTarget && (context.referenceImageIds?.length || context.referenceImagePaths?.length)) || (context.selectedImageId && selectedTransform))
  })
}

export class ImageRequestAuthorization implements ImageAuthorization {
  private cancelled = false
  private readonly identities = new Map<string, string>()
  private readonly approved = new Set<string>()
  private readonly ids: Set<string>
  private readonly paths: Set<string>
  private readonly automatic: boolean
  private readonly limit: number

  constructor(private readonly context: ImageAuthorizationContext) {
    this.ids = new Set(context.referenceImageIds)
    this.paths = new Set(context.referenceImagePaths)
    this.automatic = requestsImage(context)
    this.limit = requestedImageCount(visibleUserMessage(context.userMessage))
  }

  authorize(toolName: string, input: Record<string, unknown>, toolUseID?: string): ImageAuthorizationDecision {
    const decision = (action: ImageAuthorizationDecision['action'], reason: string): ImageAuthorizationDecision => ({ action, reason })
    if (this.cancelled) return decision('deny', 'Image request turn has ended')
    if (toolName !== IMAGE_GENERATION_TOOL) return decision('deny', 'Image authorization applies only to the host image tool')
    const key = imageRequestKey(input)
    if (toolUseID) {
      const prior = this.identities.get(toolUseID)
      if (prior !== undefined && prior !== key) return decision('deny', 'Image call identity changed its parameters')
      this.identities.set(toolUseID, key)
    }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) return decision('deny', 'Image prompt is required')
    if (['n', 'count', 'numberOfImages'].some(field => input[field] !== undefined && input[field] !== 1)) return decision('deny', 'Each image call must generate exactly one image')
    const selected = this.context.selectedImageId
    if (selected && input.baseImageId !== undefined && input.baseImageId !== selected) return decision('deny', 'Use the exact selected image version')
    const refs = input.referenceImageIds ?? []
    const paths = input.referenceImagePaths ?? []
    if (!Array.isArray(refs) || !Array.isArray(paths) || [...refs, ...paths].some(item => typeof item !== 'string')) return decision('deny', 'Invalid image references')
    if (selected && !this.ids.has(selected)) return decision('deny', 'Selected image is outside this session')
    const resolveId = (id: string): string => id === 'latest' ? this.context.latestImageId ?? '' : id
    if (input.baseImageId !== undefined && (typeof input.baseImageId !== 'string' || !this.ids.has(resolveId(input.baseImageId)))) return decision('deny', 'Base image is outside this session')
    if (refs.some(id => !this.ids.has(resolveId(id)))) return decision('deny', 'Reference image is outside this session')
    if (this.approved.has(key)) return decision('allow', 'This exact image request is authorized for this user turn')
    if (paths.some(path => !this.paths.has(path))) return decision('ask', 'Sending an additional image file requires approval')
    if (!this.automatic) return decision('ask', 'Current user message does not explicitly request image generation or editing')
    if (this.approved.size >= this.limit) return decision('ask', 'Image request exceeds the count authorized for this user turn')
    this.approved.add(key)
    return decision('allow', 'Current user explicitly requested this image')
  }

  approve(toolName: string, input: Record<string, unknown>, toolUseID?: string): void {
    if (this.authorize(toolName, input, toolUseID).action !== 'deny') this.approved.add(imageRequestKey(input))
  }

  /** 只由宿主在成功保存新图片后扩展可引用集合。 */
  addReference(id: string, paths: readonly string[]): void {
    if (this.cancelled) return
    this.ids.add(id)
    for (const path of paths) this.paths.add(path)
  }

  /** 生命周期取消不改变任务类别；新用户续作仍需建立全新的授权对象。 */
  isImageTask(): boolean { return this.automatic }

  cancel(): void { this.cancelled = true; this.approved.clear() }
}
