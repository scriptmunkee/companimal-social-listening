// Small client script: pipeline stamp, question drawer, keyboard shortcuts, chart tooltips.
// Plain ES2017, no template literals so it can live inside a TS string.
export const CLIENT_JS = String.raw`
(function(){
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var drawer=$('#drawer'),scrim=$('.scrim'),body=$('#drawer-body'),tip=$('#tip'),keys=$('#keys');
var lastFocus=null,cur=-1,gPending=false;

function stamp(btn){
  var s=document.createElement('span');s.className='stamp inked';s.textContent='Queued';s.title='Sent to the content pipeline';
  btn.replaceWith(s);
  var key=btn.dataset.topic+'|'+btn.dataset.q;
  $$('[data-send]').forEach(function(b){if(b.dataset.topic+'|'+b.dataset.q===key){var c=s.cloneNode(true);b.replaceWith(c);}});
  var n=$('.nav a[href^="/pipeline"] .count');
  if(n){n.textContent=String((parseInt(n.textContent.replace(/\D/g,''),10)||0)+1);}
}
function send(btn){
  if(!btn||btn.disabled)return;
  btn.disabled=true;btn.textContent='Sending';
  fetch('/api/pipeline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic:btn.dataset.topic,question:btn.dataset.q})})
   .then(function(r){if(!r.ok)throw 0;stamp(btn);})
   .catch(function(){btn.disabled=false;btn.textContent='Retry send';btn.classList.add('failed');});
}
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-send]');if(b){e.preventDefault();e.stopPropagation();send(b);return;}
  if(e.target.closest('[data-close]')){closeDrawer();return;}
  if(e.target.closest('[data-keys]')){keys.showModal();return;}
  var a=e.target.closest('a[data-drawer]');
  if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&e.button===0){e.preventDefault();openDrawer(a.getAttribute('href'),a.closest('tr'));return;}
  var row=e.target.closest('tr[data-row]');
  if(row&&!e.target.closest('a,button,select,input')){var l=row.querySelector('a[data-drawer]');if(l)openDrawer(l.getAttribute('href'),row);}
});

function openDrawer(url,row){
  lastFocus=row||document.activeElement;
  if(row)setCur(rows().indexOf(row));
  drawer.hidden=false;scrim.hidden=false;
  requestAnimationFrame(function(){drawer.classList.add('open');scrim.classList.add('open');});
  document.body.style.overflow='hidden';
  body.innerHTML='<p class="loading">Loading the posts behind this question</p>';
  fetch(url+(url.indexOf('?')>-1?'&':'?')+'partial=1').then(function(r){return r.text()}).then(function(h){body.innerHTML=h;body.scrollTop=0;var c=$('.drawer-bar .icon-btn');if(c)c.focus();})
   .catch(function(){body.innerHTML='<p class="loading">Could not load this question. <a href="'+url+'">Open it as a page</a>.</p>';});
}
function closeDrawer(){
  if(drawer.hidden)return;
  drawer.classList.remove('open');scrim.classList.remove('open');document.body.style.overflow='';
  setTimeout(function(){drawer.hidden=true;scrim.hidden=true;},200);
  if(lastFocus&&lastFocus.focus)lastFocus.focus();
}

function rows(){return $$('tr[data-row]')}
function setCur(i){var r=rows();if(!r.length)return;cur=Math.max(0,Math.min(r.length-1,i));r.forEach(function(x){x.classList.remove('focus')});r[cur].classList.add('focus');r[cur].focus({preventScroll:true});r[cur].scrollIntoView({block:'nearest'});}
document.addEventListener('focusin',function(e){var r=e.target.closest&&e.target.closest('tr[data-row]');if(r){var i=rows().indexOf(r);if(i>-1&&i!==cur){rows().forEach(function(x){x.classList.remove('focus')});cur=i;r.classList.add('focus');}}});

function go(path){var p=new URLSearchParams(location.search),q=new URLSearchParams();if(p.get('lens'))q.set('lens',p.get('lens'));if(p.get('region'))q.set('region',p.get('region'));var s=q.toString();location.href=path+(s?'?'+s:'');}
document.addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  var t=e.target,typing=t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable);
  if(e.key==='Escape'){if(!drawer.hidden){e.preventDefault();closeDrawer();}else if(typing){t.blur();}return;}
  if(typing||keys.open)return;
  if(gPending){gPending=false;var m={t:'/',d:'/reddit',q:'/questions',r:'/rising',m:'/myths',g:'/gaps',s:'/sources',p:'/pipeline'};if(m[e.key]){e.preventDefault();go(m[e.key]);}return;}
  var k=e.key;
  if(k==='g'){gPending=true;setTimeout(function(){gPending=false},900);return;}
  if(k==='?'){e.preventDefault();keys.showModal();return;}
  if(k==='/'){e.preventDefault();var s=$('input[name=q]');if(s){s.focus();s.select();}else go('/questions');return;}
  if(!drawer.hidden){if(k==='s'){var db=$('[data-send]',body);if(db){e.preventDefault();send(db);}}return;}
  if(k==='j'||k==='ArrowDown'&&cur>-1){e.preventDefault();setCur(cur+1);return;}
  if(k==='k'||k==='ArrowUp'&&cur>-1){e.preventDefault();setCur(cur<0?0:cur-1);return;}
  var r=rows()[cur];if(!r)return;
  if(k==='o'||k==='Enter'){var l=r.querySelector('a[data-drawer]'),x=r.querySelector('a[data-ext]');if(k==='o'||document.activeElement===r){if(l){e.preventDefault();openDrawer(l.getAttribute('href'),r);}else if(x){e.preventDefault();window.open(x.href,'_blank','noopener');}}return;}
  if(k==='s'){var b=r.querySelector('[data-send]');if(b){e.preventDefault();send(b);}return;}
});

// Tooltips for chart marks
function place(e){var x=e.clientX+14,y=e.clientY+14,w=tip.offsetWidth,h=tip.offsetHeight;if(x+w>innerWidth-8)x=e.clientX-w-14;if(y+h>innerHeight-8)y=e.clientY-h-14;tip.style.left=x+'px';tip.style.top=y+'px';}
document.addEventListener('mouseover',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(!el){tip.hidden=true;return;}tip.textContent=el.getAttribute('data-tip');tip.hidden=false;place(e);});
document.addEventListener('mousemove',function(e){if(!tip.hidden)place(e);});
document.addEventListener('scroll',function(){tip.hidden=true},true);

// Wide grids open on the current week
$$('[data-scroll-now]').forEach(function(el){var n=$('.now',el);if(n&&el.scrollWidth>el.clientWidth)el.scrollLeft=Math.max(0,n.offsetLeft-el.clientWidth*0.6);});
// Filters submit themselves
function tidy(f){$$('input,select',f).forEach(function(el){if(el.name&&!el.value)el.disabled=true;});}
$$('form[data-auto]').forEach(function(f){f.addEventListener('submit',function(){tidy(f)});});
$$('form[data-auto] select').forEach(function(s){s.addEventListener('change',function(){tidy(s.form);s.form.submit();})});
})();
`;
