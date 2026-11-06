import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadOnnxRuntime, loadSpeechRuntime, getFfmpegPath } from '../resources/optional-runtime'
import { OcrEngine } from '../resources/ocr-mcp/ocr-engine'
import { decodeAudioTo16kMono } from '../resources/asr-mcp/audio-decoder'
const root=process.env.ASCI_SLIM_QA_ROOT
if(!root) throw new Error('Set ASCI_SLIM_QA_ROOT to an isolated test directory')
mkdirSync(root,{recursive:true})
if(process.env.ASCI_SLIM_QA_OFFLINE==='1') globalThis.fetch=async()=>{throw new Error('Offline QA forbids network')}
const progress=(m:string)=>console.error(m)
async function main() {
 const ort=await loadOnnxRuntime(progress)
 console.log('ONNX Tensor:',new ort.Tensor('float32',new Float32Array([1]),[1]).type)
 const sherpa=await loadSpeechRuntime(progress) as { OfflineRecognizer?:unknown }
 if(typeof sherpa.OfflineRecognizer!=='function') throw new Error('Speech native module did not load')
 console.log('Speech native module: ready')
 console.log('FFmpeg:',await getFfmpegPath(progress))
 // 0.1s of PCM silence in a valid WAV container; exercises actual ffmpeg decoding.
 const samples=1600,buf=Buffer.alloc(44+samples*2)
 buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(16000,24);buf.writeUInt32LE(32000,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(samples*2,40)
 const wav=join(root,'silence.wav');writeFileSync(wav,buf)
 const decoded=await decodeAudioTo16kMono(wav)
 if(decoded.samples.length!==samples) throw new Error('Decoded sample count mismatch')
 console.log('FFmpeg decode:',decoded.samples.length,'samples')
 const nodeModules=process.env.ASCI_SLIM_QA_MODULES
 const models=process.env.ASCI_SLIM_QA_MODELS
 if(!nodeModules || !models) throw new Error('Set ASCI_SLIM_QA_MODULES and ASCI_SLIM_QA_MODELS')
 const sharp=createRequire(join(nodeModules,'entry.cjs'))('sharp')
 const image=join(root,'ocr.png')
 await sharp(Buffer.from('<svg width="600" height="150"><rect width="100%" height="100%" fill="white"/><text x="30" y="100" font-family="Arial" font-size="70" fill="black">HELLO ASCI</text></svg>')).png().toFile(image)
 const result=await new OcrEngine(models,progress).recognize(image)
 if(!result.text.toUpperCase().includes('HELLO')) throw new Error('OCR did not recognize fixture: '+result.text)
 console.log('OCR:',result.text)
}
main().catch(err=>{console.error(err);process.exitCode=1})
