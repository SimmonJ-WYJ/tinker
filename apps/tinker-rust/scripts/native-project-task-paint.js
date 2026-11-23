// 在已保存的 QA 窗口像素上识别文字；只加载本机 Vision，无需控制其他应用。
ObjC.import('Foundation')
ObjC.import('Vision')

function run(args) {
  const url = $.NSURL.fileURLWithPath(args[0])
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}))
  const request = $.VNRecognizeTextRequest.alloc.init
  const error = Ref()
  if (!handler.performRequestsError($([request]), error)) throw new Error('Unable to read the QA screenshot')
  const lines = []
  for (let i = 0; i < request.results.count; i++) {
    const observation = request.results.objectAtIndex(i)
    lines.push(ObjC.unwrap(observation.topCandidates(1).firstObject.string))
  }
  return lines.join('\n')
}
