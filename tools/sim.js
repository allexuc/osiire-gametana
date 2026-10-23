// Headless check v3 for 札上の楼閣 (完全版): syntax, engine invariants over 3 chapters, troupes, levels, selling, and balance with a greedy bot.
// usage: node tools/sim.js index.html [runs] [level] [troupe|all] [locked]
// env: HACHA=1 (ハチャメチャ箱), RELICS=poker,tarot (最初から持たせるガラクタ), ALLGAMES=1 (遊び道具を全部), TB=1 (一座ごとのボス戦), TRICKS=1 (役の回数)
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(process.argv[2],'utf8'),N=+(process.argv[3]||400),LV=+(process.argv[4]||0),TR=process.argv[5]||'all',LOCKED=process.argv[6]==='locked';
const js=src.split('<script>').map(s=>s.split('</script>')[0]).find(s=>s.includes('==ENGINE START=='));
if(!js){console.log('engine not found in',process.argv[2]);process.exit(1);}
try{new vm.Script(js,{filename:'page.js'});console.log('syntax: OK');}catch(e){console.log('SYNTAX ERROR:',e.message);process.exit(1);}
const eng=js.split('// ==ENGINE START==')[1].split('// ==ENGINE END==')[0];
const ctx={console};vm.createContext(ctx);
vm.runInContext(eng+'\nthis.E={newRun,availableNodes,pickEnemy,startBattle,startTurn,canPlace,placeCard,wedgeCard,demolish,endTurn,finishBattle,nextChapter,trinketChoices,chapterHeal,memOf,cdata,CARDS,ENEMIES,TRINKETS,EVENTS,DOODLES,CHAPTERS,TROUPES,TROUPE_ORDER,UNLOCKS,LEVELS,genShop,sellCard,sellPrice,restHeal,upgradeCard,removeCard,doodleCard,dupCard,microwave,addCard,incoming,tierOf,sups,rowNb,rowAll,above,towerCount,offerCards,randTrinket,randDoodle,canUpgrade,canDoodle,rnd,pick,label,fxLines,desc,threats,actLabel,actDesc,actVal,fallDmg,has,BOOM,MIN_DECK,costOf,gameChoices,GAME_KEYS,TAROT,pokerHand,bjEval,trickPreview,boomVal,HANA};',ctx);
const E=ctx.E;
// tuning overrides: TUNE="2:0.9,0.95;3:0.9,0.9" (chapter:hpM,atkM)  EHP="robo:280,vent:450"
for(const p of(process.env.TUNE||'').split(';').filter(Boolean)){const[c,v]=p.split(':'),[h,a]=v.split(',').map(Number);E.CHAPTERS[+c].hpM=h;E.CHAPTERS[+c].atkM=a;}
if(process.env.TRP){const o=JSON.parse(process.env.TRP);for(const t in o)Object.assign(E.TROUPES[t],o[t]);}
for(const p of(process.env.EHP||'').split(',').filter(Boolean)){const[id,v]=p.split(':');E.ENEMIES[id].hp=+v;}
const ST={tb:{},timeouts:0,demos:0,flips:0,booms:0,crowns:0,dets:0,swaps:0,runBest:[],en:{},sold:0,soldBtn:0,battleBtn:0,eventBtn:0,mem:[],chReach:[0,0,0,0],troupe:{},deck:[],stalls:0};
function check(run){const b=run.b;if(!b)return;
 for(let k=4;k<10;k++){const X=b.tower[k];if(!X||X.c.kw.float)continue;const[p,q]=E.sups(k);if(!b.tower[p]||!b.tower[q])throw new Error('unsupported card at slot '+k);}
 const all=[...b.hand,...b.draw,...b.disc,...b.tower.filter(Boolean).map(x=>x.i),...b.en.bag],real=all.filter(x=>!x.tmp);
 if(real.length!==run.deck.length)throw new Error(`card count ${real.length} != deck ${run.deck.length}`);
 if(new Set(all.map(x=>x.u)).size!==all.length)throw new Error('duplicate uid');
 for(const v of[b.hp,b.grd,b.brc,b.act,b.en.hp,b.en.blk,b.en.str,b.weak,b.chill])if(!Number.isFinite(v)||v<0)throw new Error('bad number '+v);
 if(b.hp>b.maxHp)throw new Error('hp over max');if(b.en.hp>b.en.max)throw new Error('enemy hp over max');if(b.hand.length>10)throw new Error('hand over 10');}
const TRICK_SC=n=>n==='21!'?20:n==='革命'||n==='革命返し'?6:n==='七並べ'?6:n==='ペア'?4:['猪鹿蝶','月見で一杯','花見で一杯','三光','赤短','青短'].includes(n)?12:0;
function score(run,c,k,m,inc,hi){const b=run.b,F=c.fx,t=E.tierOf(k),tc=E.towerCount(b)+1,r=c.kw.twice?2:1;let s=0;if(hi!=null&&!process.env.NAIVE)s+=TRICK_SC(E.trickPreview(run,hi,k));
 if(F.dmg)s+=F.dmg*m*1.2*r;if(F.dmgT)s+=F.dmgT*tc*m*1.2*r;
 const needG=Math.max(0,inc.atk-b.grd);if(F.grd)s+=Math.min(F.grd*m*r,needG)+F.grd*m*0.1;if(F.grdT)s+=Math.min(F.grdT*tc*m,needG);
 const needB=Math.max(0,inc.knocks-b.brc);if(F.brc)s+=Math.min(F.brc*m*r,needB)*4+F.brc*m*0.5;
 if(F.heal)s+=Math.min(F.heal*m*r,b.maxHp-b.hp)*0.6;if(F.healT)s+=Math.min(F.healT*tc*m,b.maxHp-b.hp)*0.6;
 if(F.weak){const e=b.en,pat=E.ENEMIES[b.eid].pat[e.step];let hits=0;for(const x of pat)if(x.a==='atk')hits+=x.n;s+=Math.min(F.weak*m*hits,needG)*0.9;}
 if(F.lull&&!b.lull)s+=needG*0.45;
 if(F.draw)s+=F.draw*2;if(F.act)s+=F.act*3;
 if(c.kw.aura)s+=3;if(c.kw.cheer)s+=2*c.kw.cheer;if(c.kw.clone)s+=4;if(c.kw.bomb)s+=3;if(c.kw.spring)s+=1;if(c.kw.chain)s+=2;
 if(c.kw.echo&&b.last)s+=((b.last.fx.dmg||0)*1.2+(b.last.fx.grd||0)*0.5)*m;
 if(F.mirror&&t>0){for(const q of E.sups(k)){const X=b.tower[q];if(X)s+=((X.c.fx.dmg||0)*1.2+(X.c.fx.grd||0)*0.4+(X.c.fx.brc||0)*2)*m;}}
 if(F.multiply)s+=b.hand.length*3;
 if(F.swap)s+=b.hand.filter(h=>{for(let q=0;q<10;q++)if(!b.tower[q])return false;return true;}).length+1;
 if(F.shuffle){for(const X of b.tower)if(X)s+=(X.c.fx.dmg||0)*2.4;}
 if(F.det){let n=0;for(let q=0;q<10;q++){const X=b.tower[q];if(X&&X.c.kw.bomb)n+=E.fallDmg(run,q)+15;}s+=n?n:-5;}
 if(F.flip){if(tc-1>=6){for(let q=0;q<10;q++){const X=b.tower[q];if(X)s+=E.fallDmg(run,q)*3+(X.c.kw.bomb?15:0);}}else s-=10;}
 if(c.kw.dust)s+=0.5;
 s+=t*0.8;if(tc===10)s+=30;return s;}
function estDemo(run,k){const b=run.b,T=b.tower.slice(),q=[k],boom=E.boomVal(run),mm=E.has(run,'menko')?3:1;let dmg=0,n=0,bombs=0;
 for(;;){while(q.length){const s=q.shift(),X=T[s];if(!X)continue;T[s]=null;n++;dmg+=E.fallDmg(run,s)*mm;
   if(X.c.kw.bomb){bombs++;dmg+=boom;for(const nb of E.rowNb(s).concat(E.above(s)))if(T[nb]&&!T[nb].c.kw.steady)q.push(nb);}
   if(X.c.kw.chain)for(const nb of E.rowAll(s))if(T[nb]&&!T[nb].c.kw.steady)q.push(nb);}
  let more=false;for(let m=4;m<10;m++){const Y=T[m];if(!Y||Y.c.kw.float)continue;const[p,r]=E.sups(m);if(!T[p]||!T[r]){q.push(m);more=true;}}if(!more)break;}
 return{dmg,n,bombs};}
function countFx(fx){for(const f of fx){if(f.t==='trick'){ST.tricks=ST.tricks||{};ST.tricks[f.n]=(ST.tricks[f.n]||0)+1;}if(f.t==='boom')ST.booms++;if(f.t==='flip')ST.flips++;if(f.t==='crown')ST.crowns++;if(f.t==='det')ST.dets++;if(f.t==='swap')ST.swaps++;}}
function placeLoop(run,lim){const b=run.b;let n=0;
 while(n++<lim&&!b.over){const inc=E.incoming(run);let best=null;
  for(let hi=0;hi<b.hand.length;hi++)for(let k=0;k<10;k++){const ck=E.canPlace(run,hi,k);if(!ck.ok)continue;const sc=score(run,E.cdata(b.hand[hi]),k,ck.m,inc,hi);if(!best||sc>best.sc)best={hi,k,sc};}
  if(!best||best.sc<=0)break;if(typeof E.trickPreview(run,best.hi,best.k)!=='string')throw new Error('trickPreview');const fx=E.placeCard(run,best.hi,best.k);if(!fx)throw new Error('placeCard null for a legal move');countFx(fx);check(run);}}
function canAny(run){const b=run.b;for(let hi=0;hi<b.hand.length;hi++)for(let k=0;k<10;k++)if(E.canPlace(run,hi,k).ok)return true;return false;}
function aiTurn(run){const b=run.b;placeLoop(run,25);
 for(let g=0;g<3&&!b.over&&b.act>=1;g++){let bd=null;for(let k=0;k<10;k++){if(!b.tower[k])continue;const e=estDemo(run,k);if(!bd||e.dmg>bd.dmg)bd=Object.assign({k},e);}
  if(!bd)break;const inc=E.incoming(run);
  const lethal=bd.dmg>=b.en.hp+b.en.blk,doomed=inc.knocks>b.brc&&bd.bombs>0&&bd.dmg>=20;
  const stall=g===0&&((b.hand.length>0&&E.towerCount(b)>=6&&!canAny(run))||(!b.hand.length&&!b.draw.length&&!b.disc.length));
  if(!(lethal||doomed||stall))break;if(stall)ST.stalls++;const fx=E.demolish(run,bd.k);if(!fx)throw new Error('demolish null');ST.demos++;countFx(fx);check(run);
  if(stall)placeLoop(run,10);}
 if(!b.over&&!b.wedge&&b.hand.length){const inc=E.incoming(run);if(inc.knocks>b.brc&&E.towerCount(b)>=2){E.wedgeCard(run,0);check(run);}}}
const S=k=>ST.en[k]||(ST.en[k]={n:0,win:0,turns:0,loss:0});
function fight(run,eid,f){E.startBattle(run,eid,f);const hp0=run.hp;let turns=0;const tb=E.ENEMIES[eid].tier==='boss'?(ST.tb[run.troupe+':'+eid]||(ST.tb[run.troupe+':'+eid]={n:0,win:0,hp:0})):null;if(tb){tb.n++;tb.hp+=run.hp;}
 while(!run.b.over&&turns<60){turns++;E.startTurn(run);check(run);aiTurn(run);if(run.b.over)break;const fx=E.endTurn(run);countFx(fx);check(run);E.threats(run);
  for(const x of E.ENEMIES[eid].pat[run.b.en.step]){if(!E.actLabel(x,run.b.en)||!E.actDesc(x,run.b.en))throw new Error('intent text');}}
 const r=run.b.over||'timeout',s=S(eid);if(tb&&r==='win')tb.win++;if(r==='timeout')ST.timeouts++;s.n++;s.turns+=turns;s.loss+=hp0-run.b.hp;if(r==='win')s.win++;return r;}
const RARK={r:3,u:2,c:1,st:0,x:-1};
function takeReward(run,rw){ST.battleBtn+=rw.btn;const os=rw.cards.slice().sort((a,b)=>RARK[E.CARDS[b.d].rar]-RARK[E.CARDS[a.d].rar]||(b.dd?1:0)-(a.dd?1:0));
 if(os.length&&!(run.deck.length>=20&&E.CARDS[os[0].d].rar==='c'))E.addCard(run,os[0].d,0,os[0].dd);}
function chooseNode(run,av){const pref=n=>n.t==='rest'?(run.hp<run.maxHp*0.55?5:1):n.t==='elite'?(run.hp>run.maxHp*0.7?3:-2):n.t==='shop'?(run.btn>=70?3:0):n.t==='treasure'?4:2;
 let best=av[0],bs=-99;for(const a of av){const n=run.map.fl[a[0]][a[1]];const p=pref(n)+E.rnd(run.rng)*0.5;if(p>bs){bs=p;best=a;}}return best;}
const WEAK=['dust','s2','d2','c2','h2','s3','d3'];
function sellJunk(run,maxSell,mul){let n=0;
 for(const id of WEAK){while(n<maxSell&&run.deck.length>Math.max(E.MIN_DECK,id==='dust'?0:13)){const x=run.deck.find(c=>c.d===id&&!c.up&&!c.dd);if(!x)break;const p=E.sellCard(run,x.u,mul);if(p<0)throw new Error('sell refused');ST.sold++;ST.soldBtn+=p;n++;}}
 return n;}
function playRun(seed,troupe){const o={troupe,lv:LV};if(LOCKED){o.lockC=[];o.lockR=[];for(const u of E.UNLOCKS){if(u.kind==='cards')o.lockC.push(...u.ids);if(u.kind==='relics')o.lockR.push(...u.ids);}}
 if(process.env.HACHA)o.hacha=1;
 const run=E.newRun(seed,o),seenEv=[];
 for(const r of (process.env.RELICS||'').split(',').filter(Boolean))if(!run.tr.includes(r))run.tr.push(r);
 if(process.env.ALLGAMES)for(const r of E.GAME_KEYS)if(!run.tr.includes(r))run.tr.push(r);
 for(;;){const av=E.availableNodes(run);if(!av.length)return{res:'stuck',run};
  const[f,i]=chooseNode(run,av),n=run.map.fl[f][i];run.floor=f;run.node=i;n.done=1;
  if(n.t==='battle'||n.t==='elite'||n.t==='boss'){const eid=E.pickEnemy(run,n.t,f),r=fight(run,eid,f);
   if(r!=='win')return{res:'lose',eid,run};
   if(n.t==='boss'&&run.ch===3){run.won=1;run.bosses++;return{res:'win',run};}
   const rw=E.finishBattle(run);takeReward(run,rw);
   if(n.t==='boss'){const trs=E.trinketChoices(run,3);E.nextChapter(run,trs[0]||null);ST.chReach[run.ch]++;}}
  else if(n.t==='rest'){if(run.hp<run.maxHp*0.6)run.hp+=E.restHeal(run);else{const c=run.deck.find(x=>E.canUpgrade(x)&&E.CARDS[x.d].s==='S')||run.deck.find(E.canUpgrade);if(c)E.upgradeCard(run,c.u);}}
  else if(n.t==='shop'){const b0=run.btn,sh=E.genShop(run);sellJunk(run,3,1);
   sh.cards.sort((a,b)=>RARK[E.CARDS[b.d].rar]-RARK[E.CARDS[a.d].rar]).forEach(x=>{if(run.btn>=x.p&&E.CARDS[x.d].rar!=='c'){run.btn-=x.p;E.addCard(run,x.d,0,x.dd);}});
   sh.trs.forEach(x=>{if(run.btn>=x.p){run.btn-=x.p;run.tr.push(x.id);}});
   if(run.btn>=sh.ddP){const c=run.deck.find(x=>E.canDoodle(x)&&E.CARDS[x.d].s==='S');if(c){E.doodleCard(run,c.u,sh.dd);run.btn-=sh.ddP;}}
   if(run.btn<0)throw new Error('negative buttons');void b0;}
  else if(n.t==='event'){const left=E.EVENTS.filter(e=>!seenEv.includes(e.id)),ev=E.pick(run.rng,left.length?left:E.EVENTS);seenEv.push(ev.id);
   const cx={dd:E.randDoodle(run)},ch=E.pick(run.rng,ev.ch),b0=run.btn;
   for(const c of ev.ch){const l=typeof c.l==='function'?c.l(run,cx):c.l;if(typeof l!=='string'||!l)throw new Error('event label '+ev.id);}
   if(ch.pickUp){const c=run.deck.find(E.canUpgrade);if(c)E.upgradeCard(run,c.u);}
   else if(ch.pickRemove){const c=run.deck.find(x=>x.d==='dust')||run.deck.find(x=>x.d==='s2')||run.deck[0];E.removeCard(run,c.u);}
   else if(ch.pickDoodle){const c=run.deck.find(E.canDoodle);if(c)E.doodleCard(run,c.u,cx.dd);}
   else if(ch.pickMicro){const c=run.deck.find(x=>E.CARDS[x.d].rar!=='x');if(c&&typeof E.microwave(run,c.u)!=='string')throw new Error('micro text');}
   else if(ch.pickDup){const c=run.deck.slice().sort((a,b)=>RARK[E.CARDS[b.d].rar]-RARK[E.CARDS[a.d].rar])[0];if(c)E.dupCard(run,c.u);}
   else if(ch.pickSell2){sellJunk(run,1,2);}
   else if(ch.pickGame){const g=E.gameChoices(run,3);if(g.length){run.hp=Math.max(1,run.hp-4);run.tr.push(g[0]);ST.gamePick=(ST.gamePick||0)+1;}}
   else{const t=ch.f(run,cx);if(typeof t!=='string')throw new Error('event text '+ev.id);}
   if(run.btn>b0&&!ch.pickSell2)ST.eventBtn+=run.btn-b0;}
  else if(n.t==='treasure'){const t=E.randTrinket(run);if(t)run.tr.push(t);else run.btn+=30;}
  if(run.hp<=0||run.hp>run.maxHp)throw new Error('run hp out of range '+run.hp);
  if(run.deck.length<E.MIN_DECK&&run.deck.length<12)throw new Error('deck below minimum '+run.deck.length);}}
// text helpers must not throw for any card / doodle / upgrade, nor any enemy intent
for(const id in E.CARDS){for(const dd of['',...Object.keys(E.DOODLES)]){const c=E.cdata({d:id,up:0,dd});E.label(c);E.fxLines(c,0);E.fxLines(c,2);if(!E.desc(c)&&id!=='dust')throw new Error('empty desc '+id);E.label(E.cdata({d:id,up:1,dd}));}}
for(const id in E.ENEMIES){const en={am:1,str:0,bag:[]};for(const st of E.ENEMIES[id].pat)for(const x of st){if(!E.actLabel(x,en)||!E.actDesc(x,en))throw new Error('missing intent text '+id+' '+x.a);}}
for(let c=1;c<=3;c++){const C=E.CHAPTERS[c];for(const id of[...C.normal,...C.elite,C.boss])if(!E.ENEMIES[id])throw new Error('chapter enemy missing '+id);}
for(const t of E.TROUPE_ORDER){for(const d of E.TROUPES[t].deck)if(!E.CARDS[d])throw new Error('troupe card missing '+d);for(const r of E.TROUPES[t].tr)if(!E.TRINKETS[r])throw new Error('troupe relic missing '+r);}
for(const u of E.UNLOCKS){for(const id of u.ids||[]){if(u.kind==='cards'&&!E.CARDS[id])throw new Error('unlock card '+id);if(u.kind==='relics'&&!E.TRINKETS[id])throw new Error('unlock relic '+id);}}
let wins=0,errors=0;const deaths={},where={};
for(let s=1;s<=N;s++){const troupe=TR==='all'?E.TROUPE_ORDER[(s-1)%E.TROUPE_ORDER.length]:TR;
 try{const r=playRun(s*7919,troupe),run=r.run;ST.runBest.push(run.best||0);ST.mem.push(E.memOf(run));ST.deck.push(run.deck.length);ST.chReach[1]++;
  const T=ST.troupe[troupe]||(ST.troupe[troupe]={n:0,win:0,ch2:0,ch3:0});T.n++;if(run.ch>=2)T.ch2++;if(run.ch>=3)T.ch3++;
  if(r.res==='win'){wins++;T.win++;}else{deaths[r.eid]=(deaths[r.eid]||0)+1;const w=run.ch+'-'+run.floor;where[w]=(where[w]||0)+1;}}
 catch(e){errors++;if(errors<=3)console.log('ERROR seed',s,troupe,e.stack.split('\n').slice(0,4).join(' | '));}}
const srt=a=>a.slice().sort((x,y)=>x-y),q=(a,p)=>a[Math.min(a.length-1,Math.floor(a.length*p))];
const bs=srt(ST.runBest),ms=srt(ST.mem);
console.log(`level ${LV}  troupe ${TR}${LOCKED?'  (locked pool)':''}`);
console.log(`runs ${N}  wins ${wins} (${(wins/N*100).toFixed(1)}%)  errors ${errors}  timeouts ${ST.timeouts}  stalls ${ST.stalls}`);
console.log(`reach ch2 ${(ST.chReach[2]/N*100).toFixed(0)}%  ch3 ${(ST.chReach[3]/N*100).toFixed(0)}%`);
console.log('deaths by enemy',JSON.stringify(deaths));
console.log('deaths by ch-floor',JSON.stringify(Object.fromEntries(Object.entries(where).sort())));
console.log(`per run: demolish ${(ST.demos/N).toFixed(1)}  flips ${(ST.flips/N).toFixed(2)}  dets ${(ST.dets/N).toFixed(2)}  swaps ${(ST.swaps/N).toFixed(2)}  booms ${(ST.booms/N).toFixed(1)}  crowns ${(ST.crowns/N).toFixed(1)}`);
console.log(`buttons per run: battles ${(ST.battleBtn/N).toFixed(0)}  events ${(ST.eventBtn/N).toFixed(0)}  sold ${(ST.soldBtn/N).toFixed(0)} (${(ST.sold/N).toFixed(1)} cards)`);
console.log(`best hit per run: median ${q(bs,.5)}  p90 ${q(bs,.9)}  max ${bs[bs.length-1]}   memory per run: median ${q(ms,.5)}  mean ${(ST.mem.reduce((a,b)=>a+b,0)/N).toFixed(0)}   final deck mean ${(ST.deck.reduce((a,b)=>a+b,0)/N).toFixed(1)}`);
for(const t in ST.troupe){const T=ST.troupe[t];console.log(`  ${t.padEnd(6)} runs ${T.n}  win ${(T.win/T.n*100).toFixed(0)}%  ch2 ${(T.ch2/T.n*100).toFixed(0)}%  ch3 ${(T.ch3/T.n*100).toFixed(0)}%`);}
if(process.env.TB){for(const t of E.TROUPE_ORDER){const row=['robo','vent','vacuum'].map(b=>{const x=ST.tb[t+':'+b];return x?`${b} ${(x.win/x.n*100).toFixed(0)}% (arrive hp ${(x.hp/x.n).toFixed(0)})`:b+' -';});console.log('  boss '+t.padEnd(6)+' '+row.join('  '));}}
for(const k of Object.keys(ST.en).sort((a,b)=>E.ENEMIES[a].ch-E.ENEMIES[b].ch)){const s=ST.en[k];console.log(`  ch${E.ENEMIES[k].ch} ${k.padEnd(8)} fights ${String(s.n).padStart(4)}  win ${(s.win/s.n*100).toFixed(0).padStart(3)}%  turns ${(s.turns/s.n).toFixed(1)}  hpLoss ${(s.loss/s.n).toFixed(1)}`);}
if(process.env.TRICKS&&ST.tricks)console.log('tricks per run',JSON.stringify(Object.fromEntries(Object.entries(ST.tricks).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,+(v/N).toFixed(2)]))));
if(process.env.DUMP)console.log("DUMP "+JSON.stringify(ST.troupe));
