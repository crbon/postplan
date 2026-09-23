/** Owner-only draft index. Data is loaded after the browser supplies the API key. */
export const dashboardPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#09090b">
<title>Postplan drafts</title>
<style>
*{box-sizing:border-box}
:root{color-scheme:dark}
body{margin:0;min-height:100vh;background:#09090b;color:#f4f4f5;font:15px/1.5 system-ui,-apple-system,sans-serif}
button,input,select{font:inherit}
button{cursor:pointer}
.shell{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:32px}
.eyebrow{margin:0 0 5px;color:#71717a;font-size:12px;font-weight:700;letter-spacing:.15em;text-transform:uppercase}
h1{margin:0;font-size:clamp(28px,5vw,44px);line-height:1.08;letter-spacing:-.035em}
.muted{color:#a1a1aa}
.login{width:min(440px,100%);margin:12vh auto 0;padding:28px;border:1px solid #27272a;border-radius:20px;background:#111113}
.login h1{font-size:28px}
.login p{margin:10px 0 22px;color:#a1a1aa}
label{display:block;margin-bottom:7px;color:#d4d4d8;font-size:13px;font-weight:650}
input,select{width:100%;border:1px solid #3f3f46;border-radius:10px;background:#18181b;color:#fafafa;outline:none}
input{padding:11px 13px}
select{padding:10px 34px 10px 12px}
input:focus,select:focus{border-color:#a1a1aa;box-shadow:0 0 0 3px rgba(161,161,170,.14)}
.primary{width:100%;margin-top:14px;padding:11px 16px;border:0;border-radius:10px;background:#fafafa;color:#09090b;font-weight:700}
.error{min-height:22px;margin-top:10px;color:#f87171;font-size:13px}
.tools{display:grid;grid-template-columns:minmax(220px,1fr) 240px;gap:12px;margin-bottom:14px}
.stats{display:flex;justify-content:space-between;gap:16px;margin:0 0 16px;color:#71717a;font-size:13px}
.logout{padding:8px 12px;border:1px solid #3f3f46;border-radius:9px;background:transparent;color:#d4d4d8}
.logout:hover,.action:hover{background:#27272a}
.list{display:grid;gap:10px}
.card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;padding:20px;border:1px solid #27272a;border-radius:16px;background:#111113}
.title{margin:0;color:#fafafa;font-size:17px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.description{margin:6px 0 0;color:#a1a1aa;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:13px;color:#71717a;font-size:13px}
.meta span{white-space:nowrap}
.actions{display:flex;align-items:center;gap:8px}
.action{padding:8px 11px;border:1px solid #3f3f46;border-radius:9px;background:#18181b;color:#e4e4e7;text-decoration:none;white-space:nowrap}
.empty{padding:54px 20px;border:1px dashed #3f3f46;border-radius:16px;color:#71717a;text-align:center}
[hidden]{display:none!important}
@media(max-width:680px){.shell{padding-top:28px}header{align-items:flex-start}.tools{grid-template-columns:1fr}.card{grid-template-columns:1fr}.actions{justify-content:flex-start}}
</style></head>
<body>
<main class="shell">
  <section class="login" id="login">
    <p class="eyebrow">Postplan</p>
    <h1>Draft dashboard</h1>
    <p>Enter the API key for this deployment. It stays in this browser tab.</p>
    <form id="login-form">
      <label for="api-key">API key</label>
      <input id="api-key" name="api-key" type="password" autocomplete="current-password" required autofocus>
      <button class="primary" type="submit">View drafts</button>
      <div class="error" id="login-error" role="alert"></div>
    </form>
  </section>
  <section id="dashboard" hidden>
    <header>
      <div><p class="eyebrow">Postplan</p><h1>Drafts</h1></div>
      <button class="logout" id="logout" type="button">Lock dashboard</button>
    </header>
    <div class="tools">
      <div><label for="search">Search</label><input id="search" type="search" placeholder="Title, description, or repository"></div>
      <div><label for="repo">Repository</label><select id="repo"><option value="">All repositories</option></select></div>
    </div>
    <div class="stats"><span id="count"></span><span id="limit-note"></span></div>
    <div class="list" id="draft-list"></div>
  </section>
</main>
<script src="/dashboard.js" defer></script>
</body></html>`;

export const dashboardScript = `'use strict';
(function(){
  var storageKey='postplan-api-key';
  var drafts=[];
  var login=document.getElementById('login');
  var dashboard=document.getElementById('dashboard');
  var form=document.getElementById('login-form');
  var keyInput=document.getElementById('api-key');
  var loginError=document.getElementById('login-error');
  var search=document.getElementById('search');
  var repo=document.getElementById('repo');
  var list=document.getElementById('draft-list');
  var count=document.getElementById('count');
  var limitNote=document.getElementById('limit-note');

  function text(tag,value,className){
    var node=document.createElement(tag);
    node.textContent=value;
    if(className)node.className=className;
    return node;
  }

  function repository(draft){
    return draft.repoOrg&&draft.repoName?draft.repoOrg+'/'+draft.repoName:'';
  }

  function formatDate(value){
    var date=new Date(value);
    return Number.isNaN(date.getTime())?'Unknown date':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);
  }

  function render(){
    var term=search.value.trim().toLowerCase();
    var selectedRepo=repo.value;
    var visible=drafts.filter(function(draft){
      var draftRepo=repository(draft);
      var haystack=[draft.title,draft.description,draftRepo,draft.draftId].filter(Boolean).join(' ').toLowerCase();
      return (!term||haystack.includes(term))&&(!selectedRepo||draftRepo===selectedRepo);
    });
    list.replaceChildren();
    count.textContent=visible.length===drafts.length?drafts.length+' draft'+(drafts.length===1?'':'s'):visible.length+' of '+drafts.length+' drafts';
    if(!visible.length){
      list.appendChild(text('div',drafts.length?'No drafts match these filters.':'No drafts have been uploaded yet.','empty'));
      return;
    }
    visible.forEach(function(draft){
      var card=document.createElement('article'); card.className='card';
      var content=document.createElement('div');
      content.appendChild(text('h2',draft.title||'Untitled draft','title'));
      if(draft.description)content.appendChild(text('p',draft.description,'description'));
      var meta=document.createElement('div'); meta.className='meta';
      var draftRepo=repository(draft);
      if(draftRepo)meta.appendChild(text('span',draftRepo));
      meta.appendChild(text('span','Version '+(draft.latestVersionNumber||'?')));
      meta.appendChild(text('span',String(draft.versionCount||0)+' version'+(draft.versionCount===1?'':'s')));
      meta.appendChild(text('span','Updated '+formatDate(draft.updatedAt)));
      content.appendChild(meta);
      var actions=document.createElement('div'); actions.className='actions';
      var open=document.createElement('a'); open.className='action'; open.href=draft.publicUrl; open.target='_blank'; open.rel='noopener'; open.textContent='Open';
      var copy=text('button','Copy link','action'); copy.type='button';
      copy.addEventListener('click',function(){
        navigator.clipboard.writeText(draft.publicUrl).then(function(){
          copy.textContent='Copied'; setTimeout(function(){copy.textContent='Copy link'},1200);
        },function(){copy.textContent='Copy failed'});
      });
      actions.append(open,copy); card.append(content,actions); list.appendChild(card);
    });
  }

  function setRepositories(){
    var current=repo.value;
    var values=Array.from(new Set(drafts.map(repository).filter(Boolean))).sort();
    repo.replaceChildren(new Option('All repositories',''));
    values.forEach(function(value){repo.appendChild(new Option(value,value))});
    repo.value=values.includes(current)?current:'';
  }

  async function load(key){
    loginError.textContent='';
    try{
      var response=await fetch('/api/drafts',{headers:{Authorization:'Bearer '+key},cache:'no-store'});
      if(!response.ok){
        if(response.status===401)throw new Error('That API key was not accepted.');
        throw new Error('Could not load drafts ('+response.status+').');
      }
      var body=await response.json();
      drafts=Array.isArray(body.drafts)?body.drafts:[];
      sessionStorage.setItem(storageKey,key);
      setRepositories(); render();
      limitNote.textContent=drafts.length===100?'Showing the 100 most recently updated drafts.':'';
      login.hidden=true; dashboard.hidden=false;
    }catch(error){
      sessionStorage.removeItem(storageKey);
      login.hidden=false; dashboard.hidden=true;
      loginError.textContent=error instanceof Error?error.message:'Could not load drafts.';
      keyInput.focus();
    }
  }

  form.addEventListener('submit',function(event){event.preventDefault();load(keyInput.value.trim())});
  search.addEventListener('input',render);
  repo.addEventListener('change',render);
  document.getElementById('logout').addEventListener('click',function(){
    sessionStorage.removeItem(storageKey); drafts=[]; keyInput.value=''; dashboard.hidden=true; login.hidden=false; keyInput.focus();
  });
  var saved=sessionStorage.getItem(storageKey);
  if(saved)load(saved);
})();`;
