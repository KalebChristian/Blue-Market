'use strict';
const main=document.querySelector('main'), header=document.querySelector('header');
const path=location.pathname, query=new URLSearchParams(location.search);
let app;
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const avatarColors=['Blue','Green','Purple','Orange','Slate'];
const roles={member:'Member',moderator:'Moderator',admin:'Admin'};
const rank={member:0,moderator:1,admin:2};
const allowed=role=>!app.showcase&&app.user&&rank[app.user.role]>=rank[role];
const statusNames={open:'Open',closed:'Closed',resolved:'Resolved',void:'Voided'};
const palette=['#5375ea','#ac73dd','#30ab91','#ea9b53','#da6e9e','#4aa9ca'];
const pct=v=>Math.round(v*100)+'%';
const money=(v,digits=2)=>new Intl.NumberFormat('en',{maximumFractionDigits:digits}).format(v/10000)+' '+app.cfg.currency;
const date=v=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(v).replace(/\b[ap]m\b/gi,period=>period.toUpperCase());
const market=id=>'/market/'+id;
const message='<p class="feedback" role="status"></p>';
const title=(name,description='')=>'<div class="page-title"><h1>'+h(name)+'</h1>'+(description?'<p>'+h(description)+'</p>':'')+'</div>';
const inp=(text,name,value='',type='text',attributes='')=>'<label>'+h(text)+'<input name="'+h(name)+'" value="'+h(value)+'" type="'+type+'" '+attributes+'></label>';
const opts=(values,value)=>values.map(([id,name])=>'<option value="'+h(id)+'" '+(id===value?'selected':'')+'>'+h(name)+'</option>').join('');
const select=(label,name,values,value)=>'<label>'+label+'<select name="'+name+'">'+opts(values,value)+'</select></label>';
const check=(label,name,on)=>'<label class="check"><input name="'+name+'" type="checkbox" '+(on?'checked':'')+'>'+label+'</label>';
const btn=(text,extra='')=>'<button class="btn primary" '+extra+'>'+text+'</button>';
function filter(changes) {
  const next=new URLSearchParams(query);
  for(const [name,value] of Object.entries(changes)) if(value) next.set(name,value); else next.delete(name);
  return '/'+(next.size?'?'+h(next.toString()):'');
}
async function api(url,data) {
  const response=await fetch('/api'+url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Blue-Market':'1'},body:JSON.stringify(data)});
  const value=await response.json();
  if(!response.ok) throw Object.assign(Error(value.error),{status:response.status});
  return value;
}
function bind(form,action) {
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.submitter, output=form.querySelector('[role=status]');
    if(button) button.disabled=true;
    if(output) output.textContent='';
    try {await action(new FormData(form));}
    catch(error) {if(output) output.textContent=error.message;}
    finally {if(button) button.disabled=false;}
  });
}
const visible=policy=>policy==='public'||(policy==='members'&&app.user)||app.user?.role==='admin';
function chrome() {
  const {cfg,user}=app, logo=cfg.logo?'/brand.png':'/logo.svg';
  let local; try{local=localStorage.getItem('bm3.theme');}catch{}
  const theme=local||cfg.theme;
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.density=cfg.density;
  document.documentElement.style.setProperty('--accent',cfg.accent);
  const rgb=cfg.accent.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  document.documentElement.style.setProperty('--on-accent',rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#10151e':'#fff');
  document.title=cfg.name; document.querySelector('[rel=icon]').href=logo;
  const links=[cfg.leaderboard!=='off'&&visible(cfg.leaderboard)&&['/leaderboard','Leaderboard'],(user?.role==='admin'||cfg.audit!=='off'&&visible(cfg.audit))&&['/audit','Audit Log'],user?.role==='admin'&&['/admin','Admin']].filter(Boolean);
  header.innerHTML='<div class="shell top"><a class="brand" href="/"><img src="'+logo+'" alt="">'+h(cfg.name)+'</a>'+
    ((cfg.browse||user)?'<form class="search" action="/"><span aria-hidden="true">⌕</span><input name="q" type="search" aria-label="Search Markets" placeholder="Search Markets" value="'+h(query.get('q'))+'" maxlength="120"><button>Search</button></form>':'')+
    '<div class="account">'+(user?'<a class="position-link" href="/positions">Positions</a><a class="balance" href="/positions"><small>Available</small><strong>'+h(money(user.balance))+'</strong></a>':
    '<a href="/sign-in">Sign In</a>'+(cfg.signUps==='open'||app.setup?'<a class="btn primary" href="/sign-up">Sign Up</a>':''))+
    '<details><summary class="avatar-color" data-avatar="'+h(user?.avatar||'blue')+'" aria-label="Account and Appearance">'+(user?h(user.name.slice(0,2).toUpperCase()):'◐')+'</summary><div class="menu">'+
    (user?'<strong>'+h(user.name)+'</strong><a href="/positions">Positions</a>':'')+links.map(([url,label])=>'<a href="'+url+'">'+label+'</a>').join('')+
    select('Theme','theme',[['system','System'],['light','Light'],['dark','Dark']],theme)+(user&&!app.showcase?'<button class="btn" id="logout">'+(app.sandbox?'Exit Demo':'Sign Out')+'</button>':'')+'</div></details></div></div>';
  header.querySelector('[name=theme]').onchange=event=>{
    document.documentElement.dataset.theme=event.target.value;
    try{localStorage.setItem('bm3.theme',event.target.value);}catch{}
  };
  const logout=document.querySelector('#logout');
  if(logout) logout.onclick=async()=>{await api(app.sandbox?'/leave-demo':'/logout',{});location.assign('/');};
}
function auth(register) {
  if(app.hostedDemo&&app.showcase){main.innerHTML=title('Try Blue Market');return demoEntry();}
  if(register&&!app.setup&&app.cfg.signUps!=='open'){
    main.innerHTML='<section class="auth panel">'+title('Sign Ups Are Closed')+'<a href="/sign-in">Sign In</a></section>';return;
  }
  main.innerHTML='<section class="auth panel">'+title(app.setup?'Set Up '+app.cfg.name:register?'Create Your Account':'Sign In',app.setup?'The First Account Becomes an Admin. Use the Setup Code From Your Server Console.':app.cfg.description)+
    '<form id="auth">'+(app.setup?inp('Setup Code','setup','','password','required'):'')+
    inp('Username','name','','text','required autocomplete="username" maxlength="32"')+
    inp('Password','password','','password','required autocomplete="'+(register?'new-password':'current-password')+'"')+btn(register?'Create Account':'Sign In')+message+'</form>'+
    (!app.setup&&app.cfg.signUps==='open'?'<a href="'+(register?'/sign-in':'/sign-up')+'">'+(register?'Already Have an Account? Sign In':'Create an Account')+'</a>':'')+'</section>';
  const authForm=document.querySelector('#auth');
  bind(authForm,async data=>{
    await api(register?'/register':'/login',Object.fromEntries(data));
    const state=await api('/state');
    if(!state.user) throw Error('The Browser Did Not Keep Your Session. Check That Cookies Are Enabled.');
    location.assign('/');
  });
}
function badge(category) {
  const color=palette[Math.max(0,app.cfg.categories.indexOf(category))%palette.length];
  return '<span class="category-icon" style="--category:'+color+'" aria-hidden="true">'+h(category.slice(0,2).toUpperCase())+'</span>';
}
function tone(label) {return /^yes$/i.test(label)?'yes':/^no$/i.test(label)?'no':'';}
function leadingOutcomes(item) {
  const indexed=item.labels.map((label,index)=>({label,index}));
  return indexed.length<=2 ? indexed : indexed.sort((a,b)=>item.prices[b.index]-item.prices[a.index]).slice(0,2);
}
function card(item) {
  const resolve=item.status==='closed'&&allowed(app.cfg.resolver);
  const picks=item.status==='resolved'?'<div class="card-result"><span class="card-result-mark" aria-hidden="true">✓</span><div><small>Winning Outcome</small><strong>'+h(item.labels[item.result])+'</strong></div><b>100%</b></div>':item.status==='void'?'<div class="card-result card-result-void"><span class="card-result-mark" aria-hidden="true">–</span><div><small>Market Voided</small><strong>No Winner</strong></div></div>':leadingOutcomes(item).map(({label,index})=>'<a class="card-pick '+tone(label)+'" href="'+market(item.id)+'?outcome='+index+'"><span>'+h(label)+'<i style="--chance:'+pct(item.prices[index])+';--pick:'+palette[index]+'"></i></span><strong>'+pct(item.prices[index])+'</strong></a>').join('');
  return '<article class="market-card panel"><div class="card-top"><div><h3><a href="'+market(item.id)+'">'+h(item.title)+'</a></h3><p>'+h(item.category)+' · '+h(item.status==='open'?date(item.closes):statusNames[item.status])+'</p></div></div>'+
    '<div class="outcomes">'+picks+'</div><div class="card-foot"><span>'+h(money(item.volume))+' Vol.</span>'+
    (resolve?'<a class="btn" href="'+market(item.id)+'#resolve">Resolve Market</a>':item.result===null&&item.labels.length>2?'<a href="'+market(item.id)+'">+'+(item.labels.length-2)+' More</a>':'')+'</div></article>';
}
function drawMarketChart(container,item,history,selected=null,mini=false) {
  const lines=selected!==null?[selected]:item.labels.map((_,i)=>i);
  const start=history[0]?.at??item.created;
  const last=history.at(-1);
  const settlement=item.status==='resolved'?{
    at:Math.max(start+1,last?.at??start,item.settledAt??item.closes),
    prices:item.payouts.map(payout=>payout/10000), settled:true
  }:null;
  const end=Math.max(start+1,settlement?.at??last?.at??item.closes);
  const samples=history.length?history:[{at:start,prices:item.prices}];
  const data=settlement?[...samples,{at:settlement.at,prices:last?.prices??item.prices},settlement]:
    history.length>1?history:[...samples,{at:end,prices:last?.prices??item.prices}];
  const inspectable=settlement?[...samples,settlement]:samples;
  const base=mini?178:208, right=548;
  const time=new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit'});
  const x=t=>8+(right-8)*(t-start)/(end-start), y=p=>base-10-p*(base-22);
  container.innerHTML='<svg viewBox="0 0 590 '+(base+(mini?18:0))+'" class="chart" role="img" aria-label="Market Price History">'+
    [0,.25,.5,.75,1].map(p=>'<line x1="8" x2="'+right+'" y1="'+y(p)+'" y2="'+y(p)+'"/>'+('<text x="564" y="'+(y(p)+3)+'">'+pct(p)+'</text>')).join('')+
    (mini&&history.length>1?[0,.5,1].map((part,index)=>'<text x="'+x(start+(end-start)*part)+'" y="'+(base+12)+'" text-anchor="'+['start','middle','end'][index]+'">'+h(time.format(start+(end-start)*part).toUpperCase())+'</text>').join(''):'')+
    lines.map(i=>'<polyline points="'+data.map(point=>x(point.at).toFixed(1)+','+y(point.prices[i]).toFixed(1)).join(' ')+'" stroke="'+palette[i]+'"/><circle cx="'+right+'" cy="'+y(data.at(-1).prices[i])+'" r="10" opacity=".2" fill="'+palette[i]+'"/><circle cx="'+right+'" cy="'+y(data.at(-1).prices[i])+'" r="4" fill="'+palette[i]+'"/>').join('')+'<g class="chart-cursor" visibility="hidden"><line y1="12" y2="'+(base-10)+'"/>'+lines.map(i=>'<circle r="4" fill="'+palette[i]+'"/>').join('')+'</g></svg>'+
    '<div class="chart-tooltip panel" role="status" hidden></div>';
  container.tabIndex=0;
  container.setAttribute('role','group');
  container.setAttribute('aria-label','Inspect Market Price History With the Left and Right Arrow Keys');
  const svg=container.querySelector('svg'), cursor=svg.querySelector('.chart-cursor');
  const guide=cursor.querySelector('line'), dots=cursor.querySelectorAll('circle');
  const tooltip=container.querySelector('.chart-tooltip');
  let active=-1;
  function show(index) {
    if(index===active)return;
    active=index;
    const point=inspectable[index], position=x(point.at);
    guide.setAttribute('x1',position); guide.setAttribute('x2',position);
    lines.forEach((line,offset)=>{
      dots[offset].setAttribute('cx',position);
      dots[offset].setAttribute('cy',y(point.prices[line]));
    });
    cursor.setAttribute('visibility','visible');
    tooltip.innerHTML='<time datetime="'+new Date(point.at).toISOString()+'">'+h(point.settled?(item.settledAt?'Settlement · '+date(item.settledAt):'Settlement'):history.length?date(point.at):'Last Quoted Prices')+'</time>'+
      lines.map(line=>'<div><i style="--line:'+palette[line]+'"></i><span>'+h(item.labels[line])+'</span><strong>'+pct(point.prices[line])+'</strong></div>').join('');
    tooltip.hidden=false;
    const width=container.clientWidth, left=position/590*width, box=tooltip.offsetWidth;
    tooltip.style.left=Math.max(0,Math.min(width-box,left+box+12<=width?left+12:left-box-12))+'px';
  }
  function hide() {
    active=-1;
    tooltip.hidden=true;
    cursor.setAttribute('visibility','hidden');
  }
  function inspect(event) {
    const bounds=svg.getBoundingClientRect(), position=(event.clientX-bounds.left)/bounds.width*590;
    const index=inspectable.reduce((closest,sample,i)=>Math.abs(x(sample.at)-position)<=Math.abs(x(inspectable[closest].at)-position)?i:closest,0);
    show(index);
  }
  container.onpointermove=inspect;
  container.onpointerdown=inspect;
  container.onpointerleave=hide;
  container.onblur=hide;
  container.onkeydown=event=>{
    if(event.key==='Escape'){hide();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const last=inspectable.length-1;
    if(event.key==='Home'){show(0);return;}
    if(event.key==='End'||active<0){show(last);return;}
    show(Math.max(0,Math.min(last,active+(event.key==='ArrowRight'?1:-1))));
  };
}
function feed(items) {
  const category=query.get('category'), search=(query.get('q')||'').trim().toLowerCase();
  const status=['open','closed','resolved'].includes(query.get('status'))?query.get('status'):'open';
  const matches=items.filter(item=>(!category||item.category===category)&&
    [item.title,item.category,...item.labels].join(' ').toLowerCase().includes(search));
  const belongs=(item,value)=>item.status===value||(value==='resolved'&&item.status==='void');
  const active=items.filter(item=>item.status==='open').sort((a,b)=>b.volume-a.volume);
  const featured=app.cfg.featured&&!category&&!search&&status==='open'&&active[0];
  const categories=[...new Set([...app.cfg.categories,...items.map(item=>item.category)])];
  const sorts={new:(a,b)=>b.id-a.id,volume:(a,b)=>b.volume-a.volume,closes:(a,b)=>a.closes-b.closes};
  const list=matches.filter(item=>belongs(item,status)).sort(sorts[query.get('sort')]||sorts.new);
  const waiting=items.filter(item=>item.status==='closed');
  const canResolve=allowed(app.cfg.resolver);
  const lead=featured?'<article class="feature panel"><span class="overline">'+h(featured.category)+' · Featured Market</span><h2><a href="'+market(featured.id)+'">'+h(featured.title)+'</a></h2><div class="feature-inner"><div class="feature-picks">'+leadingOutcomes(featured).map(({label,index:i})=>'<a class="card-pick '+tone(label)+'" href="'+market(featured.id)+'?outcome='+i+'"><span>'+h(label)+'<i style="--chance:'+pct(featured.prices[i])+';--pick:'+palette[i]+'"></i></span><strong>'+pct(featured.prices[i])+'</strong></a>').join('')+
    '<div class="card-foot"><span>'+h(money(featured.volume))+' Vol.</span><a href="'+market(featured.id)+'">View Market →</a></div></div><div class="feature-plot"><div class="legend">'+featured.labels.map((label,i)=>'<span><i style="--line:'+palette[i]+'"></i>'+h(label)+' <strong>'+pct(featured.prices[i])+'</strong></span>').join('')+'</div><div class="feature-chart market-chart"></div></div></div></article>':'';
  header.insertAdjacentHTML('beforeend','<div class="shell discovery"><nav class="categories" aria-label="Categories"><a href="'+filter({category:''})+'" class="'+(!category?'active':'')+'">All Markets</a>'+
    categories.map(name=>'<a class="'+(name===category?'active':'')+'" href="'+filter({category:name})+'">'+h(name)+'</a>').join('')+'</nav>'+
    '<div class="tools market-filters">'+select('Status','status',['open','closed','resolved'].map(value=>[value,statusNames[value]]),status)+
    select('Sort By','sort',[['new','Recent'],['volume','Most Traded'],['closes','Closing Soon']],query.get('sort')||'new')+'</div></div>');
  main.innerHTML='<div class="feed-main">'+lead+
    '<div class="section-head">'+title(search?'Search Results':category||'Markets')+'<div class="feed-actions">'+
    (canResolve&&waiting.length?'<a class="btn" href="/?status=closed">Needs Resolution ('+waiting.length+')</a>':'')+
    (allowed(app.cfg.creator)?'<a class="btn primary" href="/new">Create Market</a>':'')+'</div></div>'+
    '<div class="market-grid">'+list.map(card).join('')+'</div>'+(list.length?'':'<div class="panel empty">No Matching Markets · <a href="/">View All Markets</a></div>')+'</div>';
  if(featured){
    const plot=document.querySelector('.feature-chart');
    drawMarketChart(plot,featured,[],null,true);
    api(market(featured.id)).then(({history})=>drawMarketChart(plot,featured,history,null,true)).catch(()=>{});
  }
  header.querySelectorAll('.market-filters select').forEach(control=>control.onchange=()=>{
    const changes={[control.name]:control.value};
    const next=new URLSearchParams(query);
    for(const [name,value] of Object.entries(changes)) if(value)next.set(name,value);else next.delete(name);
    location.assign('/?'+next);
  });
}
function settlementPanel(item,positions) {
  const voided=item.status==='void';
  const total=positions.reduce((sum,row)=>sum+row.shares*item.payouts[row.outcome],0);
  return '<div class="settled-ticket '+(voided?'voided':'')+'"><span class="settled-mark" aria-hidden="true">'+(voided?'–':'✓')+'</span>'+
    '<p>'+(voided?'Market Voided':'Winning Outcome')+'</p><h2>'+h(voided?'No Winner':item.labels[item.result])+'</h2>'+
    (positions.length?'<div class="personal-payout"><span>Your Payout</span><strong>'+h(money(total,4))+'</strong></div>':'')+'</div>';
}
function eventPage({item,history,positions}) {
  let index=Number(query.get('outcome'))||0;
  if(!item.labels[index]) index=0;
  let sell=query.get('side')==='sell', pending, revision=0, selected=null;
  const open=item.status==='open'&&!item.archived;
  const canClose=open&&allowed(app.cfg.resolver);
  const trade=open&&app.user&&!app.showcase;
  const settled=item.result!==null, resolved=item.status==='resolved';
  const outcomes=settled?'<section class="settled-outcomes"><h2>Outcomes</h2><ul>'+item.labels.map((name,i)=>{
    const winner=resolved&&i===item.result;
    return '<li class="'+(winner?'winning-outcome':'')+'"><span><i style="--line:'+palette[i]+'"></i>'+h(name)+'</span>'+
      '<span class="outcome-result">'+(winner?'✓ Winner':resolved?'Lost':'Voided')+' <strong>'+h(money(item.payouts[i],4))+'</strong></span></li>';
  }).join('')+'</ul></section>':'';
  const details=settled?'<div class="settlement-details"><details><summary>Market Rules</summary><p>'+h(item.rules)+'</p></details>'+
    '<details><summary>Timeline and Payout</summary><dl><div><dt>Trading Closed</dt><dd>'+h(date(item.closes))+'</dd></div>'+
    (item.settledAt?'<div><dt>'+(resolved?'Resolved':'Voided')+'</dt><dd>'+h(date(item.settledAt))+'</dd></div>':'')+
    '<div><dt>Payout per '+(resolved?'Winning ':'')+'Share</dt><dd>'+h(money(resolved?item.payouts[item.result]:item.payouts[0],4))+'</dd></div></dl>'+
    (item.note?'<h3>Resolution Note</h3><p>'+h(item.note)+'</p>':'')+'</details></div>':
    '<section class="rules"><h2>Resolution Rules</h2><p>'+h(item.rules)+'</p></section>';
  main.innerHTML='<div class="crumb"><a href="/">Markets</a> / <a href="/?category='+encodeURIComponent(item.category)+'">'+h(item.category)+'</a></div>'+
    '<div class="event-layout '+(settled?'settled-layout':'')+'"><div class="event-main"><div class="event-title">'+badge(item.category)+title(item.title)+'</div>'+
    '<div class="legend">'+item.labels.map((name,i)=>'<button type="button" data-line="'+i+'" aria-pressed="false"><i style="--line:'+palette[i]+'"></i>'+h(name)+' <strong>'+pct(resolved?Number(i===item.result):item.prices[i])+'</strong></button>').join('')+'</div>'+
    '<div id="history" class="market-chart"></div><div class="card-foot meta"><span>'+h(money(item.volume))+' Vol. · '+statusNames[item.status]+'</span><span>'+(open?'Closes ':'Closed ')+h(date(item.closes))+'</span>'+(canClose?'<button class="btn" id="close-trading">Close Trading</button>':'')+'</div>'+
    outcomes+details+
    (item.status==='closed'&&!item.archived&&allowed(app.cfg.resolver)?'<form id="resolve" class="panel form-panel"><h2>Settle Market</h2>'+select('Result','result',[['','Choose a Result'],...item.labels.map((name,i)=>[String(i),name]),['-1','Void Market']],'')+
      '<label>Resolution Note (Optional)<textarea name="note" maxlength="1800"></textarea></label>'+btn('Review Settlement')+message+'</form>':'')+
    '</div><aside class="panel ticket">'+(settled?settlementPanel(item,positions):trade?'<div class="trade-tabs"><button type="button" data-side="buy">Buy</button><button type="button" data-side="sell">Sell</button></div>'+
      '<form class="form-panel" id="order">'+select('Outcome','outcome',item.labels.map((name,i)=>[String(i),name]),String(index))+
      inp('Shares','shares',sell?Math.max(1,Math.min(500,positions.find(row=>row.outcome===index)?.shares||1)):10,'number','required min="1" max="500"')+
      '<div class="quote" id="quote"></div>'+btn('Place Trade')+message+'</form>':open&&app.showcase?'<div class="form-panel"><h2>Showcase</h2><p>'+(app.hostedDemo?'Enter the Demo to Try Trading.':'Trading Is Available in a Self-Hosted Instance.')+'</p></div>':open?'<div class="form-panel"><h2>Trade</h2><a class="btn primary" href="/sign-in">Sign In to Trade</a></div>':
      '<div class="form-panel"><h2>'+(item.archived?'Archived':statusNames[item.status])+'</h2><p>Trading Is Closed.</p></div>')+'</aside></div>';
  const plot=document.querySelector('#history');
  drawMarketChart(plot,item,history);
  document.querySelectorAll('[data-line]').forEach(button=>button.onclick=()=>{
    const choice=Number(button.dataset.line);selected=selected===choice?null:choice;
    drawMarketChart(plot,item,history,selected);
    document.querySelectorAll('[data-line]').forEach(node=>node.setAttribute('aria-pressed',String(Number(node.dataset.line)===selected)));
  });
  const form=document.querySelector('#order');
  if(form) {
    const output=document.querySelector('#quote'), submit=form.querySelector('button');
    async function update() {
      const id=++revision;pending=null;submit.disabled=true;
      const shares=Number(form.elements.shares.value)*(sell?-1:1);
      submit.textContent=sell?'Sell Shares':'Buy Shares';
      document.querySelectorAll('[data-side]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.side===(sell?'sell':'buy'))));
      output.innerHTML='<div><span>Shares Held</span><strong>'+(positions.find(row=>row.outcome===index)?.shares||0)+'</strong></div>';
      if(!form.elements.shares.validity.valid) return;
      try{
        const result=await api(market(item.id)+'/quote',{outcome:index,shares});
        if(id!==revision)return;
        pending={outcome:index,shares,debit:result.debit,reference:[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('')};
        output.insertAdjacentHTML('beforeend','<div><span>'+(sell?'Estimated Proceeds':'Total Cost')+'</span><strong>'+h(money(Math.abs(result.debit)))+'</strong></div>'+
          '<div><span>Chance After Trade</span><strong>'+pct(result.price)+'</strong></div>'+(!sell?'<div><span>Payout If Correct</span><strong>'+h(money(shares*10000))+'</strong></div>':''));
        submit.disabled=false;
      }catch(error){if(id===revision)output.insertAdjacentHTML('beforeend','<p class="feedback">'+h(error.message)+'</p>');}
    }
    document.querySelectorAll('[data-side]').forEach(button=>button.onclick=()=>{sell=button.dataset.side==='sell';update();});
    form.oninput=()=>{index=Number(form.elements.outcome.value);update();};
    bind(form,async()=>{if(!pending)return;try{await api(market(item.id)+'/trade',pending);location.reload();}catch(error){if(error.status===409)await update();throw error;}});
    update();
  }
  const closeButton=document.querySelector('#close-trading');
  if(closeButton) closeButton.onclick=()=>{
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label','Close Trading');
    dialog.innerHTML='<h2>Close Trading Early?</h2><p>New Buys and Sells Stop Immediately. Existing Positions Stay Open Until Resolution.</p><form>'+
      inp('Reason (Optional)','reason','','text','maxlength="240"')+'<div class="dialog-actions">'+btn('Close Trading')+'<button class="btn" type="button">Cancel</button></div>'+message+'</form>';
    dialog.querySelector('[type=button]').onclick=()=>dialog.close();
    dialog.onclose=()=>dialog.remove();
    bind(dialog.querySelector('form'),async data=>{
      await api(market(item.id)+'/close',{reason:data.get('reason')});
      location.hash='resolve';
      location.reload();
    });
    main.append(dialog);dialog.showModal();
  };
  const resolver=document.querySelector('#resolve');
  if(resolver&&location.hash==='#resolve') resolver.scrollIntoView();
  if(resolver) bind(resolver,async data=>{
    if(data.get('result')==='')throw Error('Choose a Result.');
    const result=Number(data.get('result')), note=data.get('note');
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','settlement-title');
    dialog.innerHTML='<h2 id="settlement-title">Confirm Settlement</h2><p>'+h(result<0?'Void Market':item.labels[result])+'</p>'+(note.trim()?'<p>'+h(note)+'</p>':'')+'<form>'+btn('Settle Market')+
      '<button type="button" class="btn" id="cancel">Go Back</button>'+message+'</form>';
    dialog.onclose=()=>dialog.remove();
    dialog.querySelector('#cancel').onclick=()=>dialog.close();
    bind(dialog.querySelector('form'),async()=>{await api(market(item.id)+'/settle',{result,note});location.reload();});
    main.append(dialog);dialog.showModal();
  });
}
function newMarket(item) {
  if(!item&&!allowed(app.cfg.creator))throw Error('Market Creation Is Unavailable.');
  const locked=!!(item&&(item.trades||item.result!==null));
  const localDate=item?new Date(item.closes-new Date(item.closes).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  const categories=[...new Set([...app.cfg.categories,...(item?[item.category]:[])])];
  main.innerHTML=title(item?'Edit Market':'Create a Market',locked?'Trading History Locks the Question, Rules, Outcomes, and Schedule.':'')+'<div class="editor"><form class="panel form-panel" id="editor">'+inp('Market Question','title',item?.title||'','text','required maxlength="160" '+(locked?'readonly':''))+
    select('Category','category',categories.map(name=>[name,name]),item?.category||categories[0])+
    '<fieldset><legend>Outcomes</legend><div id="outcome-fields"></div><button class="btn" type="button" id="more">Add Outcome</button><p class="muted">Choose 2 – 6 Outcomes That Cannot Win at the Same Time.</p></fieldset>'+
    inp('Trading Closes · '+Intl.DateTimeFormat().resolvedOptions().timeZone,'closes',localDate,'datetime-local','required '+(locked?'readonly':''))+
    '<label>Resolution Rules<textarea name="rules" required maxlength="2400" '+(locked?'readonly':'')+'>'+h(item?.rules)+'</textarea></label>'+btn(item?'Save Changes':'Publish Market')+message+'</form><aside><h2>Market Preview</h2><div id="preview"></div></aside></div>';
  const form=document.querySelector('#editor'), fields=document.querySelector('#outcome-fields'), more=document.querySelector('#more');
  function update() {
    const values=[...fields.querySelectorAll('input')].map((input,i)=>input.value||'Outcome '+(i+1));
    const category=form.elements.category.value;
    document.querySelector('#preview').innerHTML='<article class="panel market-card"><div class="card-top">'+badge(category)+'<div><span class="overline">'+h(category)+'</span><h3>'+h(form.elements.title.value||'Your Market Question')+'</h3></div></div>'+
      '<div class="outcomes">'+values.map(label=>'<div class="outcome '+tone(label)+'"><span>'+h(label)+'</span><strong>'+pct(1/values.length)+'</strong></div>').join('')+'</div></article>';
    more.disabled=locked||values.length>=6;
    fields.querySelectorAll('button').forEach(button=>button.disabled=locked||values.length<=2);
  }
  function add(value) {
    const row=document.createElement('div');row.className='outcome-editor';
    row.innerHTML='<input name="outcome" aria-label="Outcome" required maxlength="70" value="'+h(value)+'" '+(locked?'readonly':'')+'><button class="btn" type="button">Remove</button>';
    row.querySelector('button').onclick=()=>{row.remove();update();};fields.append(row);update();
  }
  (item?.labels||['Yes','No']).forEach(add);
  more.onclick=()=>{if(fields.children.length<6){add('');fields.lastChild.querySelector('input').focus();}};
  form.oninput=update;
  bind(form,async data=>{
    const {title,category,rules,closes}=Object.fromEntries(data);
    const changes={title,category,rules,labels:data.getAll('outcome')};
    if(!item||closes!==localDate) changes.closes=new Date(closes).valueOf();
    const result=await api(item?'/admin/markets/edit':'/markets',item?{...changes,id:item.id}:changes);
    location.assign(market(result.id));
  });
}
function table(headers,rows,empty='No Entries Yet.') {
  return '<div class="panel table-wrap"><table><thead><tr>'+headers.map(label=>'<th scope="col">'+h(label)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
    (rows.length?'':'<p class="empty">'+h(empty)+'</p>')+'</div>';
}
function performanceChart(history) {
  const values=history.map(point=>point.value), min=Math.min(...values), max=Math.max(...values);
  const begin=history[0].at, range=Math.max(1,history.at(-1).at-begin);
  const coords=history.map(point=>[4+552*(point.at-begin)/range,max===min?52:94-83*(point.value-min)/(max-min)]);
  return '<svg class="performance-chart" viewBox="0 0 560 100" role="img" aria-label="Account Value Over Time"><path class="performance-fill" d="M'+coords[0][0]+',100 L'+coords.map(pair=>pair.join(',')).join(' L')+' L'+coords.at(-1)[0]+',100 Z"/><polyline points="'+coords.map(pair=>pair.join(',')).join(' ')+'"/></svg>';
}
function positions(rows,activity) {
  const open=rows.filter(row=>row.item.result===null);
  const valueOf=row=>row.shares*row.item.prices[row.outcome]*10000;
  const value=open.reduce((total,row)=>total+valueOf(row),0);
  main.innerHTML=title('Positions')+'<div class="position-overview"><section class="panel account-value"><div><p>Estimated Account Value</p><strong>'+h(money(value+app.user.balance))+'</strong></div>'+
    '<div><p>Available to Trade</p><strong>'+h(money(app.user.balance))+'</strong></div><div><p>Open Positions</p><b>'+h(money(value))+'</b></div></section>'+
    '<section class="panel performance"><div class="performance-head"><h2>Profit / Loss</h2><div id="periods"><button data-days="1">1D</button><button data-days="7">1W</button><button data-days="30">1M</button><button data-days="0">All</button></div></div><strong id="change"></strong><div id="performance-chart"></div></section></div>'+
    '<div class="position-tabs"><button data-view="positions" aria-pressed="true">Positions</button><button data-view="history" aria-pressed="false">Trade History</button></div>'+
    '<div class="position-filters"><input id="holding-search" placeholder="Search Markets" type="search" aria-label="Search Markets in Positions">'+select('Sort By','holding-sort',[['value','Current Value'],['profit','Profit / Loss'],['market','Market Name']],'value')+'</div><div id="holding-list"></div>';
  function draw(days) {
    const history=activity.history, end=history.at(-1), start=days?end.at-days*86400000:history[0].at;
    const base=history.findLast(point=>point.at<=start)||history[0];
    const tradingValue=point=>point.value-(point.adjustmentsNet||0);
    const series=[{at:start,value:tradingValue(base)},...history.filter(point=>point.at>start).map(point=>({...point,value:tradingValue(point)}))];
    const delta=tradingValue(end)-tradingValue(base);
    const change=document.querySelector('#change');
    change.textContent=(delta>0?'+':'')+money(delta); change.className=delta>0?'gain':delta<0?'loss':'';
    document.querySelector('#performance-chart').innerHTML=performanceChart(series);
    document.querySelectorAll('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.days)===days)));
  }
  document.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>draw(Number(button.dataset.days)));
  draw(7);
  let current='positions';
  const search=document.querySelector('#holding-search'), sort=document.querySelector('[name=holding-sort]');
  function render() {
    const term=search.value.trim().toLowerCase();
    sort.closest('label').hidden=current==='history';
    const list=document.querySelector('#holding-list');
    if(current==='history') {
      list.innerHTML=table(['Market','Side','Shares','Total','Date'],activity.orders.filter(order=>[order.title,order.label].join(' ').toLowerCase().includes(term)).map(order=>[
        '<a href="'+market(order.market)+'">'+h(order.title)+'</a><small>'+h(order.label)+'</small>',order.shares>0?'Buy':'Sell',h(Math.abs(order.shares)),h(money(Math.abs(order.cost))),h(date(order.at))]),'No Matching Trades.');
      return;
    }
    const filtered=open.filter(row=>[row.item.title,row.item.labels[row.outcome]].join(' ').toLowerCase().includes(term));
    filtered.sort(sort.value==='market'?(a,b)=>a.item.title.localeCompare(b.item.title):sort.value==='profit'?(a,b)=>(valueOf(b)-b.basis)-(valueOf(a)-a.basis):(a,b)=>valueOf(b)-valueOf(a));
    list.innerHTML=table(['Market','Avg. → Now','Cost','Payout If Correct','Value',''],filtered.map(row=>{
      const label=row.item.labels[row.outcome], mark=valueOf(row), pnl=mark-row.basis;
      return ['<div class="holding-market">'+badge(row.item.category)+'<div><a href="'+market(row.item.id)+'">'+h(row.item.title)+'</a><small><span class="position-side '+tone(label)+'">'+h(label)+'</span> '+row.shares+' Shares</small></div></div>',
        h(money(row.basis/row.shares))+' <span class="muted">→</span> '+h(money(row.item.prices[row.outcome]*10000)),h(money(row.basis)),h(money(row.shares*10000)),
        '<strong>'+h(money(mark))+'</strong><small class="'+(pnl>0?'gain':pnl<0?'loss':'')+'">'+h((pnl>0?'+':'')+money(pnl))+'</small>',
        row.exit===null?'Closed':app.showcase?'—':'<a class="btn primary" href="'+market(row.item.id)+'?side=sell&amp;outcome='+row.outcome+'">Sell</a><small class="sell-estimate">Est. '+h(money(row.exit))+'</small>'];
    }),'No Matching Positions.');
  }
  search.oninput=render; sort.onchange=render;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{
    current=button.dataset.view;
    document.querySelectorAll('[data-view]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.view===current)));
    render();
  });
  render();
}

function avatarField(value) {
  return select('Avatar Color','avatar',avatarColors.map(color=>[color.toLowerCase(),color]),value||'blue');
}
function confirmDeletion(label,name,action) {
  const dialog=document.createElement('dialog');
  dialog.setAttribute('aria-label',label);
  dialog.innerHTML='<h2>'+label+'</h2><p>'+h(name)+'</p><p>This Permanently Deletes the Record.</p><form><div class="dialog-actions">'+btn(label)+
    '<button type="button" class="btn">Cancel</button></div>'+message+'</form>';
  dialog.querySelector('[type=button]').onclick=()=>dialog.close();
  dialog.onclose=()=>dialog.remove();
  bind(dialog.querySelector('form'),action);
  main.append(dialog);dialog.showModal();
}
async function adminMarkets(target) {
  const rows=await api('/admin/markets');
  target.innerHTML='<section class="panel accounts-panel"><div class="admin-section-head"><div><h2>Market Directory</h2><p>Review Market Status or Restore an Archived Market.</p></div><a class="btn primary" href="/new">Create Market</a></div>'+
    '<div class="account-filters"><input type="search" placeholder="Search Markets" aria-label="Search Markets in Directory">'+
    select('Status','market-status',[['','All Statuses'],...Object.entries(statusNames),['archived','Archived']],'')+'</div><div data-market-list></div><p class="feedback" role="status"></p></section>';
  const search=target.querySelector('input'), status=target.querySelector('select'), list=target.querySelector('[data-market-list]');
  const render=()=>{
    const term=search.value.trim().toLowerCase();
    list.innerHTML=table(['Market','Status','Trades',''],rows.filter(row=>(!status.value||status.value===(row.archived?'archived':row.status))&&
      [row.title,row.category].some(value=>value.toLowerCase().includes(term))).map(row=>[
      '<a href="'+market(row.id)+'"><strong>'+h(row.title)+'</strong></a><small>'+h(row.category)+'</small>',
      row.archived?'Archived':statusNames[row.status],String(row.trades),
      '<div class="account-actions"><a class="btn" href="/new?edit='+row.id+'">Edit</a>'+(row.result===null&&!row.trades?'<button class="btn" data-delete-market="'+row.id+'">Delete</button>':'')+(row.archived||row.result!==null||!row.trades?'<button class="btn" data-archive="'+row.id+'">'+(row.archived?'Restore':'Archive')+'</button>':
        row.status==='closed'?'<a class="btn" href="'+market(row.id)+'#resolve">Resolve Market</a>':'<a class="btn" href="'+market(row.id)+'">Open Market</a>')+'</div>'
    ]),'No Matching Markets.');
  };
  search.oninput=status.onchange=render;render();
  list.onclick=event=>{
    const remove=event.target.closest('[data-delete-market]');
    if(remove){
      const row=rows.find(item=>item.id===Number(remove.dataset.deleteMarket));
      return confirmDeletion('Delete Market',row.title,async()=>{await api('/admin/markets/delete',{id:row.id});location.reload();});
    }
    const button=event.target.closest('[data-archive]');
    if(!button)return;
    const row=rows.find(item=>item.id===Number(button.dataset.archive));
    const archive=!row.archived, label=archive?'Archive Market':'Restore Market';
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label',label);
    dialog.innerHTML='<h2>'+label+'</h2><p>'+h(row.title)+'</p><p>'+(archive?'Hide This Market From the Feed. Its History and Direct Link Stay Available.':'Show This Market in the Feed Again.')+'</p><form><div class="dialog-actions">'+btn(label)+'<button type="button" class="btn">Cancel</button></div>'+message+'</form>';
    dialog.querySelector('[type=button]').onclick=()=>dialog.close();
    dialog.onclose=()=>dialog.remove();
    bind(dialog.querySelector('form'),async()=>{
      await api('/admin/markets/archive',{id:row.id,archived:archive});
      row.archived=archive;
      dialog.close();render();search.focus();
    });
    main.append(dialog);dialog.showModal();
  };
}
async function admin() {
  if(app.user?.role!=='admin')throw Error('Admin Access Required.');
  const cfg=app.cfg;
  const tabs=[['appearance','Appearance'],['accounts','Accounts'],['market-admin','Markets'],['platform','Platform Settings']];
  const requested=query.get('tab');
  const tab=['access','markets'].includes(requested)?'platform':tabs.some(([id])=>id===requested)?requested:'appearance';
  const visibility=[['off','Hidden'],['members','Signed-In Members'],['public','Public']];
  const fields={
    appearance:inp('Site Name','name',cfg.name,'text','required maxlength="54"')+inp('Site Description','description',cfg.description,'text','maxlength="180"')+
      '<div class="field-grid">'+inp('Accent Color','accent',cfg.accent,'color')+inp('Currency Label','currency',cfg.currency,'text','required maxlength="18"')+
      select('Default Theme','theme',[['system','System'],['light','Light'],['dark','Dark']],cfg.theme)+
      select('Layout Density','density',[['comfortable','Comfortable'],['compact','Compact']],cfg.density)+'</div>'+check('Show Featured Market','featured',cfg.featured)+
      '<label>Logo and Favicon<span class="file-picker"><input type="file" name="upload" accept="image/png"><span class="btn">Choose File</span><span id="file-name">No File Chosen</span></span></label>'+check('Use the Default Logo','reset',false),
    operations:select('Who Can Create Markets?','creator',[['member','Members and Above'],['moderator','Moderators and Admins'],['admin','Admins Only']],cfg.creator)+
      select('Who Can Close and Resolve Markets?','resolver',[['moderator','Moderators and Admins'],['admin','Admins Only']],cfg.resolver)+
      inp('Market Categories','categories',cfg.categories.join(', '),'text','required maxlength="400"')+'<p class="muted">Separate Categories With Commas. Existing Markets Keep Their Category.</p><a href="/?status=closed">View Closed Markets →</a>',
    visibility:check('Allow Guests to Browse Markets','browse',cfg.browse)+select('Leaderboard','leaderboard',visibility,cfg.leaderboard)+select('Leaderboard Ranking','ranking',[['value','Estimated Account Value'],['balance','Available Credits']],cfg.ranking)+select('Audit Log','audit',[['off','Admins Only'],...visibility.slice(1)],cfg.audit)+
      '<p class="muted">A Public Audit Log Shows Account Names and Administrative Actions.</p><a href="/audit">View Audit Log →</a>'
  };
  main.innerHTML=title('Administration')+'<div class="admin-layout"><nav aria-label="Admin Sections">'+tabs.map(([id,label])=>
    '<a class="'+(id===tab?'active':'')+'" href="/admin?tab='+id+'">'+label+'</a>').join('')+'</nav><div id="admin-body"></div></div>';
  const target=document.querySelector('#admin-body');
  if(tab==='market-admin') return adminMarkets(target);
  if(tab==='platform') {
    target.innerHTML='<div class="platform-grid">'+[['operations','Market Operations'],['visibility','Visibility and Rankings']].map(([id,name])=>
      '<form class="panel form-panel settings-card" data-settings="'+id+'"><h2>'+name+'</h2>'+fields[id]+btn('Save Changes')+message+'</form>').join('')+'</div>';
    target.querySelectorAll('[data-settings]').forEach(form=>bind(form,async data=>{
      const changes=Object.fromEntries(data);
      if(form.dataset.settings==='visibility') changes.browse=data.has('browse');
      await api('/admin/settings',changes);
      form.querySelector('.feedback').textContent='Changes Saved.';
    }));
    return;
  }
  if(tab==='accounts') {
    const accounts=await api('/admin/accounts');
    const policy='<form class="panel form-panel account-policy" id="account-policy"><h2>Registration</h2>'+
      select('Sign Ups','signUps',[['open','Open Sign Ups'],['closed','Closed Sign Ups']],cfg.signUps)+
      inp('Default Starting '+cfg.currency,'starting',cfg.starting,'number','required min="1" max="1000000"')+btn('Save Registration Settings')+message+'</form>';
    target.innerHTML='<div class="admin-section-head"><div><h2>Account Directory</h2><p>'+accounts.length+' Accounts · '+accounts.filter(user=>user.suspended).length+' Suspended</p></div>'+
      '<button class="btn primary" id="create-account">Create Account</button></div>'+
      '<div class="accounts-workspace"><section class="panel accounts-panel"><div class="account-filters"><input id="account-search" type="search" placeholder="Search Usernames" aria-label="Search Accounts">'+
      select('Role','role-filter',[['','All Roles'],...Object.entries(roles)],'')+select('Status','status-filter',[['','All Statuses'],['active','Active'],['suspended','Suspended']],'')+
      '</div><div id="account-list"></div></section><aside id="account-detail" class="panel"></aside></div>'+policy;
    bind(document.querySelector('#account-policy'),async data=>{
      const next={signUps:data.get('signUps'),starting:Number(data.get('starting'))};
      await api('/admin/settings',next);location.reload();
    });
    document.querySelector('#create-account').onclick=()=>{
      const dialog=document.createElement('dialog');
      dialog.setAttribute('aria-label','Create Account');
      dialog.innerHTML='<h2>Create Account</h2><form>'+
        inp('Username','name','','text','required minlength="3" maxlength="32" autocomplete="off"')+
        inp('Initial Password','password','','password','required minlength="3" maxlength="128" autocomplete="new-password"')+
        select('Role','role',Object.entries(roles),'member')+
        inp('Starting '+cfg.currency,'starting',cfg.starting,'number','required min="0" max="1000000"')+
        '<div class="dialog-actions">'+btn('Create Account')+'<button type="button" class="btn" id="cancel-create">Cancel</button></div>'+message+'</form>';
      dialog.querySelector('#cancel-create').onclick=()=>dialog.close();
      dialog.onclose=()=>dialog.remove();
      bind(dialog.querySelector('form'),async data=>{
        const values=Object.fromEntries(data);
        await api('/admin/accounts/create',{...values,starting:Number(values.starting)});
        location.reload();
      });
      main.append(dialog); dialog.showModal();
    };
    const list=document.querySelector('#account-list'), search=document.querySelector('#account-search');
    const roleFilter=target.querySelector('[name=role-filter]'), statusFilter=target.querySelector('[name=status-filter]');
    const detail=target.querySelector('#account-detail');
    let selected=accounts.find(user=>user.id!==app.user.id)||accounts[0];
    function renderAccounts() {
      const term=search.value.trim().toLocaleLowerCase();
      const filtered=accounts.filter(user=>(!roleFilter.value||roleFilter.value===user.role)&&(!statusFilter.value||statusFilter.value===(user.suspended?'suspended':'active'))&&user.name.toLocaleLowerCase().includes(term));
      if(!filtered.includes(selected)) selected=filtered[0];
      list.innerHTML=table(['Account','Role','Last Seen','Available Balance'],filtered.map(user=>[
        '<button type="button" class="account-cell account-choice" data-select="'+user.id+'" aria-pressed="'+(selected===user)+'"><span class="account-avatar avatar-color" data-avatar="'+h(user.avatar||'blue')+'">'+h(user.name.slice(0,2).toUpperCase())+'</span><span><strong>'+h(user.name)+'</strong>'+(user.suspended?'<small class="suspension-label">Suspended</small>':'')+'</span></button>',
        '<span class="role-chip">'+roles[user.role]+'</span>',
        user.lastSeen===null?'—':h(date(user.lastSeen)),
        h(money(user.balance))
      ]),'No Matching Accounts.');
      detail.innerHTML=selected?'<div class="account-detail-head"><span class="account-avatar avatar-color" data-avatar="'+h(selected.avatar||'blue')+'">'+h(selected.name.slice(0,2).toUpperCase())+'</span><div><h3>'+h(selected.name)+'</h3><p>'+roles[selected.role]+(selected.id===app.user.id?' · Your Account':'')+'</p></div></div>'+
        '<dl><div><dt>Available Balance</dt><dd>'+h(money(selected.balance))+'</dd></div><div><dt>Trades</dt><dd>'+selected.trades+'</dd></div><div><dt>Active Sessions</dt><dd>'+selected.sessions+'</dd></div></dl>'+
        '<div class="account-actions"><button class="btn primary" data-balance="'+selected.id+'">Change Balance</button>'+
        (selected.suspended&&!selected.trades&&!selected.ledger?'<button class="btn" data-delete-account="'+selected.id+'">Delete Account</button>':'')+(selected.id===app.user.id?'':'<button class="btn" data-account="'+selected.id+'">Manage Access</button>')+'</div>':'<p>No Matching Accounts.</p>';
    }
    search.oninput=renderAccounts;roleFilter.onchange=statusFilter.onchange=renderAccounts;renderAccounts();
    list.onclick=event=>{
      const button=event.target.closest('tr')?.querySelector('[data-select]');
      if(!button)return;
      selected=accounts.find(user=>user.id===Number(button.dataset.select));
      renderAccounts();
      list.querySelector('[aria-pressed=true]').focus();
    };
    detail.onclick=async event=>{
      const remove=event.target.closest('[data-delete-account]');
      if(remove) return confirmDeletion('Delete Account',selected.name,async()=>{
        await api('/admin/accounts/delete',{id:Number(remove.dataset.deleteAccount)});location.reload();
      });
      const balanceButton=event.target.closest('[data-balance]');
      if(balanceButton){
        const user=accounts.find(item=>item.id===Number(balanceButton.dataset.balance));
        const endpoint='/admin/accounts/'+user.id+'/adjustments';
        const dialog=document.createElement('dialog');
        dialog.className='balance-dialog';
        dialog.setAttribute('aria-label','Change Balance');
        dialog.innerHTML='<h2>Change Balance · '+h(user.name)+'</h2><p>Available: '+h(money(user.balance))+'</p><form>'+
          select('Change Type','direction',[['add','Add'],['remove','Remove']],'add')+
          inp('Amount ('+cfg.currency+')','amount','','number','required min="0.01" max="1000000" step="0.01"')+
          inp('Reason (Optional)','reason','','text','maxlength="240"')+
          '<div class="dialog-actions">'+btn('Save Changes')+'<button class="btn" type="button">Cancel</button></div>'+message+'</form><h3>Change History</h3><div data-ledger>Loading…</div>';
        dialog.querySelector('[type=button]').onclick=()=>dialog.close();
        dialog.onclose=()=>dialog.remove();
        let payloadKey, reference;
        bind(dialog.querySelector('form'),async data=>{
          const amount=Math.round(Number(data.get('amount'))*10000)*(data.get('direction')==='remove'?-1:1);
          const reason=data.get('reason').trim();
          const key=JSON.stringify([amount,reason]);
          if(key!==payloadKey){payloadKey=key;reference=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');}
          const result=await api(endpoint,{amount,reason,reference});
          user.balance=result.balance;
          if(user.id===app.user.id){app.user.balance=result.balance;chrome();}
          dialog.close();renderAccounts();search.focus();
        });
        main.append(dialog);dialog.showModal();
        const ledger=dialog.querySelector('[data-ledger]');
        try{
          const rows=await api(endpoint);
          ledger.innerHTML=table(['When','By','Change','Balance','Reason'],rows.map(row=>[h(date(row.at)),h(row.actor),h((row.amount>0?'+':'')+money(row.amount)),h(money(row.balance)),h(row.reason)]),'No Changes Yet.');
        }catch(error){ledger.textContent=error.message;}
        return;
      }
      const button=event.target.closest('[data-account]');
      if(!button)return;
      const user=accounts.find(item=>item.id===Number(button.dataset.account));
      const dialog=document.createElement('dialog');
      dialog.setAttribute('aria-labelledby','account-dialog-title');
      dialog.innerHTML='<h2 id="account-dialog-title">Manage Account</h2><p>'+h(user.name)+'</p><form>'+
        inp('Username','name',user.name,'text','required minlength="3" maxlength="32"')+avatarField(user.avatar)+select('Role','role',Object.entries(roles),user.role)+check('Suspend Account','suspended',user.suspended)+check('Sign Out of All Sessions','revoke',false)+inp('New Password (Optional)','password','','password','minlength="3" maxlength="128" autocomplete="new-password"')+
        '<div class="dialog-actions">'+btn('Save Access')+'<button type="button" class="btn" id="dismiss">Cancel</button></div>'+message+'</form>';
      dialog.querySelector('#dismiss').onclick=()=>dialog.close();
      dialog.onclose=()=>dialog.remove();
      bind(dialog.querySelector('form'),async data=>{
        const changes={id:user.id,name:data.get('name'),avatar:data.get('avatar'),role:data.get('role'),suspended:data.has('suspended'),revoke:data.has('revoke')};
        await api('/admin/accounts',{...changes,password:data.get('password')}); Object.assign(user,changes); if(changes.suspended||changes.revoke||data.get('password')) user.sessions=0; dialog.close(); renderAccounts(); search.focus();
      });
      main.append(dialog); dialog.showModal();
    };
    return;
  }
  target.innerHTML='<div class="admin-content"><form class="panel form-panel" id="settings"><h2>'+tabs.find(([id])=>id===tab)[1]+'</h2>'+fields[tab]+btn('Save Changes')+message+'</form>'+
    (tab==='appearance'?'<aside class="panel brand-preview"><span class="overline">Brand Preview</span><div><img id="draft-logo" src="'+(cfg.logo?'/brand.png':'/logo.svg')+'" alt=""><strong id="draft-name">'+h(cfg.name)+'</strong></div>'+
    '<p id="draft-description">'+h(cfg.description)+'</p><span class="btn primary" id="draft-action">View Market</span></aside>':'')+'</div>';
  const form=document.querySelector('#settings');
  let objectUrl;
  if(tab==='appearance') form.oninput=event=>{
    document.querySelector('#draft-name').textContent=form.elements.name.value;
    document.querySelector('#draft-description').textContent=form.elements.description.value;
    document.querySelector('#draft-action').style.background=form.elements.accent.value;
    if(event.target===form.elements.upload&&event.target.files[0]) {
      document.querySelector('#file-name').textContent=event.target.files[0].name;
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      objectUrl=URL.createObjectURL(event.target.files[0]);
    }
    document.querySelector('#draft-logo').src=form.elements.reset.checked?'/logo.svg':objectUrl||(cfg.logo?'/brand.png':'/logo.svg');
  };
  bind(form,async data=>{
    const {upload,reset,...values}=Object.fromEntries(data);
    const next={...values};
    if(tab==='appearance')next.featured=data.has('featured');
    if(tab==='appearance'&&upload?.size){
      if(upload.type!=='image/png'||upload.size>100000)throw Error('Choose a PNG No Larger Than 100 KB.');
      next.logo=btoa(Array.from(new Uint8Array(await upload.arrayBuffer()),byte=>String.fromCharCode(byte)).join(''));
    }else if(reset)next.logo='';
    await api('/admin/settings',next);location.reload();
  });
}
function demoEntry() {
  main.insertAdjacentHTML('afterbegin','<form class="demo-entry" id="demo"><span>Explore With a Sample Account.</span>'+btn('Enter the Demo')+message+'</form>');
  bind(document.querySelector('#demo'),async()=>{await api('/demo',{});location.assign('/');});
}
async function start() {
  app=await api('/state');chrome();
  if(app.setup||path==='/sign-up'||path==='/sign-in')return auth(app.setup||path==='/sign-up');
  if(path==='/admin')return admin();
  if(path==='/new'){
    const id=query.get('edit');
    if(!id)return newMarket();
    if(app.user?.role!=='admin'||!/^\d+$/.test(id)) throw Error('Admin Access Required.');
    return newMarket((await api(market(id))).item);
  }
  if(path==='/positions')return app.user?positions(...await Promise.all([api('/positions'),api('/activity')])):auth(false);
  if(path==='/leaderboard'){
    const rows=await api(path);
    const identity=row=>'<div class="account-cell"><span class="account-avatar">'+h(row.name.slice(0,2).toUpperCase())+'</span><strong>'+h(row.name)+'</strong></div>';
    main.innerHTML='<section class="leaderboard">'+title('Leaderboard',app.cfg.ranking==='balance'?'Ranked by Available Credits.':'Ranked by Available Credits Plus the Estimated Value of Unsettled Positions.')+
      '<ol class="rank-leaders" aria-label="Top Accounts" data-count="'+Math.min(rows.length,3)+'">'+rows.slice(0,3).map((row,index)=>'<li class="rank-card" data-rank="'+(index+1)+'"><span class="rank-number">#'+(index+1)+'</span>'+identity(row)+'<strong class="rank-value">'+h(money(row[app.cfg.ranking]))+'</strong></li>').join('')+'</ol>'+
      '<section class="standings"><div class="standings-head"><h2>Standings</h2><input type="search" placeholder="Search Accounts" aria-label="Search Accounts"></div><div id="rank-list"></div><p class="standings-note">Positions Count Each Market Outcome Traded Once. Win % Counts Profitable Resolved Markets, Excluding Voids. P&amp;L Reflects Realized Gains and Losses. Net Worth Includes Available Credits and Unsettled Positions.</p></section></section>';
    const search=document.querySelector('.standings input');
    const render=()=>document.querySelector('#rank-list').innerHTML=table(['Rank','Account','Positions','Win %','P&L','Net Worth'],rows.map((row,index)=>({row,index})).filter(({row})=>row.name.toLowerCase().includes(search.value.trim().toLowerCase())).map(({row,index})=>[String(index+1),identity(row),String(row.positions),row.decided?pct(row.wins/row.decided):'—','<strong class="'+(row.profit>0?'gain':row.profit<0?'loss':'')+'">'+h((row.profit>0?'+':'')+money(row.profit))+'</strong>',h(money(row.value))]),'No Matching Accounts.');
    search.oninput=render;render();return;
  }
  if(path==='/audit'){
    main.innerHTML=title('Audit Log')+table(['When','Performed By','Action'],(await api(path)).map(row=>[h(date(row.at)),h(row.actor),h(row.action)]));return;
  }
  if(!app.user&&!app.cfg.browse)return auth(false);
  if(path.startsWith('/market/'))return eventPage(await api(path));
  feed(await api('/feed'));
  if(app.showcase&&!app.hostedDemo) main.insertAdjacentHTML('afterbegin','<p class="demo-entry">Read-Only Showcase With Sample Data</p>');
  if(!app.user&&(app.demo||app.hostedDemo)) demoEntry();
}
start().catch(error=>{main.innerHTML='<section class="panel empty">'+title('Unable to Open This Page',error.message)+'<a class="btn" href="/">Back to Markets</a></section>';});
