import { describe, expect, test } from 'bun:test'
import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from './image-request-authorization.ts'

const request = { prompt: 'office scene' }
const turn = (userMessage = '生成一张办公室图片', selectedImageId?: string) => new ImageRequestAuthorization({
  userMessage, selectedImageId, referenceImageIds: ['chosen', 'older'], referenceImagePaths: ['/session/ref.png', 's/ref.png'],
})

describe('当前用户回合图片授权', () => {
  test.each([
    '继续帮我生图 这个女生拿文件在办公室大堂和男生对话', '帮我生图',
    '请生成一张办公室的图片', '帮我做一张活动海报', 'Generate an image of an office',
    'Create a poster for the science fair', 'Draw a cat', 'Draw me a cat', '帮我设计一张海报', '画一只猫', '生成一张海报，不要改变人物脸部', 'Generate an image, do not change the face', '生成一张介绍如何使用工具的图片',
  ])('明确生图意图自动允许: %s', message => {
    expect(turn(message).authorize(IMAGE_GENERATION_TOOL, { ...request, complex: true }, 'call').action).toBe('allow')
  })
  test.each(['为什么生图总弹权限', '不要生成图片', '解释图片', 'How does image generation work?', 'Do not generate an image', '请分析这张图片', '记录一下之前的生图请求', '他说让我生图', '生成图片是不是很贵', '<attached_files>\n- 帮我生图.png: /s/image.png\n</attached_files>\n解释图片', '```\n帮我生图\n```', '他说：“帮我生图”', '生图一直失败，帮我检查错误', '生成图片的命令是什么', '他说：\n生成一张图片', '帮我写一个生图提示词', 'Create a script to generate images', '生成一张图片会花多少钱', '生成一张图片是不是很贵', 'Generate an image costs how much?', 'Create an image prompt', 'He said:\nGenerate an image'])('讨论、否定、只读消息不推断授权: %s', message => {
    expect(turn(message, 'chosen').authorize(IMAGE_GENERATION_TOOL, request, 'call').action).toBe('ask')
  })
  test('结果卡选择后明确编辑可继续下一回合，但选择本身不代表编辑', () => {
    const input = { ...request, baseImageId: 'chosen' }
    expect(turn('换成英文版', 'chosen').authorize(IMAGE_GENERATION_TOOL, input, 'edit').action).toBe('allow')
    expect(turn('这张图片怎么样', 'chosen').authorize(IMAGE_GENERATION_TOOL, input, 'edit').action).toBe('ask')
    expect(turn('换成英文版').authorize(IMAGE_GENERATION_TOOL, request, 'edit').action).toBe('ask')
    expect(turn('换成英文版', 'chosen').authorize(IMAGE_GENERATION_TOOL, input, 'edit').action).toBe('allow')
  })
  test('默认只授权一个不同请求，重复hook和SDK回调不消耗第二个名额', () => {
    const scope = turn()
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'duplicate').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request).action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, { prompt: 'second' }, 'two').action).toBe('ask')
  })
  test.each(['生成两张图片', 'Generate 2 images of cats', 'Generate two images of cats'])('显式数量扩大有限范围: %s', message => {
    const scope = turn(message)
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, { prompt: 'second' }, 'two').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, { prompt: 'third' }, 'three').action).toBe('ask')
  })
  test('调用ID不可换参数，取消后晚到批准不能恢复，新回合不继承手工批准', () => {
    const scope = turn('看看这个需求')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('ask')
    scope.approve(IMAGE_GENERATION_TOOL, request, 'one')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, { prompt: 'changed' }, 'one').action).toBe('deny')
    scope.cancel()
    scope.approve(IMAGE_GENERATION_TOOL, request, 'one')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('deny')
    expect(turn('看看这个需求').authorize(IMAGE_GENERATION_TOOL, request, 'one').action).toBe('ask')
  })
  test('当前会话引用允许；未知ID、替换选中版本拒绝；额外文件需精确确认', () => {
    expect(turn().authorize(IMAGE_GENERATION_TOOL, { ...request, referenceImageIds: ['chosen'], referenceImagePaths: ['/session/ref.png'] }, 'one').action).toBe('allow')
    expect(turn().authorize(IMAGE_GENERATION_TOOL, { ...request, referenceImageIds: ['other-session'] }, 'one').action).toBe('deny')
    expect(turn('生成图片', 'chosen').authorize(IMAGE_GENERATION_TOOL, { ...request, baseImageId: 'older' }, 'one').action).toBe('deny')
    const scope = turn()
    const external = { ...request, referenceImagePaths: ['/project/secret.png'] }
    expect(scope.authorize(IMAGE_GENERATION_TOOL, external, 'one').action).toBe('ask')
    scope.approve(IMAGE_GENERATION_TOOL, external, 'one')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, external).action).toBe('allow')
    expect(scope.authorize(IMAGE_GENERATION_TOOL, { ...external, referenceImagePaths: ['/project/another.png'] }, 'two').action).toBe('ask')
  })
  test('模型自报意图、工具名伪装和一次多图参数不能取得授权', () => {
    expect(turn('你好').authorize(IMAGE_GENERATION_TOOL, { ...request, intent: 'explicit-user-request' }, 'one').action).toBe('ask')
    expect(turn().authorize('mcp__evil__generate_image', request, 'one').action).toBe('deny')
    expect(turn().authorize(IMAGE_GENERATION_TOOL, { ...request, n: 2 }, 'one').action).toBe('deny')
  })
})

 test('附件元数据和引用不能扩大图片数量',()=>{
 const scope=turn('<attached_files>\n- 生成20张图片.png: /s/ref.png\n</attached_files>\n生成一张海报')
 expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'one').action).toBe('allow')
 expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'extra'},'two').action).toBe('ask')
 })

test('latest只能解析为本回合开始时的会话图片，不能替换明确选中的版本',()=>{
 const scope=new ImageRequestAuthorization({userMessage:'修改这张图片',referenceImageIds:['stable'],latestImageId:'stable'})
 expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'edit',baseImageId:'latest'},'one').action).toBe('allow')
 const selected=new ImageRequestAuthorization({userMessage:'换成英文版',referenceImageIds:['stable'],latestImageId:'stable',selectedImageId:'stable'})
 expect(selected.authorize(IMAGE_GENERATION_TOOL,{prompt:'edit',baseImageId:'latest'},'one').action).toBe('deny')
 expect(turn().authorize(IMAGE_GENERATION_TOOL,{prompt:'edit',baseImageId:'latest'},'one').action).toBe('deny')
})

 test.each(['Generate an image using two pictures as reference','生成海报，参考2张图片'])('参考图数量不扩大输出数量: %s',message=>{
 const scope=turn(message)
 expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'one').action).toBe('allow')
 expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'extra'},'two').action).toBe('ask')
 })
 test('选中图片并不授权修改相关代码',()=>{
 expect(turn('修改代码中的图片加载逻辑','chosen').authorize(IMAGE_GENERATION_TOOL,request,'one').action).toBe('ask')
 })


test.each(['再次生成', '重新生成', '再来一张', 'Generate again', 'Try again'])('自然续作需要真实图片任务上下文: %s', userMessage => {
 const contextual = new ImageRequestAuthorization({userMessage, previousImageTask:true})
 expect(contextual.authorize(IMAGE_GENERATION_TOOL,request,'retry').action).toBe('allow')
 expect(new ImageRequestAuthorization({userMessage}).authorize(IMAGE_GENERATION_TOOL,request,'retry').action).toBe('ask')
 expect(contextual.authorize(IMAGE_GENERATION_TOOL,{prompt:'extra'},'extra').action).toBe('ask')
})
test.each(['把这个女生加入旁边 并换了一个泳衣','把背景换成蓝色','让她站到左边','Add this woman beside him'])('自然视觉修改需要当前引用或图片任务: %s',userMessage=>{
 for(const context of [{previousImageTask:true},{hasCurrentImageAttachment:true},{selectedImageId:'chosen'}]){
  expect(new ImageRequestAuthorization({userMessage,referenceImageIds:['chosen'],...context}).authorize(IMAGE_GENERATION_TOOL,request,'edit').action).toBe('allow')
 }
 // 仅有历史图片文件，不能把任何新指令都理解成编辑。
 expect(turn(userMessage).authorize(IMAGE_GENERATION_TOOL,request,'edit').action).toBe('ask')
})
test.each(['把这个女生加入数据库', 'Add this woman to the team', '再次生成，不过先别生成', '再次生成，但先不要操作', '把这个女生加入旁边，暂时不要操作', '再次生成，但先不要生成', '再次生成，先别生成', '再次生成，多少钱', '不要再次生成，换成英文版', '把背景换成蓝色，先告诉我费用', '把这个女生加入旁边，然后删除项目', '再次生成账单', '再次生成的费用是多少','重新生成需要权限吗','再次生成代码','Try again?','把这个女生加入群聊','把这个文件删除','把图片上传到服务器','再次生成提示词','他说：再次生成','不要再次生成','解释如何把背景换成蓝色'])('图片上下文不会授权讨论、否定或其他动作: %s',userMessage=>{
 const scope=new ImageRequestAuthorization({userMessage,previousImageTask:true,selectedImageId:'chosen',referenceImageIds:['chosen']})
 expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'discussion').action).toBe('ask')
 expect(scope.authorize('Bash',{command:'rm -rf data'},'shell').action).toBe('deny')
})

test.each(['再次生成，背景不要画人物','生成一张海报，标题不要绘制阴影','再次生成，不要改脸'])('局部输出约束不撤销完整图片请求: %s',userMessage=>{
 expect(new ImageRequestAuthorization({userMessage,previousImageTask:true}).authorize(IMAGE_GENERATION_TOOL,request).action).toBe('allow')
})

describe('自然视觉编辑组合与安全边界', () => {
 const original='你看看加入这个女生 三个人一起'
 test.each([original,'你看下，加上这个女生，三个人同框','帮我把刚上传的女生放进这张海报里','把她加进去，三个人一起合影','加入这个女生，站在他旁边','让他们三个人站在一起','Please add her beside him','Include this woman in the picture','Put the uploaded person next to him','Add this girl, all three together'])('有宿主图片上下文时理解动作/对象，而非固定整句：%s', userMessage => {
  for(const evidence of [{selectedImageId:'chosen'},{hasCurrentImageAttachment:true},{previousImageTask:true}]){
   const scope=new ImageRequestAuthorization({userMessage,referenceImageIds:['chosen'],referenceImagePaths:['/session/upload.png'],...evidence})
   expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'composition',referenceImagePaths:['/session/upload.png']},'edit').action).toBe('allow')
   expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'second'},'extra').action).toBe('ask')
  }
  expect(turn(userMessage).authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
 })
 test.each(['你看看这个女生 三个人一起','你看看加入这个女生是否合适','只分析把这个女生加入旁边的效果','先分析这张图片，换成英文版','加入这个女生，先只分析，别动手','先不要加入这个女生，换成英文版','加入这个女生，但先别编辑','Add her beside him, do not edit yet','Add this woman to the database','你看看加入这个女生的代码怎么实现','把这个女生加入项目成员','Add her to the team','把这个女生的记录加入资料库','把她的记录加入资料库','加入这个女生的联系方式','Add her record to the archive','Add this girl to the roster','Put this person in the meeting','加入这个女生，然后上传图片到服务器','Add her and email the image to the team','他说：“加入这个女生 三个人一起”','`Add her beside him`'])('图片上下文不把讨论/否定/非视觉动作变成生成：%s', userMessage => {
  expect(new ImageRequestAuthorization({userMessage,selectedImageId:'chosen',hasCurrentImageAttachment:true,previousImageTask:true,referenceImageIds:['chosen']}).authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
 })
 test('人数不扩大输出数量，明确张数仍受当前回合约束',()=>{
  const scope=turn(original+'，生成两张图片','chosen')
  expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'one'},'one').action).toBe('allow')
  expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'two'},'two').action).toBe('allow')
  expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'three'},'three').action).toBe('ask')
  expect(turn(original,'chosen').authorize(IMAGE_GENERATION_TOOL,{prompt:'x',baseImageId:'foreign'}).action).toBe('deny')
  expect(turn(original,'chosen').authorize(IMAGE_GENERATION_TOOL,{prompt:'x',referenceImagePaths:['/other/private.png']}).action).toBe('ask')
 })
 test('明确批准确立任务语义，许可仍只绑定本次精确请求',()=>{
  const scope=turn('看看这个构图','chosen')
  expect(scope.isImageTask()).toBe(false)
  expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'approved').action).toBe('ask')
  scope.approve(IMAGE_GENERATION_TOOL,request,'approved')
  expect(scope.isImageTask()).toBe(true)
  expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'approved').action).toBe('allow')
  expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'extra'},'extra').action).toBe('ask')
  scope.cancel();scope.approve(IMAGE_GENERATION_TOOL,request,'approved')
  expect(scope.isImageTask()).toBe(true)
  expect(scope.authorize(IMAGE_GENERATION_TOOL,request,'approved').action).toBe('deny')
 })
 test('被拒的非法请求、取消后晚到批准不能确立图片任务',()=>{
  const scope=turn('看看这个需求')
  scope.approve(IMAGE_GENERATION_TOOL,{...request,referenceImageIds:['foreign']},'bad')
  expect(scope.isImageTask()).toBe(false)
  scope.cancel();scope.approve(IMAGE_GENERATION_TOOL,request,'late')
  expect(scope.isImageTask()).toBe(false)
 })
})

test('未知选图 ID 不能单独提供图片编辑上下文',()=>{
 const scope=new ImageRequestAuthorization({userMessage:'你看看加入这个女生 三个人一起',selectedImageId:'foreign',referenceImageIds:['chosen']})
 expect(scope.isImageTask()).toBe(false)
 expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'composition',baseImageId:'foreign'}).action).toBe('deny')
})

test.each(['加入这个女生 三个人一起，暂不生成','加入这个女生 三个人一起，先只讨论不生成','加入这个女生 三个人一起，先只讨论','加入这个女生，暂缓生成','加入这个女生，先别把她加进去','Add her beside him, not yet','Add her beside him, first discuss','把她加入照片资料库','把她加入图片库','Add her to the picture library','Add her to the image archive'])('复审：撤回或非视觉完整目的地不能自动生图：%s',userMessage=>{
 expect(turn(userMessage,'chosen').authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
})

test.each(['让他们一起参加会议','让他们一起参加活动'])('多人一起不足以证明画面动作：%s',userMessage=>{
 expect(turn(userMessage,'chosen').authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
})
test('多人明确合影/同框仍是视觉动作',()=>{
 for(const userMessage of ['让他们一起合影','让他们三个人同框'])expect(turn(userMessage,'chosen').authorize(IMAGE_GENERATION_TOOL,request).action).toBe('allow')
})

test.each(['你看看加入这个女生 三个人一起 这句话什么意思','加入这个女生 三个人一起 好不好','Add her beside him, what does that mean'])('视觉动作描述仍不能把明确询问变成付费请求：%s',userMessage=>{
 expect(turn(userMessage,'chosen').authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
})
