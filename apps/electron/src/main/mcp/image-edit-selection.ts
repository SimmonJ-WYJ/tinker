import { ImageAssets } from './image-assets.ts'
/** 结果卡明确选择的图片版本优先于模型参数，禁止静默替换。 */
export function bindImageEditSelection(selected:string|undefined,requested:string|undefined):string|undefined {
 if(selected && requested && selected!==requested) throw new Error('Selected image version mismatch; use the exact selected baseImageId, never latest or another version.')
 return selected??requested
}

/** 在任何语言模型调用前检查确定版本仍属于本会话且文件存在。 */
export function validateImageEditSelection(directory: string, selected: unknown): void {
 if (selected === undefined) return
 if (typeof selected !== 'string' || !/^[\w-]{1,128}$/.test(selected) || selected === 'latest') throw new Error('Invalid selected version')
 new ImageAssets(directory).get(selected)
}
