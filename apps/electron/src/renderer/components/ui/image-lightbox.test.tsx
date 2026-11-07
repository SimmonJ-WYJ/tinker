import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImageLightbox } from './image-lightbox.tsx'
import { setAppLanguage } from '@/lib/i18n'
afterEach(async()=>{cleanup();await act(async()=>{await setAppLanguage('en')})})
const src='data:image/png;base64,cG5n'
function loadedImage(width=2000,height=1000){
 const image=screen.getByRole('img',{name:'fixture.png'}) as HTMLImageElement
 Object.defineProperty(image,'naturalWidth',{configurable:true,value:width})
 Object.defineProperty(image,'naturalHeight',{configurable:true,value:height})
 fireEvent.load(image);return image
}
test('放大缩小与适应窗口不改变原图比例，重新打开不沿用旧缩放',async()=>{
 await setAppLanguage('en')
 const close=mock(()=>{})
 const view=render(<ImageLightbox src={src} alt="fixture.png" open onOpenChange={close}/>)
 const image=loadedImage();const fitted=parseFloat(image.style.width)
 expect(fitted).toBeGreaterThan(0);expect(parseFloat(image.style.height)).toBeCloseTo(fitted/2)
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}))
 expect(parseFloat(image.style.width)).toBeGreaterThan(fitted)
 expect(parseFloat(image.style.height)).toBeCloseTo(parseFloat(image.style.width)/2)
 fireEvent.click(screen.getByRole('button',{name:'Fit to window'}))
 expect(parseFloat(image.style.width)).toBeCloseTo(fitted)
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}))
 view.rerender(<ImageLightbox src={src} alt="fixture.png" open={false} onOpenChange={close}/>)
 view.rerender(<ImageLightbox src={src} alt="fixture.png" open onOpenChange={close}/>)
 expect(parseFloat(loadedImage().style.width)).toBeCloseTo(fitted)
})
test('保存及有名称的关闭按钮可用，Escape不触发保存',async()=>{
 await setAppLanguage('en');const save=mock(()=>{});const close=mock(()=>{})
 render(<ImageLightbox src={src} alt="fixture.png" open onOpenChange={close} onSave={save}/>)
 loadedImage();fireEvent.click(screen.getByRole('button',{name:'Save image'}));expect(save).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(close).toHaveBeenCalledWith(false)
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(save).toHaveBeenCalledTimes(1)
})
test('解码失败有中文提示和关闭入口，不继续保存损坏内容',async()=>{
 await setAppLanguage('zh');const save=mock(()=>{})
 render(<ImageLightbox src={src} alt="fixture.png" open onOpenChange={()=>{}} onSave={save}/>)
 fireEvent.error(screen.getByRole('img',{name:'fixture.png'}))
 expect(screen.getByRole('alert')).toHaveTextContent('图片加载失败')
 expect(screen.getByRole('button',{name:'放大'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'保存图片'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'关闭'})).toBeEnabled()
})

test('关闭后恢复打开按钮的键盘焦点',async()=>{
 await setAppLanguage('en');const close=mock(()=>{})
 const view=render(<><button>Open fixture</button><ImageLightbox src={src} alt="fixture.png" open={false} onOpenChange={close}/></>)
 const opener=screen.getByRole('button',{name:'Open fixture'});opener.focus()
 view.rerender(<><button>Open fixture</button><ImageLightbox src={src} alt="fixture.png" open onOpenChange={close}/></>)
 loadedImage();view.rerender(<><button>Open fixture</button><ImageLightbox src={src} alt="fixture.png" open={false} onOpenChange={close}/></>)
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 expect(document.activeElement).toBe(opener)
})
