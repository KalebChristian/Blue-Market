'use strict';
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync, backup } = require('node:sqlite');
const { mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomBytes, createHash, scryptSync, timingSafeEqual } = require('node:crypto');

const hostedDemo = process.argv.includes('--public-demo');
const showcase = hostedDemo || process.argv.includes('--showcase');
const seedSamples=process.argv.includes('--seed-samples');
const demo = showcase || process.argv.includes('--demo');
const directory = resolve(process.env.BLUE_DATA || join(__dirname, 'data'));
if (!demo) mkdirSync(directory, {recursive:true});
const scope=new AsyncLocalStorage();
const baseDb=openDatabase(demo?':memory:':join(directory,'market.sqlite'));
const database=()=>scope.getStore()?.db??baseDb;
function openDatabase(path) {
  const db=new DatabaseSync(path);
  db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, secret TEXT NOT NULL, role TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0), suspended INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account INTEGER REFERENCES accounts, expires INTEGER);
  CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS markets(id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, rules TEXT NOT NULL, labels TEXT NOT NULL, inventory TEXT NOT NULL, created INTEGER NOT NULL, closes INTEGER NOT NULL, result INTEGER, note TEXT);
  CREATE TABLE IF NOT EXISTS deleted_market_ids(id INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS archived_markets(market INTEGER PRIMARY KEY REFERENCES markets(id), at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS holdings(account INTEGER REFERENCES accounts, market INTEGER REFERENCES markets, outcome INTEGER, shares INTEGER NOT NULL CHECK(shares>=0), basis REAL NOT NULL, PRIMARY KEY(account,market,outcome));
  CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY, account INTEGER REFERENCES accounts, market INTEGER REFERENCES markets, outcome INTEGER, shares INTEGER, cost INTEGER, prices TEXT, at INTEGER, reference TEXT, UNIQUE(account,reference));
  CREATE INDEX IF NOT EXISTS market_history ON trades(market,id);
  CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account);
  CREATE TABLE IF NOT EXISTS balance_adjustments(id INTEGER PRIMARY KEY, account INTEGER NOT NULL REFERENCES accounts, actor INTEGER NOT NULL REFERENCES accounts, amount INTEGER NOT NULL, balance INTEGER NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, reference TEXT NOT NULL UNIQUE);
  CREATE INDEX IF NOT EXISTS balance_adjustments_account ON balance_adjustments(account,id);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL);
`);
  const columns=db.prepare('PRAGMA table_info(accounts)').all().map(column=>column.name);
  if(!columns.includes('avatar')) db.exec("ALTER TABLE accounts ADD COLUMN avatar TEXT NOT NULL DEFAULT 'blue'");
  if(!columns.includes('lastSeen')) db.exec('ALTER TABLE accounts ADD COLUMN lastSeen INTEGER');
  return db;
}

const defaults = {name:'Blue Market', description:'Make Your Call on What Happens Next.', currency:'Credits', theme:'system', accent:'#264aac', density:'comfortable', signUps:'closed', browse:true, leaderboard:'members', ranking:'value', featured:true, audit:'off', starting:1000, creator:'moderator', resolver:'moderator', categories:['Sports','Technology','Culture','Economy','Science','Community'], logo:''};
const get = (sql,...args) => database().prepare(sql).get(...args);
const all = (sql,...args) => database().prepare(sql).all(...args);
const run = (sql,...args) => database().prepare(sql).run(...args);
const avatars=['blue','green','purple','orange','slate'];
const key = () => randomBytes(24).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const unit = 10000;
const bootstrap = get("SELECT id FROM accounts WHERE role='admin' LIMIT 1") || demo ? null : process.env.BLUE_SETUP_CODE || key();
let setupCode = bootstrap;
const now = () => Date.now();
const roles = {member:0,moderator:1,admin:2};
const allows = (user, minimum) => !!user && roles[user.role] >= roles[minimum];
const settings = () => ({...defaults,...Object.fromEntries(all('SELECT key,value FROM config').map(row=>[row.key,JSON.parse(row.value)]))});
function saveConfig(values) {
  for (const [name,value] of Object.entries(values)) run('INSERT OR REPLACE INTO config VALUES(?,?)',name,JSON.stringify(value));
}
function error(status,message) { throw Object.assign(new Error(message),{status}); }
function atomic(action) {
  const db=database();
  db.exec('BEGIN IMMEDIATE');
  try { const result=action(); db.exec('COMMIT'); return result; }
  catch (failure) { db.exec('ROLLBACK'); throw failure; }
}
function str(value, name, max, optional=false) {
  if (typeof value !== 'string' || value.length>max || (!optional && !value.trim())) error(400,'Check the ' + name + ' Field.');
  return value;
}
function username(value) {
  const name=str(value,'Username',32);
  if(!/^[\p{L}\p{N}_.-]{3,32}$/u.test(name)) error(400,'Use a 3 – 32 Character Username.');
  return name;
}
function credentials(body) {
  const name=username(body.name), password=str(body.password,'Password',128,true);
  if ([...password].length<3) error(400,'Use a Password of at Least 3 Characters.');
  return {name,password};
}
function secret(password,salt=randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password,salt,64).toString('hex');
}
function same(a,b) {
  return timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
}
function secureCookie(req) {
  if(process.env.BLUE_HTTPS==='0') return false;
  if(process.env.BLUE_HTTPS==='1') return true;
  if(/^http:\/\//i.test(req.headers.origin||'')) return false;
  if(/^https:\/\//i.test(req.headers.origin||'')) return true;
  return !demo||hostedDemo;
}
function sessionCookie(req,res,value,age) {
  res.setHeader('Set-Cookie','bm3_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secureCookie(req) ? '; Secure' : ''));
}
function cookie(req) {
  return /(?:^|;\s*)bm3_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}
function actor(req) {
  const token=cookie(req);
  if(!token) return;
  const user=get('SELECT a.id,a.name,a.role,a.balance,a.avatar FROM accounts a JOIN sessions s ON s.account=a.id WHERE s.token=? AND s.expires>? AND a.suspended=0',hash(token),now());
  if(user) {
    const at=now();
    run('UPDATE accounts SET lastSeen=? WHERE id=? AND (lastSeen IS NULL OR lastSeen<=?)',at,user.id,at-60000);
  }
  return user;
}
function login(req,res,id) {
  const token=key(), age=604800;
  run('DELETE FROM sessions WHERE expires<=?',now());
  run('INSERT INTO sessions VALUES(?,?,?)',hash(token),id,now()+age*1000);
  run('UPDATE accounts SET lastSeen=? WHERE id=?',now(),id);
  sessionCookie(req,res,token,age);
}
const attempts = new Map();
function throttle(req) {
  const time=now();
  for (const [name,item] of attempts) if (item.until<=time) attempts.delete(name);
  const ip=req.socket.remoteAddress;
  const item=attempts.get(ip) || {until:time+60000,count:0};
  if (++item.count>30) error(429,'Too Many Attempts. Try Again in a Minute.');
  attempts.set(ip,item);
}
function log(who,action) { run('INSERT INTO audit(actor,action,at) VALUES(?,?,?)',who.name,action,now()); }

function balanceChange(name,amount,currency) {
  const value=new Intl.NumberFormat('en',{maximumFractionDigits:4,signDisplay:'always'}).format(amount/unit);
  return 'Changed Balance for '+name+' by '+value+' '+currency;
}

function auditEntries(currency) {
  return all('SELECT actor,action,at FROM audit ORDER BY id DESC LIMIT 100').map(entry=>{
    const market=/^(Created|Edited|Closed Trading for|Settled|Archived|Restored) Market #(\d+)(?: — ([\s\S]+))?$/.exec(entry.action);
    if(market) {
      const [,verb,id,reason]=market;
      const row=get('SELECT title,result,labels FROM markets WHERE id=?',Number(id));
      if(!row) return entry;
      const title='“'+row.title+'”';
      let action=verb+' '+title;
      if(verb==='Closed Trading for'&&reason) action+=' Because of “'+reason+'”';
      if(verb==='Settled'&&row.result===-1) action='Voided '+title;
      if(verb==='Settled'&&row.result>=0&&row.result!==null) action='Resolved '+title+' as “'+JSON.parse(row.labels)[row.result]+'”';
      return {...entry,action};
    }
    const legacyBalance=/^Adjusted Balance for (.+)$/.exec(entry.action);
    if(legacyBalance) {
      const name=legacyBalance[1];
      // Older entries did not store a ledger reference. Only use an unambiguous match.
      const matches=all(`
        SELECT adjustment.amount FROM balance_adjustments adjustment
        JOIN accounts target ON target.id=adjustment.account
        JOIN accounts admin ON admin.id=adjustment.actor
        WHERE target.name=? AND admin.name=? AND adjustment.at BETWEEN ? AND ?
      `,name,entry.actor,entry.at-10,entry.at);
      return {...entry,action:matches.length===1?balanceChange(name,matches[0].amount,currency):'Changed Balance for '+name};
    }
    return entry;
  });
}

function probability(q) {
  const top=Math.max(...q);
  const weights=q.map(x=>Math.exp((x-top)/55));
  const total=weights.reduce((a,b)=>a+b,0);
  return weights.map(x=>x/total);
}
function cost(q) {
  const top=Math.max(...q);
  return top+55*Math.log(q.reduce((sum,x)=>sum+Math.exp((x-top)/55),0));
}
function view(row) {
  const {inventory,labels,tags,...fields}=row;
  const summary=get('SELECT COALESCE(SUM(ABS(cost)),0) AS volume,COUNT(*) AS trades FROM trades WHERE market=?',row.id);
  return {...fields,labels:JSON.parse(labels),prices:probability(JSON.parse(inventory)),status:row.result!==null ? (row.result<0?'void':'resolved') : row.closes<=now()?'closed':'open',...summary};
}
function getMarket(id) {
  const row=get('SELECT * FROM markets WHERE id=?',id);
  if (!row) error(404,'Market Not Found.');
  return row;
}
function marketFields(body,existing) {
  const cfg=settings();
  const title=str(body.title,'Question',160), rules=str(body.rules,'Resolution Rules',2400);
  const category=str(body.category,'Category',36);
  if (!cfg.categories.includes(category)&&existing?.category!==category) error(400,'Choose an Available Category.');
  if (!Array.isArray(body.labels) || body.labels.length<2 || body.labels.length>6) error(400,'Choose 2 – 6 Outcomes.');
  const labels=body.labels.map(label=>str(label,'Outcome',70));
  if (new Set(labels.map(label=>label.trim().toLowerCase())).size!==labels.length) error(400,'Each Outcome Must Be Different.');
  if (!Number.isSafeInteger(body.closes) || (body.closes!==existing?.closes&&body.closes<=now())) error(400,'Choose a Future Closing Time.');
  return {title,category,rules,labels};
}
function create(body) {
  const {title,category,rules,labels}=marketFields(body);
  return Number(run('INSERT INTO markets(id,title,category,tags,rules,labels,inventory,created,closes) VALUES((SELECT MAX(COALESCE((SELECT MAX(id) FROM markets),0),COALESCE((SELECT MAX(id) FROM deleted_market_ids),0))+1),?,?,?,?,?,?,?,?)',title,category,'[]',rules,JSON.stringify(labels),JSON.stringify(labels.map(()=>0)),now(),body.closes).lastInsertRowid);
}
function quote(row,user,body) {
  const {outcome,shares}=body;
  if (row.result!==null || row.closes<=now()) error(409,'Trading Is Closed.');
  const q=JSON.parse(row.inventory);
  if (!Number.isInteger(outcome) || outcome<0 || outcome>=q.length || !Number.isInteger(shares) || !shares || Math.abs(shares)>500) error(400,'Choose an Outcome and Enter 1 – 500 Shares.');
  const held=get('SELECT shares,basis FROM holdings WHERE account=? AND market=? AND outcome=?',user.id,row.id,outcome) || {shares:0,basis:0};
  if (held.shares+shares<0) error(400,'You Do Not Hold That Many Shares.');
  const next=q.slice(); next[outcome]+=shares;
  const debit=Math.ceil((cost(next)-cost(q))*unit);
  if (debit>get('SELECT balance FROM accounts WHERE id=?',user.id).balance) error(400,'Insufficient Credits.');
  return {debit, next, held, price:probability(next)[outcome]};
}
function trade(row,user,body,at=now()) {
  return atomic(()=>{
    const reference=str(body.reference,'Order Reference',80);
    const prior=get('SELECT market,outcome,shares FROM trades WHERE account=? AND reference=?',user.id,reference);
    if (prior) {
      if (prior.market!==row.id || prior.outcome!==body.outcome || prior.shares!==body.shares) error(409,'Order Reference Already Used.');
      return {};
    }
    const {debit,next,held}=quote(row,user,body);
    if (body.debit!==debit) error(409,'Price Changed. Review a New Quote.');
    const quantity=held.shares+body.shares;
    const basis=body.shares>0 ? held.basis+debit : held.basis*quantity/held.shares;
    run('UPDATE accounts SET balance=balance-? WHERE id=?',debit,user.id);
    run('INSERT INTO holdings VALUES(?,?,?,?,?) ON CONFLICT(account,market,outcome) DO UPDATE SET shares=excluded.shares,basis=excluded.basis',user.id,row.id,body.outcome,quantity,basis);
    run('UPDATE markets SET inventory=? WHERE id=?',JSON.stringify(next),row.id);
    run('INSERT INTO trades(account,market,outcome,shares,cost,prices,at,reference) VALUES(?,?,?,?,?,?,?,?)',user.id,row.id,body.outcome,body.shares,debit,JSON.stringify(probability(next)),at,reference);
    return {};
  });
}
function settle(row,user,body) {
  return atomic(()=>{
    const count=JSON.parse(row.labels).length;
    const result=body.result;
    if (!Number.isInteger(result)||result< -1||result>=count) error(400,'Choose a Result.');
    const note=str(body.note??'','Resolution Note',1800,true).trim();
    if (row.result!==null || row.closes>now()) error(409,'Only Closed Markets Can Be Settled.');
    for (const item of all('SELECT account,outcome,shares FROM holdings WHERE market=? AND shares>0',row.id)) {
      const payout=result===-1 ? Math.floor(unit/count) : result===item.outcome ? unit : 0;
      run('UPDATE accounts SET balance=balance+? WHERE id=?',payout*item.shares,item.account);
    }
    run('UPDATE markets SET result=?,note=? WHERE id=?',result,note,row.id);
    log(user,'Settled Market #' + row.id);
    return {};
  });
}
function updateSettings(body,user) {
  const current=settings();
  body={...current,categories:current.categories.join(', '),...body};
  const next={};
  for (const [name,length] of [['name',54],['description',180],['currency',18]]) next[name]=str(body[name],name,length,name==='description');
  for (const [name,options] of Object.entries({theme:['system','light','dark'],density:['comfortable','compact'],signUps:['open','closed'],leaderboard:['off','members','public'],audit:['off','members','public'],creator:Object.keys(roles),resolver:['moderator','admin']})) {
    if (!options.includes(body[name])) error(400,'Check the ' + name + ' Setting.');
    next[name]=body[name];
  }
  if (body.ranking!==undefined) {
    if (!['value','balance'].includes(body.ranking)) error(400,'Choose a Leaderboard Ranking.');
    next.ranking=body.ranking;
  }
  if (typeof body.featured==='boolean') next.featured=body.featured;
  if (typeof body.accent!=='string' || !/^#[0-9a-f]{6}$/i.test(body.accent)) error(400,'Choose a Valid Accent Color.');
  if (!Number.isInteger(body.starting) || body.starting<1 || body.starting>1000000) error(400,'Set Starting Credits Between 1 and 1,000,000.');
  const categories=str(body.categories,'Categories',400).split(',').map(value=>value.trim()).filter(Boolean);
  if (!categories.length || categories.length>14 || categories.some(name=>name.length>36) || new Set(categories.map(name=>name.toLowerCase())).size!==categories.length) error(400,'Enter 1 – 14 Distinct Categories.');
  Object.assign(next,{accent:body.accent,starting:body.starting,browse:body.browse===true,categories});
  if (body.logo!==undefined) {
    if (typeof body.logo!=='string' || (body.logo && (body.logo.length>135000 || !/^iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(body.logo)))) error(400,'Choose a PNG No Larger Than 100 KB.');
    next.logo=body.logo;
  }
  const labels={name:'Site Name',description:'Site Description',currency:'Currency Label',theme:'Default Theme',density:'Layout Density',
    signUps:'Sign Ups',leaderboard:'Leaderboard Visibility',audit:'Audit Log Visibility',creator:'Market Creation Permissions',
    resolver:'Market Closure and Resolution Permissions',ranking:'Leaderboard Ranking',featured:'Featured Market',accent:'Accent Color',
    starting:'Default Starting Balance',browse:'Guest Browsing',categories:'Market Categories',logo:'Site Logo'};
  const changed=Object.keys(next).filter(key=>JSON.stringify(next[key])!==JSON.stringify(current[key]));
  return atomic(()=>{
    if(changed.length) {
      saveConfig(next);
      log(user,'Updated Settings for '+changed.map(key=>labels[key]).join(', '));
    }
    return {};
  });
}

const settlementTime=id=>get('SELECT at FROM audit WHERE action=? ORDER BY id DESC LIMIT 1','Settled Market #'+id)?.at;

function activity(user) {
  const relevant=all('SELECT DISTINCT market FROM trades WHERE account=?',user.id).map(row=>row.market);
  const adjustments=all('SELECT id,amount,at FROM balance_adjustments WHERE account=?',user.id);
  if (!relevant.length&&!adjustments.length) return {history:[{at:now(),value:user.balance}],orders:[]};
  const events=adjustments, orders=[];
  let funding=user.balance-adjustments.reduce((sum,row)=>sum+row.amount,0);
  let adjustmentsNet=0;
  for (const id of relevant) {
    const row=getMarket(id);
    const marketTrades=all('SELECT id,account,outcome,shares,cost,prices,at FROM trades WHERE market=? ORDER BY id',id);
    for (const entry of marketTrades) {
      events.push({...entry,market:id,prices:JSON.parse(entry.prices)});
      if(entry.account===user.id) {funding+=entry.cost;orders.push({...entry,market:id,title:row.title,label:JSON.parse(row.labels)[entry.outcome]});}
    }
    if(row.result!==null) {
      const settled=settlementTime(id);
      const perShare=row.result===-1 ? Math.floor(unit/JSON.parse(row.labels).length) : unit;
      const payout=all('SELECT outcome,shares FROM holdings WHERE account=? AND market=?',user.id,id).reduce((sum,holding)=>
        sum+((row.result===-1||row.result===holding.outcome)?holding.shares*perShare:0),0);
      funding-=payout;
      events.push({at:settled||row.closes,id:Number.MAX_SAFE_INTEGER,market:id,payout});
    }
  }
  events.sort((a,b)=>a.at-b.at||a.id-b.id);
  const quantity=new Map(), marked=new Map();
  let balance=funding, valueOfHoldings=0;
  const history=[{at:Math.min(events[0].at-1,now()-30*86400000),value:funding}];
  for(const event of events) {
    if(event.amount!==undefined) {
      balance+=event.amount;
      adjustmentsNet+=event.amount;
      history.push({at:event.at,value:balance+valueOfHoldings,adjustmentsNet});
      continue;
    }
    valueOfHoldings-=marked.get(event.market)||0;
    if(event.payout!==undefined) {balance+=event.payout;marked.set(event.market,0);}
    else {
      const shares=quantity.get(event.market)||event.prices.map(()=>0);
      if(event.account===user.id) {balance-=event.cost;shares[event.outcome]+=event.shares;}
      quantity.set(event.market,shares);
      const subtotal=shares.reduce((sum,count,i)=>sum+count*event.prices[i]*unit,0);
      marked.set(event.market,subtotal); valueOfHoldings+=subtotal;
    }
    history.push({at:event.at,value:balance+valueOfHoldings,adjustmentsNet});
  }
  history.push({at:now(),value:balance+valueOfHoldings,adjustmentsNet});
  const stride=Math.max(1,Math.ceil(history.length/700));
  return {history:history.filter((_,i)=>i%stride===0||i===history.length-1),orders:orders.sort((a,b)=>b.at-a.at||b.id-a.id).slice(0,100)};
}

async function bodyOf(req) {
  if (req.headers['content-type']?.split(';')[0]!=='application/json') error(415,'JSON Required.');
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>180000) error(413,'Request Too Large.');
    chunks.push(chunk);
  }
  let body;
  try { body=JSON.parse(Buffer.concat(chunks).toString()); } catch { error(400,'Invalid Request.'); }
  if (!body || typeof body!=='object' || Array.isArray(body)) error(400,'Invalid Request.');
  return body;
}
const sandboxLifetime=60*60*1000;
const sandboxLimit=32;
const sandboxes=new Map();
const sandboxTime=now();
const demoSecret=demo||seedSamples?secret(key()):null;
function findSandbox(req) {
  const token=/(?:^|;\s*)bm_sandbox=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
  const sandbox=token&&sandboxes.get(token);
  return sandbox&&sandbox.expires>now()?sandbox:null;
}
function pruneSandboxes() {
  for(const [token,sandbox] of sandboxes){
    if(sandbox.expires<=now()&&!sandbox.requests){
      sandbox.db.close();
      sandboxes.delete(token);
    }
  }
}
if(hostedDemo) setInterval(pruneSandboxes,60000).unref();
function enterSandbox(req,res) {
  throttle(req);
  const current=scope.getStore();
  if(current){login(req,res,1);return {};}
  pruneSandboxes();
  if(sandboxes.size>=sandboxLimit) error(503,'The Demo Is Full. Try Again Later.');
  const token=key(), sandbox={db:openDatabase(':memory:'),expires:now()+sandboxLifetime,requests:0};
  try {scope.run(sandbox,()=>{seed();login(req,res,1);});}
  catch(failure){sandbox.db.close();throw failure;}
  sandboxes.set(token,sandbox);
  res.setHeader('Set-Cookie',[res.getHeader('Set-Cookie')]);
  res.appendHeader('Set-Cookie','bm_sandbox='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600'+(secureCookie(req)?'; Secure':''));
  return {};
}
async function api(req,res,path) {
  const post=req.method==='POST';
  if (!post && req.method!=='GET') error(405,'Method Not Allowed.');
  const sandbox=scope.getStore();
  const readOnly=showcase&&!sandbox;
  if (post&&readOnly&&!(hostedDemo&&path==='/demo')) error(403,'This Showcase Is Read-Only.');
  if (post && req.headers['x-blue-market']!=='1') error(403,'Missing Request Header.');
  if (post && req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) error(403,'Invalid Request Origin.');
  const body=post ? await bodyOf(req) : {};
  if(post&&hostedDemo&&path==='/demo') return enterSandbox(req,res);
  if(post&&sandbox&&path==='/leave-demo'){
    sandbox.expires=0;
    sessionCookie(req,res,'',0);
    res.appendHeader('Set-Cookie','bm_sandbox=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(secureCookie(req)?'; Secure':''));
    return {};
  }
  const user=readOnly&&!hostedDemo?get('SELECT id,name,role,balance FROM accounts WHERE id=1'):readOnly?null:actor(req), cfg=settings();
  const visible=section=>section==='public' || (section==='members' && !!user) || user?.role==='admin';
  if (!post && path==='/state') return {user:user||null,cfg:{...cfg,logo:!!cfg.logo},setup:!!setupCode,demo:demo&&!showcase,showcase:readOnly,hostedDemo,sandbox:!!sandbox};
  if (post && path==='/demo' && demo&&!showcase) { login(req,res,1); return {}; }
  if (post && path==='/register') {
    throttle(req);
    const {name,password}=credentials(body);
    const id=atomic(()=>{
      const first=!!setupCode;
      if (first && (!setupCode || typeof body.setup!=='string' || !same(body.setup,setupCode))) error(403,'Enter the Setup Code from the Server Console.');
      if (!first && cfg.signUps!=='open') error(403,'Sign Ups Are Closed.');
      if (get('SELECT id FROM accounts WHERE name=?',name)) error(409,'That Username Is Taken.');
      return Number(run('INSERT INTO accounts(name,secret,role,balance) VALUES(?,?,?,?)',name,secret(password),first?'admin':'member',cfg.starting*unit).lastInsertRowid);
    });
    setupCode=null; login(req,res,id); return {};
  }
  if (post && path==='/login') {
    throttle(req);
    const account=get('SELECT * FROM accounts WHERE name=? AND suspended=0',str(body.name,'Username',32));
    const expected=account?.secret || '0000000000000000:invalid';
    if (!same(secret(str(body.password,'Password',128,true),expected.split(':')[0]),expected) || !account) error(401,'Username or Password Is Incorrect.');
    login(req,res,account.id); return {};
  }
  if (post && path==='/logout' && user) { run('DELETE FROM sessions WHERE token=?',hash(cookie(req))); sessionCookie(req,res,'',0); return {}; }
  if (!post && path==='/leaderboard' && visible(cfg.leaderboard)) {
    const standings=all('SELECT id,name,balance FROM accounts WHERE suspended=0');
    const byId=new Map(standings.map(row=>[row.id,{...row,value:row.balance,profit:0,positions:0,wins:0,decided:0}]));
    const markets=new Map();
    for(const row of all('SELECT account,market,outcome,shares FROM holdings WHERE shares>0')) {
      const account=byId.get(row.account);
      if (!account) continue;
      if (!markets.has(row.market)) markets.set(row.market,view(getMarket(row.market)));
      const item=markets.get(row.market);
      if (item.result===null) account.value+=Math.round(row.shares*item.prices[row.outcome]*unit);
    }
    const results=all(`
      WITH cash AS (
        SELECT account,market,SUM(cost) AS spent, COUNT(DISTINCT outcome) AS positions FROM trades GROUP BY account,market
      ), positions AS (
        SELECT holdings.account,holdings.market,SUM(holdings.basis) AS basis,
          SUM(CASE
            WHEN markets.result=-1 THEN holdings.shares * (? / json_array_length(markets.labels))
            WHEN markets.result=holdings.outcome THEN holdings.shares * ?
            ELSE 0
          END) AS payout
        FROM holdings JOIN markets ON markets.id=holdings.market
        GROUP BY holdings.account,holdings.market
      )
      SELECT cash.account,cash.positions,markets.result,
        CASE WHEN markets.result IS NULL THEN COALESCE(positions.basis,0)
             ELSE COALESCE(positions.payout,0) END - cash.spent AS profit
      FROM cash JOIN markets ON markets.id=cash.market
      LEFT JOIN positions ON positions.account=cash.account AND positions.market=cash.market
    `,unit,unit);
    for(const result of results) {
      const account=byId.get(result.account);
      if(!account) continue;
      account.positions+=result.positions;
      account.profit+=result.profit;
      if(result.result!==null&&result.result>=0) {
        account.decided++;
        if(result.profit>0) account.wins++;
      }
    }
    return [...byId.values()].sort((a,b)=>b[cfg.ranking]-a[cfg.ranking]||a.name.localeCompare(b.name)).slice(0,100)
      .map(({id,profit,...row})=>({...row,profit:Math.round(profit)}));
  }
  if (!post && path==='/audit' && visible(cfg.audit)) return auditEntries(cfg.currency);
  if (!post && path==='/feed' && (user||cfg.browse)) return all('SELECT * FROM markets WHERE id NOT IN (SELECT market FROM archived_markets) ORDER BY created DESC,id DESC').map(view);
  const match=/^\/market\/(\d+)(?:\/(quote|trade|settle|close))?$/.exec(path);
  if (match && !post && !match[2] && (user||cfg.browse)) {
    const marketId=Number(match[1]);
    const item={...view(getMarket(marketId)),archived:!!get('SELECT market FROM archived_markets WHERE market=?',marketId)};

    const history=all('SELECT prices,at FROM trades WHERE market=? ORDER BY id DESC LIMIT 200',item.id).reverse().map(row=>({...row,prices:JSON.parse(row.prices)}));
    const positions=user ? all('SELECT outcome,shares FROM holdings WHERE account=? AND market=? AND shares>0',user.id,item.id) : [];
    if(item.result!==null) {
      item.settledAt=settlementTime(item.id)??null;
      item.payouts=item.labels.map((_,index)=>item.result<0?Math.floor(unit/item.labels.length):index===item.result?unit:0);
    }
    return {item,history,positions};
  }
  if (!user) error(401,'Sign In to Continue.');
  if (!post && path==='/activity') return activity(user);
  if (!post && path==='/positions') return all('SELECT * FROM holdings WHERE account=? AND shares>0',user.id).map(row=>{
    const market=getMarket(row.market), item=view(market), q=JSON.parse(market.inventory), next=q.slice();
    next[row.outcome]-=row.shares;
    return {...row,item,exit:item.status==='open' ? -Math.ceil((cost(next)-cost(q))*unit) : null};
  });
  if (post && path==='/markets' && allows(user,cfg.creator)) return atomic(()=>{
    const id=create(body);
    log(user,'Created Market #'+id);
    return {id};
  });
  if (match && post) {
    const row=getMarket(Number(match[1]));
    if(get('SELECT market FROM archived_markets WHERE market=?',row.id)) error(409,'This Market Is Archived.');
    if (match[2]==='quote') { const {debit,price}=quote(row,user,body); return {debit,price}; }
    if (match[2]==='trade') return trade(row,user,body);
    if (match[2]==='close' && allows(user,cfg.resolver)) return atomic(()=>{
      if (row.result!==null||row.closes<=now()) error(409,'Trading Is Already Closed.');
      const reason=str(body.reason??'','Reason',240,true).trim();
      run('UPDATE markets SET closes=? WHERE id=?',now(),row.id);
      log(user,'Closed Trading for Market #'+row.id+(reason?' — '+reason:''));
      return {};
    });
    if (match[2]==='settle' && allows(user,cfg.resolver)) return settle(row,user,body);
  }
  if (user.role==='admin') {
    if (!post && path==='/admin/markets') return all('SELECT markets.*, archived_markets.at AS archived FROM markets LEFT JOIN archived_markets ON market=markets.id ORDER BY markets.id DESC').map(view);
    if (post && path==='/admin/markets/delete') return atomic(()=>{
      if(!Number.isInteger(body.id)) error(400,'Choose a Market.');
      const row=getMarket(body.id);
      if(row.result!==null||get('SELECT id FROM trades WHERE market=? LIMIT 1',row.id)) error(409,'Only Untraded, Unresolved Markets Can Be Deleted.');
      run('DELETE FROM archived_markets WHERE market=?',row.id);
      run('INSERT INTO deleted_market_ids(id) VALUES(?)',row.id);
      run('DELETE FROM markets WHERE id=?',row.id);
      log(user,'Deleted Market “'+row.title+'”');
      return {};
    });
    if (post && path==='/admin/accounts/delete') return atomic(()=>{
      if(!Number.isInteger(body.id)||body.id===user.id) error(400,'Choose Another Account.');
      const target=get('SELECT name,suspended FROM accounts WHERE id=?',body.id);
      if(!target) error(404,'Account Not Found.');
      if(!target.suspended||get('SELECT 1 FROM trades WHERE account=? UNION ALL SELECT 1 FROM holdings WHERE account=? UNION ALL SELECT 1 FROM balance_adjustments WHERE account=? OR actor=? LIMIT 1',body.id,body.id,body.id,body.id))
        error(409,'Only Suspended Accounts Without Trading or Balance History Can Be Deleted.');
      run('DELETE FROM sessions WHERE account=?',body.id);
      run('DELETE FROM accounts WHERE id=?',body.id);
      log(user,'Deleted Account for '+target.name);
      return {};
    });
    if (post && path==='/admin/markets/edit') return atomic(()=>{
      if(!Number.isInteger(body.id)) error(400,'Choose a Market.');
      const row=getMarket(body.id);
      const original=JSON.parse(row.labels);
      const locked=row.result!==null||!!get('SELECT id FROM trades WHERE market=? LIMIT 1',row.id);
      const fields=marketFields({...body,labels:body.labels??original,closes:body.closes??row.closes},row);
      if(locked&&(fields.title!==row.title||fields.rules!==row.rules||JSON.stringify(fields.labels)!==row.labels||
        (body.closes!==undefined&&body.closes!==row.closes))) error(409,'Trading History Locks the Question, Rules, Outcomes, and Schedule.');
      const changedOutcomes=JSON.stringify(fields.labels)!==row.labels;
      run('UPDATE markets SET title=?,category=?,rules=?,labels=?,inventory=?,closes=? WHERE id=?',
        fields.title,fields.category,fields.rules,JSON.stringify(fields.labels),changedOutcomes?JSON.stringify(fields.labels.map(()=>0)):row.inventory,body.closes??row.closes,row.id);
      log(user,'Edited Market #'+row.id);
      return {id:row.id};
    });
    if (post && path==='/admin/markets/archive') return atomic(()=>{
      if (!Number.isInteger(body.id)||typeof body.archived!=='boolean') error(400,'Choose a Market and Action.');
      const row=getMarket(body.id);
      const archived=!!get('SELECT market FROM archived_markets WHERE market=?',row.id);
      if(archived===body.archived) return {};
      if (body.archived) {
        if (row.result===null&&get('SELECT id FROM trades WHERE market=? LIMIT 1',row.id)) error(409,'Resolve This Market Before Archiving It.');
        run('INSERT INTO archived_markets(market,at) VALUES(?,?)',row.id,now());
      } else run('DELETE FROM archived_markets WHERE market=?',row.id);
      log(user,(body.archived?'Archived Market #':'Restored Market #')+row.id);
      return {};
    });
    if (!post && path==='/admin/accounts') return all(`
      SELECT id,name,role,suspended,balance,avatar,lastSeen,
        (SELECT COUNT(*) FROM trades WHERE account=accounts.id) AS trades,
        EXISTS(SELECT 1 FROM balance_adjustments WHERE account=accounts.id OR actor=accounts.id) AS ledger,
        (SELECT COUNT(*) FROM sessions WHERE account=accounts.id AND expires>?) AS sessions
      FROM accounts ORDER BY name
    `,now());
    const adjustments=/^\/admin\/accounts\/(\d+)\/adjustments$/.exec(path);
    if (adjustments) {
      const account=get('SELECT id,name,balance FROM accounts WHERE id=?',Number(adjustments[1]));
      if (!account) error(404,'Account Not Found.');
      if (!post) return all('SELECT adjustment.amount,adjustment.balance,adjustment.reason,adjustment.at,admin.name AS actor FROM balance_adjustments adjustment JOIN accounts admin ON adjustment.actor=admin.id WHERE adjustment.account=? ORDER BY adjustment.id DESC LIMIT 100',account.id);
      return atomic(()=>{
        const reference=str(body.reference,'Reference',64), reason=str(body.reason??'','Reason',240,true).trim();
        const amount=body.amount;
        if (!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000*unit) error(400,'Enter a Nonzero Adjustment Up to 1,000,000.');
        const previous=get('SELECT account,actor,amount,reason FROM balance_adjustments WHERE reference=?',reference);
        if (previous) {
          if(previous.account!==account.id||previous.actor!==user.id||previous.amount!==amount||previous.reason!==reason) error(409,'This Adjustment Reference Is Already Used.');
          return {balance:account.balance};
        }
        const balance=account.balance+amount;
        if(balance<0||!Number.isSafeInteger(balance)) error(400,'The Resulting Balance Is Out of Range.');
        run('UPDATE accounts SET balance=? WHERE id=?',balance,account.id);
        run('INSERT INTO balance_adjustments(account,actor,amount,balance,reason,at,reference) VALUES(?,?,?,?,?,?,?)',account.id,user.id,amount,balance,reason,now(),reference);
        log(user,balanceChange(account.name,amount,cfg.currency));
        return {balance};
      });
    }
    if (post && path==='/admin/settings') return updateSettings(body,user);
    if (post && path==='/admin/accounts/create') return atomic(()=>{
      const {name,password}=credentials(body);
      if (!Object.hasOwn(roles,body.role)) error(400,'Choose an Account Role.');
      if (get('SELECT id FROM accounts WHERE name=?',name)) error(409,'That Username Is Taken.');
      const starting=body.starting ?? cfg.starting;
      if (!Number.isInteger(starting)||starting<0||starting>1000000) error(400,'Choose Starting Credits Between 0 and 1,000,000.');
      const id=Number(run('INSERT INTO accounts(name,secret,role,balance) VALUES(?,?,?,?)',name,secret(password),body.role,starting*unit).lastInsertRowid);
      log(user,'Created '+body.role[0].toUpperCase()+body.role.slice(1)+' Account for '+name);
      return {id,name,role:body.role,suspended:0};
    });
    if (post && path==='/admin/accounts') return atomic(()=>{
      if (!Number.isInteger(body.id) || !Object.hasOwn(roles,body.role)) error(400,'Choose an Account and a Role.');
      const target=get('SELECT id,role,name,suspended,avatar FROM accounts WHERE id=?',body.id);
      if (!target || target.id===user.id) error(400,'Choose Another Account.');
      const name=body.name===undefined?target.name:username(body.name);
      const avatar=body.avatar??target.avatar;
      if(!avatars.includes(avatar)) error(400,'Choose an Avatar Color.');
      if(get('SELECT id FROM accounts WHERE name=? AND id<>?',name,target.id)) error(409,'That Username Is Taken.');
      run('UPDATE accounts SET role=?,suspended=?,name=?,avatar=? WHERE id=?',body.role,Number(body.suspended===true),name,avatar,target.id);
      if(name!==target.name) log(user,'Renamed Account '+target.name+' to '+name);
      if (body.password) {
        const {password}=credentials({name:target.name,password:body.password});
        run('UPDATE accounts SET secret=? WHERE id=?',secret(password),target.id);
        log(user,'Reset Password for '+target.name);
      }
      if (body.suspended===true||body.password||body.revoke===true) run('DELETE FROM sessions WHERE account=?',target.id);
      if (target.role!==body.role) log(user,'Changed Role for '+target.name+' to '+body.role[0].toUpperCase()+body.role.slice(1));
      if (Boolean(target.suspended)!==(body.suspended===true)) log(user,(body.suspended===true?'Suspended ':'Reactivated ')+'Account for '+target.name);
      if (body.revoke===true) log(user,'Signed '+target.name+' Out of All Sessions');
      return {};
    });
  }
  error(403,'This Action Is Unavailable.');
}

function seed() {
  const accounts=['Alex','Morgan','Casey','Avery','River','Quinn','Sage'];
  const categories=['Friends','Sports','Trips'];
  const admin={id:1,name:accounts[0]};
  atomic(()=>{
    saveConfig({signUps:'closed',categories,leaderboard:'public',audit:'public'});
    accounts.forEach((name,index)=>{
      const role=seedSamples&&!demo?'member':index===0?'admin':index===2?'moderator':'member';
      const lastSeen=index===accounts.length-1?null:sandboxTime-index*4*3600000;
      run('INSERT INTO accounts(id,name,secret,role,balance,suspended,avatar,lastSeen) VALUES(?,?,?,?,?,?,?,?)',
        index+1,name,demoSecret,role,defaults.starting*unit,0,avatars[index%avatars.length],lastSeen);
      run('INSERT INTO audit(actor,action,at) VALUES(?,?,?)',admin.name,'Created '+role[0].toUpperCase()+role.slice(1)+' Account for '+name,sandboxTime-(40-index)*86400000);
    });
    if(showcase&&!scope.getStore()) run("UPDATE accounts SET role='member' WHERE id=1");
  });
  const examples=[
    ['Will Jordan Land a Job Before the Semester Starts?', 'Friends', 0, 'Resolve Yes if Jordan Accepts a Paid Job Before Classes Start.'],
    ['Who Picks Up More Shifts Next Week?', 'Friends', 1, 'Compare the Final Roster on Sunday Night.', ['Jamie','Drew','Tie','Neither Works']],
    ['Who Finishes the Semester With the Highest GPA?', 'Friends', 0, 'Compare the Final Semester Results Shared With the Group.', ['Morgan','Casey','Avery','Tie']],
    ['Which Major Will Riley Choose by the End of Term?', 'Friends', 0, 'Use the Major Riley Confirms After Enrolment.', ['Computer Science','Design','Engineering','Still Undecided']],
    ['Who Wins Friday’s Five-a-Side Match?', 'Sports', 1, 'Use the Final Score Agreed by Both Captains.', ['North End','South End','Draw']],
    ['Does Jamie Post an Instagram Story Before Sunday?', 'Friends', 2, 'Count a Story Posted Before Midnight on Saturday.'],
    ['Will Riley Make It to Taipei Before the Group Trip Ends?', 'Trips', 1, 'Resolve Yes if Riley Arrives Before the Group Checks Out.'],
    ['Who Logs the Most Instagram Screen Time This Week?', 'Friends', 0, 'Compare the Weekly Totals Shown on Each Person’s Phone.', ['Avery','Morgan','Quinn','Tie']],
    ['Which Club Tops the Premier League at New Year?', 'Sports', 0, 'Use the League Table at Midnight UK Time on New Year’s Eve.', ['Arsenal','Liverpool','Manchester City','Another Club']],
    ['Who Tops Blue Market by the End of the Month?', 'Friends', 0, 'Use the Leaderboard Snapshot Taken Before This Market Is Settled.', ['Alex','Morgan','Casey','Someone Else']],
    ['Will Jordan Keep a 100-Day Language Streak?', 'Friends', 0, 'Use the Streak Counter Shown in the App.'],
    ['Will Everyone Make the Last Ferry Back?', 'Trips', 3, 'Use the Passenger Check-In Before the Last Departure.'],
    ['How Many of Us Make It to the First Dinner in Penang?', 'Trips', 0, 'Count People Who Are at the Table by 8 PM Local Time.', ['Three or Fewer','Four','Five','Six or More']],
    ['How Many Birthday Messages Does Riley Get Before Midnight?', 'Friends', 0, 'Count Distinct People Who Send a Birthday Message Before Midnight.', ['Five or Fewer','Six to Nine','Ten or More']],
    ['Who Wins the Sunday Badminton Rematch?', 'Sports', 2, 'Use the Result of the First Best-of-Three Match.', ['Casey','Quinn','Match Not Played']],
    ['Will Game Night Start Before 8:30 PM?', 'Friends', 1, 'Resolve Yes if Four People Are in the Voice Channel Before 8:30 PM.']
  ];
  examples.forEach(([title,category,state,rules,labels=['Yes','No']],index)=>{
    const id=create({title,category,labels,closes:now()+(index%18+2)*86400000,rules});
    const start=sandboxTime-(6+index%8)*86400000;
    run('UPDATE markets SET created=? WHERE id=?',start,id);
    run('INSERT INTO audit(actor,action,at) VALUES(?,?,?)',admin.name,'Created Market #'+id,start);
    for(let step=0;step<14;step++){
      const user={id:1+(index+step*5)%accounts.length};
      const row=getMarket(id);
      const direction=(step*7+index*3)%10;
      const outcome=direction<5?index%labels.length:(step+Math.floor(step/4)+index)%labels.length;
      const order={outcome,shares:2+(step*11+index*3)%12,reference:key()};
      trade(row,user,{...order,debit:quote(row,user,order).debit},start+step*4*3600000);
    }
    if(state){
      const closedAt=sandboxTime-(index%4+1)*3600000;
      run('UPDATE markets SET closes=? WHERE id=?',closedAt,id);
      run('INSERT INTO audit(actor,action,at) VALUES(?,?,?)','Casey','Closed Trading for Market #'+id,closedAt);
      if(state===1||state===3) settle(getMarket(id),{name:'Casey'},{result:state===3?-1:(index+(index%2===0?0:1))%labels.length});
    }
  });
  atomic(()=>{
    run('UPDATE accounts SET balance=balance+? WHERE id=?',50*unit,4);
    const account=get('SELECT balance FROM accounts WHERE id=4');
    run('INSERT INTO balance_adjustments(account,actor,amount,balance,reason,at,reference) VALUES(?,?,?,?,?,?,?)',
      4,1,50*unit,account.balance,'Sample Welcome Grant',sandboxTime,key());
    log(admin,balanceChange('Avery',50*unit,defaults.currency));
    log(admin,'Updated Settings for Market Categories, Leaderboard Visibility, Audit Log Visibility');
  });
}
if (demo||(seedSamples&&!get('SELECT id FROM accounts LIMIT 1'))) seed();
const assets={'/app.js':'text/javascript','/style.css':'text/css','/logo.svg':'image/svg+xml'};
const port=Number(process.env.SERVER_PORT||process.env.PORT||3000);
async function serve(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const result=await api(req,res,path.slice(4));
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result)); return;
    }
    if (req.method!=='GET') error(405,'Method Not Allowed.');
    if (path==='/brand.png') {
      const logo=settings().logo;
      if (!logo) error(404,'Logo Not Found.');
      res.setHeader('Content-Type','image/png'); res.end(Buffer.from(logo,'base64')); return;
    }
    const asset=Object.hasOwn(assets,path);
    if (!asset && !/^\/(?:$|positions$|admin$|new$|sign-in$|sign-up$|leaderboard$|audit$|market\/\d+$)/.test(path)) error(404,'Page Not Found.');
    res.setHeader('Content-Type',(asset ? assets[path] : 'text/html')+'; charset=utf-8');
    res.end(readFileSync(join(__dirname,'public',asset?path.slice(1):'index.html')));
  } catch(failure) {
    if (!failure.status) console.error(failure);
    res.statusCode=failure.status||500;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({error:failure.status?failure.message:'Something Went Wrong.'}));
  }
}
const server=http.createServer(async(req,res)=>{
  const sandbox=hostedDemo?findSandbox(req):null;
  if(!sandbox) return serve(req,res);
  sandbox.requests++;
  try {await scope.run(sandbox,()=>serve(req,res));}
  finally {sandbox.requests--;pruneSandboxes();}
});
if (process.argv[2]==='--backup') {
  if (!process.argv[3]) throw new Error('Provide a Backup Path.');
  const target=resolve(process.argv[3]);
  require('node:fs').closeSync(require('node:fs').openSync(target,'wx',0o600));
  backup(baseDb,target).then(()=>{ baseDb.close(); console.log('Backup Complete.'); }).catch(failure=>{ console.error(failure.message); process.exitCode=1; });
} else server.listen(port,process.env.BLUE_BIND||(demo&&!showcase?'127.0.0.1':'0.0.0.0'),()=>{
  console.log('Blue Market Ready on Port '+server.address().port);
  if (setupCode && !process.env.BLUE_SETUP_CODE) console.log('First Admin Setup Code: '+setupCode);
});
