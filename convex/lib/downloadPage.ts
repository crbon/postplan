import {
  BASE_CSS,
  ICON_SPRITE,
  esc,
  fmtDate,
  fmtExpiry,
  fmtSize,
  header,
  kindLabel,
  kindOf,
  type Kind,
} from "./pageShell";

export type SentFile = { name: string; size: number; contentType: string; url: string };

/** Past this many files the card layout gets too tall to scan, so rows take over. */
const ROWS_ABOVE = 6;

/** Text previews are fetched, not streamed, so they are capped rather than trusted. */
const TEXT_PREVIEW_BYTES = 20480;

type Item = SentFile & { i: number; kind: Kind; label: string; canPreview: boolean };

const dlBtn = (it: Item, label: boolean) =>
  `<a class="btn primary${label ? "" : " icononly"}" data-dl href="${esc(it.url)}" download="${esc(it.name)}"${
    label ? "" : ` aria-label="Download ${esc(it.name)}"`
  }><svg><use href="#i-dl"/></svg>${label ? "Download" : ""}</a>`;

const openBtn = (it: Item, label: boolean) =>
  `<a class="btn icononly" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(it.name)} in a new tab"><svg><use href="#i-ext"/></svg>${
    label ? "Open in new tab" : ""
  }</a>`;

const copyBtn = (it: Item, label: boolean) =>
  `<button class="btn icononly" type="button" data-copy="${esc(it.url)}" aria-label="Copy link to ${esc(it.name)}"><svg><use href="#i-link"/></svg>${
    label ? "Copy link" : ""
  }</button>`;

const previewBtn = (it: Item, label: boolean) =>
  `<button class="btn icononly" type="button" data-toggle="p${it.i}"${
    it.kind === "text" ? ` data-fetch="${esc(it.url)}"` : ""
  } aria-label="Preview ${esc(it.name)}"><svg><use href="#i-eye"/></svg>${label ? "Preview" : ""}</button>`;

/**
 * The preview panel for the things we refuse to load until asked. A PDF cannot be
 * framed: the page's own CSP sets `frame-src 'none'` and the upload policy blocks
 * `iframe`, `object` and `embed`, so the panel hands the file to the browser's own
 * viewer in a new tab instead of pretending to render it here.
 */
function panel(it: Item): string {
  if (!it.canPreview) return "";
  const head = `<div class="panel-head"><span>${esc(it.name)}</span><button class="x" type="button" data-close="p${it.i}" aria-label="Close preview"><svg viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>`;
  const body =
    it.kind === "pdf"
      ? `<div class="pdfview"><a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener"><svg><use href="#i-ext"/></svg>Open in new tab</a>
<a class="btn primary" href="${esc(it.url)}" download="${esc(it.name)}"><svg><use href="#i-dl"/></svg>Download</a></div>`
      : `<pre data-pre>Loading…</pre>`;
  return `<div class="panel" id="p${it.i}" hidden>${head}${body}</div>`;
}

/** Image, video and audio are cheap and expected, so they render without a tap. */
function media(it: Item, rounded: boolean): string {
  const cls = rounded ? ` class="inset"` : "";
  if (it.kind === "image")
    return `<a class="zoom" href="#lb${it.i}"><img${cls} src="${esc(it.url)}" alt="${esc(it.name)}" loading="lazy"></a>`;
  if (it.kind === "video")
    return `<video${cls} src="${esc(it.url)}" controls preload="metadata" playsinline></video>`;
  if (it.kind === "audio") return `<div class="audiowrap"><audio src="${esc(it.url)}" controls preload="metadata"></audio></div>`;
  return "";
}

const lightbox = (it: Item) =>
  it.kind === "image"
    ? `<div class="lightbox" id="lb${it.i}"><a href="#"><img src="${esc(it.url)}" alt="${esc(it.name)}"></a><div class="cap">${esc(it.name)}</div></div>`
    : "";

/** Variant B: one card per file, preview on top, action bar below. */
function cards(items: Item[]): string {
  return `<div class="cards">${items
    .map((it) => {
      const m = media(it, false);
      const top = m
        ? `<div class="top">${m}</div>`
        : `<div class="top"><div class="tile"><svg class="icon"><use href="#i-${it.kind}"/></svg><span>${esc(
            it.label,
          )}</span></div></div>`;
      return `<div class="card">${top}
<div class="body"><b>${esc(it.name)}</b><span>${fmtSize(it.size)} · ${esc(it.label)}</span></div>
<div class="bar">${dlBtn(it, true)}${it.canPreview ? previewBtn(it, false) : ""}${openBtn(it, false)}${copyBtn(it, false)}</div>
${it.canPreview ? `<div class="panelwrap">${panel(it)}</div>` : ""}</div>`;
    })
    .join("")}</div>`;
}

/** Variant C: compact rows, actions as one strip of icon buttons, previews in place. */
function rows(items: Item[], total: number): string {
  const body = items
    .map((it) => {
      const previewable = it.canPreview || it.kind === "image" || it.kind === "video" || it.kind === "audio";
      const inline = media(it, true);
      const inlinePanel = inline
        ? `<div class="panel" id="p${it.i}" hidden><div class="panel-head"><span>${esc(
            it.name,
          )}</span><button class="x" type="button" data-close="p${it.i}" aria-label="Close preview"><svg viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>${inline}</div>`
        : panel(it);
      return `<div class="trow">
<svg class="icon"><use href="#i-${it.kind}"/></svg>
<div class="tname"><b>${esc(it.name)}</b><span>${fmtSize(it.size)} · ${esc(it.label)}</span></div>
<div class="tacts">${previewable ? previewBtn(it, false) : ""}${openBtn(it, false)}${copyBtn(it, false)}${dlBtn(it, false)}</div>
</div>${inlinePanel ? `<div class="panelwrap">${inlinePanel}</div>` : ""}`;
    })
    .join("");
  return `<div class="tbl">${body}</div>
<div class="stickybar"><span class="sz">${items.length} files · ${fmtSize(total)}</span>
<button class="btn primary" type="button" id="dlall"><svg><use href="#i-dl"/></svg>Download all</button></div>`;
}

/**
 * The page Aryan opens on his phone to read or keep files an agent sent him.
 *
 * Six files or fewer get the card layout; past that the same data renders as compact
 * rows with a sticky download-all bar. One template, one stylesheet, one script: the
 * layout is chosen server side from `files.length`.
 */
export function downloadPage(opts: {
  reason?: string;
  files: SentFile[];
  sentAt: number;
  expiresAt: number;
}): string {
  const { reason, files, sentAt, expiresAt } = opts;
  const items: Item[] = files.map((f, i) => {
    const kind = kindOf(f.contentType, f.name);
    return {
      ...f,
      i,
      kind,
      label: kindLabel(kind, f.contentType, f.name),
      canPreview: kind === "pdf" || kind === "text",
    };
  });
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const compact = items.length > ROWS_ABOVE;
  const title = reason && reason.trim() ? reason.trim() : "Files for you";

  const body = items.length
    ? compact
      ? rows(items, total)
      : cards(items)
    : `<p class="line">Nothing here yet.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000"><title>${esc(title)}</title>
<style>${BASE_CSS}
.cards{display:grid;gap:16px}
.card{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg)}
.card .top{background:var(--surface);border-bottom:1px solid var(--line)}
.card .top img,.card .top video{display:block;width:100%;height:auto;max-height:62vh;object-fit:contain;background:#000}
.card .tile{display:grid;place-items:center;gap:8px;padding:32px 16px;text-align:center}
.card .tile .icon{width:34px;height:34px;stroke-width:1.2}
.card .tile span{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink)}
.audiowrap{padding:18px 16px}
.audiowrap audio{width:100%;display:block}
.card .body{padding:13px 15px 0}
.card .body b{display:block;font-weight:600;overflow-wrap:anywhere;line-height:1.3}
.card .body span{display:block;font-size:13.5px;color:var(--ink);margin-top:2px;font-variant-numeric:tabular-nums}
.card .bar{display:flex;gap:8px;padding:13px 15px 15px;flex-wrap:wrap}
.card .bar .btn{flex:1 1 auto;padding:0 12px}
.card .bar .btn.icononly{flex:0 0 44px;padding:0}
.card .panelwrap{padding:0 15px}
.card .panelwrap .panel{margin:0 0 15px}
.tbl{border-top:1px solid var(--line)}
.trow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);min-height:56px}
.trow .icon{width:18px;height:18px}
.tname{min-width:0;flex:1}
.tname b{display:block;font-weight:500;font-size:15px;overflow-wrap:anywhere;line-height:1.25}
.tname span{font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.tacts{display:flex;gap:2px;flex:none}
.tacts .btn{width:40px;height:40px;min-height:40px;padding:0;border:0;border-radius:999px}
.tacts .btn:hover{background:var(--surface-2)}
.tacts .btn.primary{border:0}
.panelwrap{padding:0}
/* the wrapper stays flush; a hidden panel is display:none, so its margin vanishes
   with it and the rows keep an even rhythm. */
.panel{margin:10px 0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);overflow:hidden}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 5px 5px 14px;
  border-bottom:1px solid var(--line);background:var(--surface-2);font-size:13px;color:var(--ink)}
.panel-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel-head .x{display:grid;place-items:center;width:44px;height:44px;border:0;background:transparent;color:var(--ink);cursor:pointer;border-radius:8px}
.panel-head .x svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round}
.panel-head .x:hover{color:var(--ink)}
.panel pre{margin:0;padding:14px;max-height:340px;overflow:auto;font:13px/1.6 var(--mono);color:#fff;
  white-space:pre-wrap;overflow-wrap:anywhere}
.panel img,.panel video{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain;background:#000}
.pdfview{display:grid;gap:10px;justify-items:center;padding:20px 16px;text-align:center}
.stickybar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:space-between;
  margin:10px 0 0;padding:12px 0 calc(12px + env(safe-area-inset-bottom));background:#000;border-top:1px solid var(--line-strong)}
.stickybar .sz{font-size:13.5px;color:var(--ink);font-variant-numeric:tabular-nums}
.zoom{display:block;cursor:zoom-in}
.lightbox{display:none;position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.94);padding:20px}
.lightbox:target{display:grid;place-items:center}
.lightbox a{display:grid;place-items:center;width:100%;height:100%;cursor:zoom-out}
.lightbox img{max-width:100%;max-height:88vh;width:auto;border-radius:6px}
.lightbox .cap{position:fixed;left:0;right:0;bottom:16px;text-align:center;font-size:13.5px;color:var(--ink)}
</style></head>
<body>${ICON_SPRITE}
<main>
${header(title, [
  { icon: "cal", text: fmtDate(sentAt) },
  { icon: "stack", text: `${files.length} file${files.length === 1 ? "" : "s"}` },
  { icon: "weight", text: fmtSize(total) },
  { icon: "clock", text: fmtExpiry(expiresAt) },
])}
${body}
</main>
${items.map(lightbox).join("")}
<script>
var CAP=${TEXT_PREVIEW_BYTES};
function flash(el,text){
  var node=el.lastChild, was=null;
  if(node&&node.nodeType===3&&node.nodeValue.trim()){was=node.nodeValue;node.nodeValue=text}
  var label=el.getAttribute('aria-label');
  el.setAttribute('aria-label',text);
  setTimeout(function(){if(was!==null)node.nodeValue=was;if(label)el.setAttribute('aria-label',label)},1100);
}
function fallbackCopy(el,url){
  var f=el.parentNode.querySelector('input.copyfall');
  if(!f){f=document.createElement('input');f.className='copyfall';f.readOnly=true;el.parentNode.appendChild(f)}
  f.value=url; f.focus(); f.select();
}
function loadText(url,pre){
  pre.textContent='Loading…';
  fetch(url).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(t){
    pre.textContent=t.length>CAP?t.slice(0,CAP)+'\\n\\n… truncated at 20 KB. Download for the rest.':t;
  }).catch(function(){pre.textContent='Preview unavailable. Download or open in a new tab instead.'});
}
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-toggle]');
  if(t){
    var p=document.getElementById(t.getAttribute('data-toggle'));
    if(!p)return;
    p.hidden=!p.hidden;
    var url=t.getAttribute('data-fetch'), pre=p.querySelector('pre[data-pre]');
    if(!p.hidden&&url&&pre&&!pre.getAttribute('data-loaded')){pre.setAttribute('data-loaded','1');loadText(url,pre)}
    return;
  }
  var c=e.target.closest('[data-close]');
  if(c){var q=document.getElementById(c.getAttribute('data-close'));if(q)q.hidden=true;return}
  var b=e.target.closest('[data-copy]');
  if(b){
    var link=b.getAttribute('data-copy');
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(link).then(function(){flash(b,'Copied')},function(){fallbackCopy(b,link)});
    }else{fallbackCopy(b,link)}
    return;
  }
});
var all=document.getElementById('dlall');
if(all){all.addEventListener('click',function(){
  var links=[].slice.call(document.querySelectorAll('a[data-dl]'));
  links.forEach(function(a,i){setTimeout(function(){a.click()},i*400)});
})}
</script>
</body></html>`;
}
