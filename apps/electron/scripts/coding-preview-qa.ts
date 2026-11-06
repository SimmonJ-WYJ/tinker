import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {htmlPreviewServer} from '../src/main/lib/html-preview/server'
const path=process.env.ASCI_HTML_QA_FILE
if(!path)throw new Error('Set ASCI_HTML_QA_FILE to a test HTML page')
const html=await readFile(path,'utf8');const url=await htmlPreviewServer.open(path)
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src 'self' http://127.0.0.1:*"
createServer((req,res)=>{
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp})
 const after=req.url?.includes('after')
 res.end(`<html><head><title>ASCI ${after?'修复后':'修复前'}预览验证</title></head><body style="margin:0;background:#eee"><p style="height:30px;margin:12px;font:16px sans-serif">${after?'修复后：隔离预览，验证加减和重置':'修复前：srcDoc 继承主界面 CSP'}</p><iframe title="计数器预览" style="border:0;width:100%;height:calc(100vh - 54px)" sandbox="allow-scripts" ${after?`src="${url}"`:`srcdoc="${escape(html)}"`}></iframe></body></html>`)
}).listen(5294,'127.0.0.1',()=>console.log('Preview QA: http://127.0.0.1:5294/before and /after'))
