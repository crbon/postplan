import { BASE_CSS, ICON_SPRITE, esc, fmtExpiry, fmtSize, header } from "./pageShell";

/**
 * The page someone opens on a phone to send files in. Server-rendered, no build step.
 *
 * The wire protocol is untouched: for each file, POST `/api/u/<slug>/sign`, PUT the
 * bytes straight to the presigned S3 URL, then POST `/api/u/<slug>/record`. The page
 * runs under the same CSP as `/s/`, which is why `connect-src` has to name the bucket.
 */
export function uploadPage(
  slug: string,
  reason: string | undefined,
  files: { name: string; size: number }[],
  expiresAt: number,
): string {
  const sent = files.length
    ? `<p class="label">Sent · ${files.length}</p><ul class="sentlist">${files
        .map(
          (f) =>
            `<li><svg class="ok" viewBox="0 0 24 24"><use href="#i-check"/></svg><span class="n">${esc(
              f.name,
            )}</span><span class="z">${fmtSize(f.size)}</span></li>`,
        )
        .join("")}</ul>`
    : "";
  const title = reason && reason.trim() ? reason.trim() : "Send files";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000"><title>${esc(title)}</title>
<style>${BASE_CSS}
main{width:min(560px,calc(100% - 32px))}
.drop{display:block;margin:0 0 4px;padding:32px 18px;text-align:center;border:1.5px dashed var(--line-strong);
  border-radius:14px;background:var(--surface);cursor:pointer}
.drop:hover,.drop.over{border-color:#6a6963;background:var(--surface-2)}
.drop .plus{display:grid;place-items:center;width:46px;height:46px;margin:0 auto 12px;border-radius:50%;
  border:1px solid var(--line-strong);color:var(--ink);font:300 22px/1 var(--sans)}
.drop b{display:block;font-weight:600;font-size:15.5px}
.drop span{display:block;margin-top:3px;font-size:13.5px;color:var(--ink)}
input[type=file]{display:none}
.label{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);margin:22px 0 0}
.queue,.sentlist{list-style:none;margin:0;padding:0}
.queue li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);min-height:56px}
.queue .qn{min-width:0;flex:1}
.queue .qn b{display:block;font-weight:500;font-size:15px;overflow-wrap:anywhere;line-height:1.25}
.queue .qn span{font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.queue .ibtn{width:40px;height:40px;border:0;color:var(--ink)}
.queue .ibtn:hover{background:var(--surface-2);color:var(--critical)}
.track{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin:16px 0 8px}
.track .fill{height:100%;width:0;border-radius:3px;background:var(--s1)}
.track.done .fill{background:var(--good)}
.uprog{display:flex;gap:12px;justify-content:space-between;font-size:14.5px;color:var(--ink);
  font-variant-numeric:tabular-nums;min-height:20px}
.uprog #pct{color:var(--ink);font-size:13.5px}
.uprog .ok{color:var(--good)}
.uprog .bad{color:var(--critical)}
.sendwrap{margin-top:16px}
.sentlist li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);
  min-height:44px;color:var(--ink)}
.sentlist .ok{width:16px;height:16px;flex:none;stroke:var(--good);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.sentlist .n{flex:1;min-width:0;font-size:15px;overflow-wrap:anywhere}
.sentlist .z{font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
</style></head>
<body>${ICON_SPRITE}
<main>
${header(title, [
  { icon: "clock", text: fmtExpiry(expiresAt) },
  { icon: "stack", text: "any type, any size" },
])}
<label class="drop" id="drop">
  <input id="picker" type="file" multiple>
  <span class="plus">+</span>
  <b>Choose files</b>
  <span>or drop them here</span>
</label>
<p class="label" id="qlabel" hidden>Queue</p>
<ul class="queue" id="queue"></ul>
<div class="sendwrap"><button class="btn primary block" id="send" disabled>Send</button></div>
<div class="track" id="track" hidden><div class="fill" id="fill"></div></div>
<div class="uprog"><span id="status"></span><span id="pct"></span></div>
${sent}
</main>
<script>
var SLUG=${JSON.stringify(slug)};
var picker=document.getElementById('picker'),drop=document.getElementById('drop'),
    queue=document.getElementById('queue'),qlabel=document.getElementById('qlabel'),
    send=document.getElementById('send'),track=document.getElementById('track'),
    fill=document.getElementById('fill'),statusEl=document.getElementById('status'),
    pct=document.getElementById('pct');
var chosen=[];
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function fmt(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB'}
function kind(type,name){
  type=(type||'').toLowerCase();
  if(type.indexOf('image/')===0)return 'image';
  if(type.indexOf('video/')===0)return 'video';
  if(type.indexOf('audio/')===0)return 'audio';
  if(type==='application/pdf')return 'pdf';
  if(/\\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name))return 'archive';
  if(/\\.(xlsx?|xlsm|ods|numbers|csv)$/i.test(name))return 'sheet';
  if(type.indexOf('text/')===0||/\\.(md|txt|log|json|ya?ml|toml|ini|py|jsx?|tsx?|sh|sql|html?|css|rs|go)$/i.test(name))return 'text';
  return 'file';
}
function render(){
  queue.innerHTML=chosen.map(function(f,i){
    return '<li><svg class="icon"><use href="#i-'+kind(f.type,f.name)+'"/></svg>'+
      '<div class="qn"><b>'+esc(f.name)+'</b><span>'+fmt(f.size)+'</span></div>'+
      '<button class="ibtn" type="button" data-i="'+i+'" aria-label="Remove '+esc(f.name)+'">'+
      '<svg><use href="#i-x"/></svg></button></li>';
  }).join('');
  qlabel.hidden=!chosen.length;
  qlabel.textContent='Queue · '+chosen.length;
  send.disabled=!chosen.length;
  send.textContent=chosen.length?'Send '+chosen.length+' file'+(chosen.length>1?'s':''):'Send';
}
function add(list){chosen=chosen.concat([].slice.call(list));render()}
queue.addEventListener('click',function(e){
  var b=e.target.closest('button[data-i]'); if(!b)return;
  chosen.splice(+b.getAttribute('data-i'),1); render();
});
picker.addEventListener('change',function(){add(picker.files);picker.value=''});
['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over')})});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over')})});
drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files.length)add(e.dataTransfer.files)});
send.onclick=async function(){
  send.disabled=true; track.hidden=false; track.classList.remove('done'); var done=0, count=chosen.length;
  try{
    for(var i=0;i<chosen.length;i++){
      var f=chosen[i], type=f.type||'application/octet-stream';
      statusEl.className=''; statusEl.textContent='Sending '+f.name+'…';
      var r=await fetch('/api/u/'+SLUG+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:f.name,contentType:type})});
      if(!r.ok)throw new Error('Could not prepare upload ('+r.status+')');
      var slot=await r.json();
      var put=await fetch(slot.url,{method:'PUT',headers:{'Content-Type':type},body:f});
      if(!put.ok)throw new Error('Upload failed ('+put.status+')');
      var rec=await fetch('/api/u/'+SLUG+'/record',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key:slot.key,name:f.name,size:f.size,contentType:type})});
      if(!rec.ok)throw new Error('Could not record upload ('+rec.status+')');
      done++; fill.style.width=(done/count*100)+'%'; pct.textContent=Math.round(done/count*100)+'%';
    }
    track.classList.add('done');
    statusEl.className='ok'; statusEl.textContent='Sent '+done+' file'+(done>1?'s':'')+'. You can close this page.';
    chosen=[]; render(); setTimeout(function(){location.reload()},900);
  }catch(e){statusEl.className='bad'; statusEl.textContent=e.message; send.disabled=false}
};
render();
</script>
</body></html>`;
}
