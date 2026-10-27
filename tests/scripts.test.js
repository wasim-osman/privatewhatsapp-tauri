// Run: npm install && npm test   (jsdom + fake-indexeddb exercise scripts/*.js)
const {JSDOM}=require('jsdom'); const fs=require('fs'); const assert=require('assert');
const P=require('path').join(__dirname,'..','scripts')+'/';
function mk(html){ const d=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}); return d; }
const APP=`<body><div id="app"><div><div class="banner">Get WhatsApp for Mac<button>x</button></div><div id="pane-side">chats</div><div id="main"><span aria-label="Voice call">v</span><span aria-label="Video call">c</span><span aria-label="Search">s</span><span aria-label="Typically fine">t</span><span aria-label="Call">c2</span><div id="msg" data-testid="msg-container"><div style="display:-webkit-box;overflow:hidden">long text<span id="rm">Read more</span></div></div></div></div></div></body>`;
async function cleanup(file,clk){
  const d=mk(APP); d.window.eval(fs.readFileSync(file,'utf8'));
  return d;
}
(async()=>{
 const d=await cleanup(P+'cleanup.js'); const D=d.window.document;
 assert.notStrictEqual(D.getElementById('app').style.display,'none','app hidden!');
 assert.strictEqual(D.getElementById('pane-side').style.display,'');
 assert.strictEqual(D.querySelector('.banner').style.display,'none','promo not hidden');
 // call labels via CSS rule present; typically not matched
 const css=D.querySelector('style').textContent;
 assert(css.includes('~="call"') && !css.includes('*="call"'));
 const sel=css.split('{')[0];
 const hidden=[...D.querySelectorAll(sel)].map(e=>e.getAttribute('aria-label')).filter(Boolean).sort();
 assert.deepStrictEqual(hidden,['Call','Video call','Voice call']);
 // read more click
 const rm=D.getElementById('rm'); rm.dispatchEvent(new d.window.MouseEvent('click',{bubbles:true}));
 const box=rm.parentElement;
 assert.strictEqual(box.style.display,'block'); assert.strictEqual(box.style.overflow,'visible');
 assert.strictEqual(rm.style.display,'none');
 console.log('cleanup OK');
 // menu items
 const m=D.createElement('div'); m.setAttribute('role','menu'); m.innerHTML='<li>New group</li><li>Send call link</li><li>New group call</li>'; D.body.appendChild(m);
 await new Promise(r=>setTimeout(r,400));
 assert.strictEqual(m.children[0].style.display,''); assert.strictEqual(m.children[1].style.display,'none'); assert.strictEqual(m.children[2].style.display,'none');
 console.log('menu OK');

 // callstate
 const c=mk('<body></body>'); c.window.eval(fs.readFileSync(P+'callstate.js','utf8'));
 c.window.document.body.innerHTML='<button aria-label="Accept call"></button><button aria-label="Decline call"></button>';
 await new Promise(r=>setTimeout(r,5300));
 assert.strictEqual(c.window.document.getElementById('pw-incoming-call').style.display,'block');
 c.window.document.body.querySelectorAll('button').forEach(b=>b.remove());
 await new Promise(r=>setTimeout(r,5300));
 assert.strictEqual(c.window.document.getElementById('pw-incoming-call').style.display,'none');
 console.log('callstate OK');

 // bridge + heartbeat
 const h=mk('<body></body>'); const ev=[]; h.window.__TAURI__={event:{emit:(e,p)=>ev.push(e)}};
 h.window.eval(fs.readFileSync(P+'bridge.js','utf8')+fs.readFileSync(P+'heartbeat.js','utf8'));
 assert.deepStrictEqual(ev,['heartbeat']); console.log('heartbeat OK');

 // retention with fake-indexeddb
 const fdb=require('fake-indexeddb'); const {IDBKeyRange}=fdb;
 const r=mk('<body></body>'); const w=r.window;
 w.indexedDB=fdb.indexedDB; w.IDBKeyRange=IDBKeyRange;
 const now=Date.now(); const N=1000;
 await new Promise((res,rej)=>{const q=fdb.indexedDB.open('wa-db',1);
  q.onupgradeneeded=()=>{const s=q.result.createObjectStore('message',{keyPath:'id'});};
  q.onsuccess=()=>{const tx=q.result.transaction('message','readwrite');const s=tx.objectStore('message');
   // first 600 keys recent, then 400 old: old script would never reach them
   for(let i=0;i<N;i++){const old=i>=600; s.put({id:('k'+String(i).padStart(5,'0')),t: old? Math.floor((now-30*864e5)/1000): Math.floor(now/1000)});}
   tx.oncomplete=()=>{q.result.close();res()};};q.onerror=rej;});
 // fake timers: shrink GAP by replacing setTimeout
 let src=fs.readFileSync(P+'retention.js','utf8').replace('var GAP = 1500','var GAP = 1').replace('var BATCHES = 5','var BATCHES = 10');
 const realST=w.setTimeout.bind(w);
 w.setTimeout=(f,ms,...a)=>realST(f,ms===300000?0:ms,...a);
 w.eval(src);
 await new Promise(r=>setTimeout(r,2500));
 const left=await new Promise(res=>{const q=fdb.indexedDB.open('wa-db');q.onsuccess=()=>{const c=q.result.transaction('message').objectStore('message').count();c.onsuccess=()=>res(c.result)}});
 console.log('messages left:',left); assert.strictEqual(left,600);
 // missing DB must not be created
 const dbs=await fdb.indexedDB.databases(); assert(!dbs.find(x=>x.name==='user-data'),'user-data created!');
 console.log('retention OK');
 process.exit(0);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
