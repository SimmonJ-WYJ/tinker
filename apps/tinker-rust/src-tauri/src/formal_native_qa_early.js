// 仅 QA 初始化脚本，在任何页面模块/React bootstrap 之前记录有界诊断。
(() => {
  const events = [];
  const record = (kind, detail) => { if (events.length < 128) events.push({kind, detail: String(detail).slice(0, 2000), at: performance.now()}); };
  Object.defineProperty(window, '__NATIVE_QA_EARLY__', {value: {installedAt: performance.now(), events}});
  for (const level of ['warn','error']) { const original=console[level]; console[level]=(...args)=>{ record('console:'+level,args.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x, Object.getOwnPropertyNames(x ?? {}))}catch{return String(x)}}).join(' ')); original.apply(console,args); }; }
  addEventListener('error', e => record(e.target !== window ? 'resource-error' : 'error', e.message || e.target?.src || e.target?.href || 'resource'), true);
  addEventListener('unhandledrejection', e => record('rejection', e.reason?.message || e.reason));
  addEventListener('securitypolicyviolation', e => record('csp', JSON.stringify({directive:e.violatedDirective,blocked:e.blockedURI,source:e.sourceFile,line:e.lineNumber,column:e.columnNumber})));
})();
