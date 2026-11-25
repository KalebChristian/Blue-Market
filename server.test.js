'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
test('Fresh installation, visibility, taxonomy, trade and delegated settlement',{timeout:15000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'blue-market-fresh-'));
  const proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,BLUE_SETUP_CODE:'integration-only-setup-code',BLUE_HTTPS:'',BLUE_DATA:dir,SERVER_PORT:'0'}});
  const exited=once(proc,'exit');
  try {
    const [line]=await once(proc.stdout,'data');
    const base='http://127.0.0.1:'+line.toString().match(/Port (\d+)/)[1];
    async function call(path,body,cookie,status=200,origin) {
      const res=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',
        headers:{'Content-Type':'application/json','X-Blue-Market':'1',...(cookie?{Cookie:'theme=dark; '+cookie}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      const result=await res.json();
      assert.equal(res.status,status,JSON.stringify(result));
      const setCookie=res.headers.get('set-cookie');
      return {result,setCookie,cookie:setCookie?.split(';')[0]};
    }
    const rejected=await fetch(base+'/api/register',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(rejected.status,403);
    const crossSite=await fetch(base+'/api/register',{
      method:'POST',headers:{'Content-Type':'application/json','X-Blue-Market':'1','Sec-Fetch-Site':'cross-site'},body:'{}'
    });
    assert.equal(crossSite.status,403);
    const account={name:'Admin',password:'admin-password'};
    await call('/register',account,null,403);
    const registration=await call('/register',{...account,setup:'integration-only-setup-code'},null,200,base);
    assert.doesNotMatch(registration.setCookie,/; Secure/i);
    const httpsLogin=await call('/login',account,null,200,'https://example.test');
    assert.match(httpsLogin.setCookie,/; Secure/i);
    const admin=registration.cookie;
    assert.equal((await call('/state',undefined,admin)).result.user.role,'admin');
    await call('/register',{name:'Casey',password:'casey-password'},null,403);
    const {result:managed}=await call('/admin/accounts/create',{name:'Taylor',password:'initial-password',role:'member',starting:0},admin);
    await call('/admin/accounts/create',{name:'Taylor',password:'initial-password',role:'member'},admin,409);
    await call('/admin/accounts/create',{name:'TooShort',password:'ab',role:'member'},admin,400);
    const disposable=(await call('/admin/accounts/create',{name:'Spare',password:'abc',role:'member'},admin)).result;
    await call('/login',{name:'Spare',password:'abc'});
    await call('/admin/accounts/delete',{id:disposable.id},admin,409);
    await call('/admin/accounts',{id:disposable.id,role:'member',suspended:true},admin);
    await call('/admin/accounts/delete',{id:disposable.id},admin);
    const managedCookie=(await call('/login',{name:'Taylor',password:'initial-password'})).cookie;
    assert.equal((await call('/state',undefined,managedCookie)).result.user.balance,0);
    await call('/admin/accounts/create',{name:'Other',password:'initial-password',role:'admin'},managedCookie,403);
    await call('/account',{name:'Taylor',avatar:'green'},managedCookie,403);
    const directory=(await call('/admin/accounts',undefined,admin)).result;
    assert.ok(Number.isInteger(directory.find(row=>row.id===managed.id).lastSeen));
    const adjustments='/admin/accounts/'+managed.id+'/adjustments';
    const credit={amount:125000,reference:'test-adjustment'};
    await call(adjustments,credit,managedCookie,403);
    await call(adjustments,credit,admin);
    await call(adjustments,credit,admin);
    await call(adjustments,{amount:-130000,reason:'Too Much',reference:'overspend'},admin,400);
    assert.equal((await call(adjustments,undefined,admin)).result.length,1);
    assert.equal((await call('/state',undefined,managedCookie)).result.user.balance,125000);
    await call(adjustments,{amount:-25000,reason:'Test Debit',reference:'test-debit'},admin);
    const adjustedHistory=(await call('/activity',undefined,managedCookie)).result.history.at(-1);
    assert.equal(adjustedHistory.adjustmentsNet,100000);
    assert.equal(adjustedHistory.value,100000);
    await call('/admin/accounts',{id:managed.id,role:'member',password:'updated-password'},admin);
    assert.equal((await call('/state',undefined,managedCookie)).result.user,null);
    await call('/login',{name:'Taylor',password:'initial-password'},null,401);
    await call('/login',{name:'Taylor',password:'updated-password'});
    await call('/audit',undefined,null,401);
    assert.ok((await call('/audit',undefined,admin)).result.some(row=>row.action==='Created Member Account for Taylor'));
    const cfg=(await call('/state')).result.cfg;
    delete cfg.logo;
    await call('/admin/settings',{...cfg,categories:'Sports, Science',signUps:'open',browse:false,audit:'public',leaderboard:'public'},admin);
    await call('/feed',undefined,null,401);
    await call('/admin/settings',{leaderboard:'public'},admin);
    assert.deepEqual((await call('/state')).result.cfg.categories,['Sports','Science']);
    const member=(await call('/register',{name:'Casey',password:'casey-password'})).cookie;
    const state=(await call('/state',undefined,member)).result;
    assert.equal(state.user.role,'member');
    const draft={title:'Will It Work?',category:'Science',rules:'Use the published result.',labels:['Yes','No'],closes:Date.now()+60000};
    await call('/markets',draft,member,403);
    const {id:temporary}=(await call('/markets',draft,admin)).result;
    await call('/admin/markets/edit',{...draft,id:temporary,title:'Revised Question?',labels:['First','Second','Third']},admin);
    assert.deepEqual((await call('/market/'+temporary,undefined,admin)).result.item.labels,['First','Second','Third']);
    await call('/admin/markets/delete',{id:temporary},admin);
    await call('/market/'+temporary,undefined,admin,404);
    const {id}=(await call('/markets',draft,admin)).result;
    assert.ok(id>temporary);
    const target='/market/'+id;
    const selected=(await call(target,undefined,member)).result.item;
    assert.equal(Object.hasOwn(selected,'tags'),false);
    assert.equal(selected.category,'Science');
    const order={outcome:0,shares:10};
    const quote=(await call(target+'/quote',order,member)).result;
    await call(target+'/trade',{...order,debit:quote.debit,reference:'unique-order'},member);
    await call(target+'/trade',{...order,debit:quote.debit,reference:'unique-order'},member);
    await call('/admin/markets/edit',{...draft,id,title:'Different Question?'},admin,409);
    await call('/admin/markets/delete',{id},admin,409);
    await call('/admin/markets/archive',{id,archived:true},member,403);
    await call('/admin/markets/archive',{id,archived:true},admin,409);
    assert.equal((await call('/positions',undefined,member)).result[0].shares,10);
    await call(target+'/close',{reason:'Member cannot close.'},member,403);
    await call('/admin/accounts',{id:state.user.id,role:'moderator'},admin);
    await call(target+'/close',{reason:'Verified Event Started.'},member);
    await call(target+'/close',{reason:'Already Closed.'},member,409);
    await call(target+'/quote',order,member,409);
    await call(target+'/settle',{result:0,note:'Verified result.'},member);
    await call(target+'/settle',{result:0,note:'Duplicate.'},member,409);
    assert.equal((await call('/state',undefined,member)).result.user.balance,10010000-quote.debit+90000);
    const resolved=(await call(target,undefined,member)).result;
    assert.deepEqual(resolved.item.payouts,[10000,0]);
    assert.ok(resolved.item.settledAt>=resolved.history.at(-1).at);
    assert.equal(resolved.history.length,1);
    const activity=(await call('/activity',undefined,member)).result;
    assert.equal(activity.orders.length,1);
    assert.equal(activity.orders[0].market,id);
    assert.equal(activity.history.at(-1).value,10010000-quote.debit+90000);

    await call('/admin/markets/archive',{id,archived:true},admin);
    assert.equal((await call('/feed',undefined,member)).result.length,0);
    assert.equal((await call(target,undefined,member)).result.item.archived,true);
    assert.equal((await call('/admin/markets',undefined,admin)).result.length,1);
    await call('/admin/markets/archive',{id,archived:false},admin);
    assert.equal((await call('/feed',undefined,member)).result.length,1);
    const standings=(await call('/leaderboard')).result;
    assert.equal(standings.length,3);
    const casey=standings.find(row=>row.name==='Casey');
    assert.equal(casey.profit,100000-quote.debit);
    assert.equal(casey.wins,1);
    assert.equal(casey.positions,1);
    assert.equal(casey.decided,1);
    const taylor=standings.find(row=>row.name==='Taylor');
    assert.equal(taylor.profit,0);
    assert.equal(taylor.decided,0);
    const {id:voidId}=(await call('/markets',draft,admin)).result;
    const voidPath='/market/'+voidId;
    const buy=(await call(voidPath+'/quote',order,member)).result;
    await call(voidPath+'/trade',{...order,debit:buy.debit,reference:'void-buy'},member);
    const sale={outcome:0,shares:-4};
    const sell=(await call(voidPath+'/quote',sale,member)).result;
    await call(voidPath+'/trade',{...sale,debit:sell.debit,reference:'void-sell'},member);
    const during=(await call('/leaderboard')).result.find(row=>row.name==='Casey');
    assert.equal(during.profit,casey.profit+Math.round(-sell.debit-buy.debit*0.4));
    await call(voidPath+'/close',{},member);
    await call(voidPath+'/settle',{result:-1},member);
    const voided=(await call(voidPath,undefined,member)).result.item;
    assert.deepEqual(voided.payouts,[5000,5000]);
    assert.equal(voided.note,'');
    const after=(await call('/leaderboard')).result.find(row=>row.name==='Casey');
    assert.equal(after.profit,casey.profit+30000-buy.debit-sell.debit);
    assert.equal(after.wins,1);
    assert.equal(after.positions,2);
    assert.equal(after.decided,1);
    const audit=(await call('/audit')).result.map(row=>row.action);
    for(const action of [
      'Created “Will It Work?”',
      'Closed Trading for “Will It Work?” Because of “Verified Event Started.”',
      'Resolved “Will It Work?” as “Yes”',
      'Archived “Will It Work?”',
      'Restored “Will It Work?”',
      'Changed Balance for Taylor by +12.5 Credits',
      'Changed Balance for Taylor by -2.5 Credits',
      'Changed Role for Casey to Moderator',
      'Reset Password for Taylor'
    ]) assert.ok(audit.includes(action),action);
    assert.ok(audit.some(action=>action.includes('Updated Settings for')&&action.includes('Market Categories')));
    await call('/admin/accounts',{id:managed.id,name:'RenamedTaylor',avatar:'orange',role:'member',suspended:true},admin);
    await call('/admin/accounts/delete',{id:managed.id},admin,409);
  }finally{proc.kill();await exited;await rm(dir,{recursive:true,force:true});}
});

test('Public showcase serves sample data and rejects writes',{timeout:15000},async()=>{
  const proc=spawn(process.execPath,['server.js','--showcase'],{cwd:__dirname,env:{...process.env,SERVER_PORT:'0'}});
  const exited=once(proc,'exit');
  try {
    const [line]=await once(proc.stdout,'data');
    const base='http://127.0.0.1:'+line.toString().match(/Port (\d+)/)[1];
    const state=await (await fetch(base+'/api/state')).json();
    assert.equal(state.showcase,true);
    assert.equal(state.user.role,'member');
    const feed=await (await fetch(base+'/api/feed')).json();
    assert.ok(feed.some(item=>item.status==='resolved'));
    assert.equal((await fetch(base+'/api/positions')).status,200);
    assert.equal((await fetch(base+'/api/admin/accounts')).status,403);
    for(const path of ['/demo','/register','/market/1/trade','/admin/settings']){
      const response=await fetch(base+'/api'+path,{
        method:'POST',headers:{'Content-Type':'application/json','X-Blue-Market':'1'},body:'{}'
      });
      assert.equal(response.status,403,path);
      assert.equal(response.headers.has('set-cookie'),false,path);
    }
  }finally{proc.kill();await exited;}
});

test('Hosted demo gives each visitor an isolated sandbox',{timeout:15000},async()=>{
  const proc=spawn(process.execPath,['server.js','--public-demo'],{cwd:__dirname,env:{...process.env,SERVER_PORT:'0',BLUE_HTTPS:'0'}});
  const exited=once(proc,'exit');
  try{
    const [line]=await once(proc.stdout,'data');
    const base='http://127.0.0.1:'+line.toString().match(/Port (\d+)/)[1];
    const request=(path,body,cookie)=>fetch(base+'/api'+path,{
      method:body===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json','X-Blue-Market':'1',...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    async function enter(){
      const response=await request('/demo',{});
      assert.equal(response.status,200);
      return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    }
    const [first,second]=await Promise.all([enter(),enter()]);
    const state=async cookie=>(await request('/state',undefined,cookie)).json();
    assert.equal((await state()).showcase,true);
    assert.equal((await state()).user,null);
    assert.equal((await state(first)).user.role,'admin');
    assert.equal((await request('/admin/settings',{name:'My Demo'},first)).status,200);
    assert.equal((await state(first)).cfg.name,'My Demo');
    assert.equal((await state(second)).cfg.name,'Blue Market');
    assert.equal((await state()).cfg.name,'Blue Market');
    const feed=await (await request('/feed')).json();
    assert.equal(feed.length,16);
    assert.ok(feed.some(row=>row.status==='void'));
    const open=feed.find(row=>row.status==='open');
    const path='/market/'+open.id;
    const order={outcome:0,shares:3};
    const quote=await (await request(path+'/quote',order,first)).json();
    assert.equal((await request(path+'/trade',{...order,debit:quote.debit,reference:'sandbox-test'},first)).status,200);
    const volume=async cookie=>(await (await request(path,undefined,cookie)).json()).item.volume;
    assert.ok(await volume(first)>open.volume);
    assert.equal(await volume(second),open.volume);
    assert.equal(await volume(),open.volume);
    assert.ok((await (await request('/audit')).json()).length>20);
    assert.equal((await (await request('/leaderboard')).json()).length,7);
    assert.equal((await request('/leave-demo',{},first)).status,200);
    assert.equal((await state(first)).showcase,true);
    assert.equal((await state(second)).sandbox,true);
  }finally{proc.kill();await exited;}
});
