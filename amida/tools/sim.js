// 一線打尽の自動プレイ。エンジン(// ==ENGINE START== 〜 // ==ENGINE END==)だけを読み、画面なしでランを回して数を出す。
// 使い方: node tools/sim.js index.html [ラン数] [学級 ichi|zukou|nicchoku|all]
// 環境変数:
//   BOT=smart|normal   かしこいボット(既定)か、ふつうボット(手を少しランダムに選ぶ)
//   SEED=1             最初のシード
//   STICKERS=a,b       最初から持たせるシール(STICKERS=all で全部)
//   PENS=hl,red        最初から持たせるペン
//   LINEUP=oni,oni,... 最初の駒5つを置き換える
//   NODRAW=1           線を一切引かない(書けないときの詰みを探す)
//   FILL=1             戦闘の最初に盤を線で埋める(書けないときの詰みを探す)
//   ONLYCH=1           1章だけで止める
//   VERBOSE=1          1ランの流れを表示
const fs=require('fs'),vm=require('vm');
const file=process.argv[2]||'index.html',N=+(process.argv[3]||300),GK=process.argv[4]||'ichi';
const src=fs.readFileSync(file,'utf8');
let eng;
if(src.includes('// ==ENGINE START==')){eng=src.split('// ==ENGINE START==')[1].split('// ==ENGINE END==')[0];}
else{console.log('engine not found in',file);process.exit(1);}
try{new vm.Script(eng,{filename:'engine.js'});}catch(e){console.log('SYNTAX ERROR:',e.message);process.exit(1);}
if(file.endsWith('.html')){const js=src.split('<script>').map(s=>s.split('</script>')[0]).filter(s=>s.includes('==ENGINE START=='));for(const s of js){try{new vm.Script(s,{filename:'page.js'});}catch(e){console.log('PAGE SYNTAX ERROR:',e.message);process.exit(1);}}}
const ctx={console,Math,JSON,Object,Array,Set,Map,Int16Array};vm.createContext(ctx);
vm.runInContext(eng+'\nthis.E={VERSION,COLS,ROWS,LEVELS,ROUTE_ROWS,PIECES,ENEMIES,CHAPTERS,PENS,STICKERS,GAKKYU,EVENTS,newRun,genMap,routePath,routeNext,routeCanPut,routePencil,chooseStart,advance,startBattle,startTurn,drawRung,eraseRung,undo,sekigae,actions,doAction,clash,commit,paths,pieceStats,atkVal,canPut,takeReward,takeSticker,buy,rest,chooseEvent,eventDone,chapterGo,swapLineup,addSticker,freePositions,addRung,has,rng};',ctx);
const E=ctx.E;
// 調整を試す: TUNE="0:1.5,1.3;1:1.4,1.2" (章:HP倍率,攻撃倍率)  EHP="kokuban:80" (敵のHP)
for(const p of(process.env.TUNE||'').split(';').filter(Boolean)){const[c,v]=p.split(':'),[h,a]=v.split(',').map(Number);E.CHAPTERS[+c].hpM=h;E.CHAPTERS[+c].atkM=a;}
for(const p of(process.env.EHP||'').split(',').filter(Boolean)){const[id,v]=p.split(':');E.ENEMIES[id].hp=+v;}
const BOT=process.env.BOT||'smart',SEED0=+(process.env.SEED||1),VERB=!!process.env.VERBOSE;
const log=(...a)=>{if(VERB)console.log(...a);};

/* ---------- 決まりごとの確認 ---------- */
function check(run,where){const b=run.b;
 for(const v of[run.hp,run.maxHp,run.money])if(!Number.isFinite(v)||v<0)throw new Error(where+': bad number '+v);
 if(run.hp>run.maxHp)throw new Error(where+': hp over max');
 if(run.pieces.length!==5)throw new Error(where+': pieces '+run.pieces.length);
 for(const p of run.pieces)if(!E.PIECES[p.k]||!(p.lv>=1&&p.lv<=3))throw new Error(where+': bad piece '+JSON.stringify(p));
 if(run.pens.length>3)throw new Error(where+': pens over 3');
 if(!b)return;
 for(const g of b.rungs){if(g.r<0||g.r>=E.ROWS||g.a<0||g.b>=E.COLS||g.b-g.a<1||g.b-g.a>2)throw new Error(where+': bad rung '+JSON.stringify(g));
  for(const h of b.rungs)if(h!==g&&h.r===g.r&&h.a<=g.b&&h.b>=g.a)throw new Error(where+': touching rungs '+JSON.stringify([g,h]));}
 const P=E.paths(b);for(const arr of[P.down,P.up])if(new Set(arr).size!==E.COLS)throw new Error(where+': not a permutation '+arr);
 if(new Set(b.lineup).size!==5)throw new Error(where+': lineup '+b.lineup);
 if(b.strokes<0)throw new Error(where+': strokes '+b.strokes);
 for(const k in b.penUses)if(b.penUses[k]<0)throw new Error(where+': pen uses');
 const occ=Array(E.COLS).fill(0);for(const e of b.en){if(e.hp<=0)continue;if(e.hp>e.max)throw new Error(where+': enemy hp over max');for(let s=0;s<e.w;s++){if(e.slot+s<0||e.slot+s>=E.COLS)throw new Error(where+': enemy slot');occ[e.slot+s]++;}}
 if(occ.some(n=>n>1))throw new Error(where+': enemies overlap');}

/* ---------- ボット: 戦闘 ---------- */
function avgAtk(e){const D=E.ENEMIES[e.k];const pats=D.phases?D.phases.flatMap(p=>p.pat):D.pat;let s=0;for(const it of pats)if(it.t==='atk')s+=it.v*(D.w||1);return s/pats.length;}
function scoreR(run,b,R){const hpf=run.hp/run.maxHp;let s=R.dealt;
 for(const id of R.kills){const e=b.en.find(x=>x.id===id);s+=6+(e?avgAtk(e)*1.6:0);}
 s+=Math.min(R.heal,run.maxHp-run.hp)*0.9+R.money*0.12+R.stroke*1.5;
 s-=R.taken*(hpf<0.35?2.4:1.6);
 for(const x of R.X)if(x.chill&&x.alive)s+=1.5;
 if(R.won)s+=60;if(!R.won&&run.hp-R.taken+Math.min(R.heal,run.maxHp-run.hp)<=0)s-=1000;
 return s;}
let gauss=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
// ふつうボット: 見込みを見ながら、思いついた数か所(K)だけ試して一番よいものを選ぶ人をまねる
const K1=+(process.env.K1||6),K2=+(process.env.K2||4);
const sample=(arr,k)=>{const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,k);};
function botTurn(run){const b=run.b;if(process.env.NODRAW)return;
 const normal=BOT==='normal',noise=normal?1.5:0;
 const sc=()=>scoreR(run,b,E.clash(run,b))+(noise?gauss()*noise:0);
 let best={s:sc(),seq:[]};
 const a1s=normal?sample(E.actions(run),K1):E.actions(run);
 for(const a1 of a1s){const r1=E.doAction(run,a1);if(!r1.ok)continue;const s1=sc();if(s1>best.s)best={s:s1,seq:[a1]};
  const a2s=normal?sample(E.actions(run),K2):E.actions(run);for(const a2 of a2s){const r2=E.doAction(run,a2);if(!r2.ok)continue;const s2=sc();if(s2>best.s)best={s:s2,seq:[a1,a2]};E.undo(run);}
  E.undo(run);}
 if(b.edits.length)throw new Error('undo left edits');
 for(const a of best.seq){const r=E.doAction(run,a);if(!r.ok)throw new Error('replay failed '+JSON.stringify(a)+' '+r.why);}
 ST.strokesUsed+=best.seq.length;ST.turnsPlayed++;
 for(const a of best.seq)if(a.pen&&a.pen!=='pencil')ST.penUse[a.pen]=(ST.penUse[a.pen]||0)+1;}

/* ---------- ボット: 道中 ---------- */
const PV={samurai:4,sumo:4,hoken:3,ninja:5,neko:3,yumi:5,yuki:6,kappa:6,tengu:6,kaminari:6,nurikabe:6,daruma:5,iinchou:6,tanuki:5,oni:9,hanabi:7,momo:8};
const pval=p=>PV[p.k]+2.2*(p.lv-1);
const isGuard=k=>E.PIECES[k].def[0]>=4;
function bestReplace(run,k){let bi=-1,bv=1e9;const guards=run.pieces.filter(p=>isGuard(p.k)).length;
 run.pieces.forEach((p,i)=>{if(isGuard(p.k)&&!isGuard(k)&&guards<=2)return;const v=pval(p);if(v<bv){bv=v;bi=i;}});return{i:bi,gain:bi<0?-9:PV[k]-bv};}
function bestTrain(run){let bi=-1,bv=-1;run.pieces.forEach((p,i)=>{if(p.lv<3&&PV[p.k]>bv){bv=PV[p.k];bi=i;}});return bi;}
const SV={taisou:6,renraku:5,uwabaki:5,nafuda:5,toban:5,cap:4,shitajiki:4,sharpen:5,yobi:4,akamaru:2,randoseru:3,hanamaru:3,hata:2,origami:2,janken:3,korogashi:5,marubatsu:3,acchimuite:5,daruma_s:3,sekigae:2,domino:4,otoshi:4,fukuwarai:3,kakurenbo:4};
const PENV={hl:4,brush:4,red:4,ball:3,ruler:3,tape:2};
function botReward(run){const R=run.reward;
 if(R.opts.length&&!R.took){let best=-1,bv=1.5,arg=-1;
  R.opts.forEach((o,i)=>{let v=-9,a=-1;
   if(o.t==='piece'){const r=bestReplace(run,o.k);v=r.gain;a=r.i;}
   else if(o.t==='train'){a=bestTrain(run);v=a>=0?3:-9;}
   else if(o.t==='pen'){if(run.pens.length<3){v=PENV[o.k];}else{let wi=0;run.pens.forEach((p,j)=>{if(PENV[p]<PENV[run.pens[wi]])wi=j;});v=PENV[o.k]-PENV[run.pens[wi]];a=wi;}}
   if(BOT==='normal')v+=gauss()*1.5;
   if(v>bv){bv=v;best=i;arg=a;}});
  if(!E.takeReward(run,best,arg))E.takeReward(run,-1);
  if(best>=0)ST.rewardPick[R.opts[best].t==='piece'?R.opts[best].k:R.opts[best].t]=(ST.rewardPick[R.opts[best].t==='piece'?R.opts[best].k:R.opts[best].t]||0)+1;}
 if(run.reward&&run.reward.stickers&&!run.reward.stickerTook){const ks=run.reward.stickers;let bi=0;ks.forEach((k,i)=>{if((SV[k]||0)>(SV[ks[bi]]||0))bi=i;});E.takeSticker(run,ks.length?bi:-1);}
 if(run.reward&&!run.reward.opts.length&&run.reward.stickerTook)throw new Error('reward stuck');}
function botShop(run){const S=run.shop;ST.shops++;
 const want=[];S.items.forEach((it,i)=>{let v=0,arg=-1;
  if(it.t==='bread')v=run.hp<run.maxHp*0.55?6:run.hp<run.maxHp-10?1:-9;
  else if(it.t==='sticker')v=SV[it.k]||0;
  else if(it.t==='piece'){const r=bestReplace(run,it.k);v=r.gain;arg=r.i;}
  else if(it.t==='pen'){v=run.pens.length<3?PENV[it.k]-1:-9;}
  else if(it.t==='train'){arg=bestTrain(run);v=arg>=0?3:-9;}
  if(v>=2.5)want.push({i,v:v/Math.max(20,it.price),arg});});
 want.sort((a,b)=>b.v-a.v);for(const w of want){if(E.buy(run,w.i,w.arg))ST.bought[S.items[w.i].t]=(ST.bought[S.items[w.i].t]||0)+1;}
 run.phase='map';run.shop=null;}
function botRest(run){if(run.hp<run.maxHp*0.7||bestTrain(run)<0){E.rest(run,'heal');ST.restHeal++;}else{E.rest(run,'train',bestTrain(run));ST.restTrain++;}}
function botEvent(run){const ev=run.ev,D=E.EVENTS[ev.k];let i=0;
 const lowHp=run.hp<run.maxHp*0.5;
 if(ev.k==='okawari')i=0;else if(ev.k==='otoshimono')i=lowHp?0:1;else if(ev.k==='usagi')i=lowHp?0:1;else if(ev.k==='rika')i=lowHp?1:0;else if(ev.k==='nicchoku')i=run.money>=10?1:0;else if(ev.k==='test')i=lowHp?1:0;else if(ev.k==='zukou')i=0;else if(ev.k==='housou')i=0;else if(ev.k==='hanaichi')i=1;else if(ev.k==='sekigae')i=0;
 if(BOT==='normal'&&Math.random()<0.3)i=1-i;
 const o=D.o[i];let arg=-1;if(o.need==='piece'){arg=bestTrain(run);if(arg<0){i=1-i;}}
 if(!E.chooseEvent(run,i,arg))E.chooseEvent(run,1-i,bestTrain(run));E.eventDone(run);}
const NV=(run,t)=>{const hpf=run.hp/run.maxHp;return t==='battle'?1:t==='elite'?(hpf>0.65?2.2:-3):t==='shop'?(run.money>=45?2:0.3):t==='rest'?(hpf<0.6?3.5:1.6):t==='event'?1.2:t==='treasure'?2.6:0;};
function pathValue(run,m,start,fromLvl){const cols=E.routePath(m,start);let v=0;for(let l=Math.max(0,fromLvl);l<E.LEVELS;l++)v+=NV(run,m.nodes[l][cols[l]]);return v;}
function botMap(run){const m=run.map;
 if(m.lvl===-1){let bc=0,bv=-1e9;for(let c=0;c<E.COLS;c++){const v=pathValue(run,m,c,0)+(BOT==='normal'?gauss()*1.5:0);if(v>bv){bv=v;bc=c;}}
  tryPencil(run,bc,0);E.chooseStart(run,bc);return;}
 tryPencil(run,null,m.lvl+1);E.advance(run);}
function tryPencil(run,start,fromLvl){const m=run.map;if(m.pencil<1||BOT==='normal')return;
 const cur=()=>{if(start!=null)return pathValue(run,m,start,0);const cols=pathFrom(m);let v=0;for(let l=fromLvl;l<E.LEVELS;l++)v+=NV(run,m.nodes[l][cols[l]]);return v;};
 const base=cur();let best=null,bv=base+1.5;
 for(let r=0;r<E.ROUTE_ROWS;r++)for(let a=0;a<E.COLS-1;a++){if(!E.routeCanPut(m,r,a))continue;m.rungs.push({r,a,b:a+1});const v=cur();m.rungs.pop();if(v>bv){bv=v;best={r,a};}}
 if(best){E.routePencil(run,best.r,best.a);ST.routePencil++;}}
function pathFrom(m){const cols=[];let c=m.col;for(let l=m.lvl;l<E.LEVELS;l++){cols[l]=c;if(l<E.ROUTE_ROWS)c=E.routeNext(m,l,c);}return cols;}

/* ---------- 1ラン ---------- */
const ST={runs:0,clears:0,reach:[0,0,0,0],deaths:{},battleTurns:{normal:[],elite:[],boss:[]},hpLoss:{},errors:0,errMsg:{},stalls:0,strokesUsed:0,turnsPlayed:0,penUse:{},rewardPick:{},bought:{},shops:0,restHeal:0,restTrain:0,routePencil:0,money:[],times:[],gk:{},maxHit:0,winsVs:{},fightsVs:{}};
function runOnce(seed,gk){const run=E.newRun(seed,gk);
 if(process.env.STICKERS){const ks=process.env.STICKERS==='all'?Object.keys(E.STICKERS):process.env.STICKERS.split(',');for(const k of ks)E.addSticker(run,k);}
 if(process.env.PENS)run.pens=process.env.PENS.split(',').slice(0,3);
 if(process.env.LINEUP)process.env.LINEUP.split(',').forEach((k,i)=>{if(E.PIECES[k]&&i<5)run.pieces[i]={k,lv:1};});
 let steps=0,nodes=0,turns=0;const t0=Date.now();
 while(steps++<4000){check(run,'step '+steps+' '+run.phase);
  if(run.phase==='map'){botMap(run);nodes++;}
  else if(run.phase==='chapter'){E.chapterGo(run);if(process.env.ONLYCH)break;}
  else if(run.phase==='battle'){const b=run.b;const ch=run.ch;
   if(b.turn===1&&!b._seen){b._seen=1;b._hp0=run.hp;b._key=b.en.map(e=>e.k).sort().join('+');ST.fightsVs[b._key]=(ST.fightsVs[b._key]||0)+1;
    if(process.env.FILL){for(;;){const fp=E.freePositions(b);if(!fp.length)break;const p=fp[0];E.addRung(b,{r:p.r,a:p.a,b:p.a+1,k:'ink'});}}}
   botTurn(run);const kind=b.kind,hp0=b._hp0,key=b._key;E.commit(run);turns++;check(run,'after commit');
   if(b.turn>60){ST.stalls++;throw new Error('battle stalled vs '+key);}
   if(b.over){ST.battleTurns[kind].push(b.turn);const k2=ch+':'+kind;(ST.hpLoss[k2]=ST.hpLoss[k2]||[]).push(hp0-run.hp);
    if(run.phase==='over'){ST.deaths[key]=(ST.deaths[key]||0)+1;}else ST.winsVs[key]=(ST.winsVs[key]||0)+1;
    log(`  ${['1章','2章','3章'][ch]} ${kind} vs ${key}: ${b.turn}ターン HP${run.hp}/${run.maxHp}`);}}
  else if(run.phase==='reward')botReward(run);
  else if(run.phase==='shop')botShop(run);
  else if(run.phase==='rest'){botRest(run);nodes++;}
  else if(run.phase==='event'){botEvent(run);}
  else if(run.phase==='over'||run.phase==='clear')break;
  else throw new Error('unknown phase '+run.phase);}
 if(steps>=4000)throw new Error('run did not finish');
 ST.runs++;ST.reach[run.phase==='clear'?3:run.ch]++;if(run.phase==='clear')ST.clears++;
 ST.money.push(run.money);ST.maxHit=Math.max(ST.maxHit,run.stats.maxHit);
 // 1ターン10秒、道中1マス20秒で見積もる
 ST.times.push((turns*10+nodes*20)/60);
 log(`run ${seed}: ${run.phase} ch${run.ch+1} 駒 ${run.pieces.map(p=>p.k+p.lv).join(' ')} シール ${run.stickers.join(',')} ペン ${run.pens.join(',')}`);
 return run;}

const gks=GK==='all'?Object.keys(E.GAKKYU):[GK];
for(const gk of gks){
 for(let i=0;i<N;i++){const seed=SEED0+i*7919+gks.indexOf(gk)*104729;
  try{const r=runOnce(seed,gk);(ST.gk[gk]=ST.gk[gk]||{n:0,c:0}).n++;if(r.phase==='clear')ST.gk[gk].c++;}
  catch(e){ST.errors++;const m=e.message.split('\n')[0];ST.errMsg[m]=(ST.errMsg[m]||0)+1;if(ST.errors<=3)console.log('ERROR seed',seed,e.stack.split('\n').slice(0,4).join(' | '));}}}
const avg=a=>a.length?(a.reduce((s,x)=>s+x,0)/a.length):0;
const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'-';
console.log(`一線打尽 v${E.VERSION}  ボット=${BOT}  ${ST.runs}ラン  学級=${gks.join(',')}`);
console.log(`クリア率 ${pct(ST.clears,ST.runs)}  到達: 1章で終わり ${ST.reach[0]} / 2章 ${ST.reach[1]} / 3章 ${ST.reach[2]} / クリア ${ST.reach[3]}`);
for(const g in ST.gk)console.log(`  ${g}: ${pct(ST.gk[g].c,ST.gk[g].n)}`);
console.log(`エラー ${ST.errors}  詰み(長引き) ${ST.stalls}`);for(const m in ST.errMsg)console.log('  ',ST.errMsg[m],'×',m);
console.log(`1戦闘のターン数: ふつう ${avg(ST.battleTurns.normal).toFixed(1)} / 強敵 ${avg(ST.battleTurns.elite).toFixed(1)} / ボス ${avg(ST.battleTurns.boss).toFixed(1)}`);
console.log('1戦闘で減るHP(平均):',Object.keys(ST.hpLoss).sort().map(k=>`${k} ${avg(ST.hpLoss[k]).toFixed(1)}`).join(' / '));
console.log(`1回の長さの見積もり: ${avg(ST.times).toFixed(1)}分  1ターンの筆 ${(ST.strokesUsed/Math.max(1,ST.turnsPlayed)).toFixed(2)}本  最大の一撃 ${ST.maxHit}`);
console.log('ペンを使った回数:',JSON.stringify(ST.penUse),' 道中の鉛筆:',ST.routePencil);
console.log('ボス: '+['kokuban','chourei','nanatsume'].map(k=>`${E.ENEMIES[k].n} 勝率${pct(ST.winsVs[k]||0,ST.fightsVs[k]||0)}(${ST.fightsVs[k]||0}戦)`).join(' / '));
console.log('負けた相手(上位):',Object.entries(ST.deaths).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k} ${v}(${pct(v,ST.fightsVs[k])})`).join(' / '));
console.log('ごほうびで選んだもの:',Object.entries(ST.rewardPick).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+v).join(' / '));
console.log('購買部で買ったもの:',JSON.stringify(ST.bought),' 保健室: 回復',ST.restHeal,'特訓',ST.restTrain);
