/* ==========================================================================
   3d-grond.js — het rekenwerk onder de 3D-wereld

   Hier staat alleen rekenwerk op lange rijen getallen: hoe hoog het land is,
   hoe het water het heeft uitgesleten, waar het bos staat, welke kleur elk
   stukje grond krijgt. Geen three.js en geen DOM, zodat het in een Web
   Worker kan draaien: de pagina blijft dan tijdens het bouwen gewoon
   reageren, en het zware werk wordt per strook rijen over een paar workers
   tegelijk verdeeld (zie de rekenploeg in 3d.js). Kan de browser geen
   module-workers maken, dan draait precies dezelfde code op de hoofddraad,
   in dezelfde stroken. Dezelfde stroken, dus ook op de laatste decimaal
   dezelfde uitkomst — met hoeveel workers dan ook.

   De ruisfuncties komen als broncode uit index.html mee (drieContext() daar),
   zodat ze maar op één plek staan en de bergen in 3D precies staan waar de
   kaart ze tekent.

   Het rooster
     Het raster loopt MARGE kaarteenheden voorbij de kaart door, aan alle
     kanten. Daar ligt de oceaan, die naar buiten toe afloopt tot de volle
     diepte — de diepte van het water dat tot aan de horizon doorloopt — en
     land dat tegen de kaartrand ligt loopt er nog een stukje door en eindigt
     in een eigen, grillige kust. Zo is nergens te zien waar de kaart ophoudt.
     Kaartcoördinaat wx hoort bij rasterkolom x via wx = x/RES - MARGE.
   ========================================================================== */

export const MARGE=56;
/* ---- maten ----
   SCHAAL is de hoogte van de hoogste top (reliëf 1) in kaarteenheden. Dat is
   ver boven de echte verhouding — echte bergen zijn op deze schaal nauwelijks
   een rimpel — maar precies genoeg om een gebergte als gebergte te lezen. */
export const SCHAAL=30, ZEEDIEPTE=7;
export const LAND0=.05, ZEE0=.05;        /* land net boven, zeebodem net onder de waterlijn */
/* Van reliëf naar hoogte. Niet recht evenredig: laag land blijft laag, en
   pas wat echt hoog is schiet omhoog. */
export const Yvan=h=>h>=0?LAND0+h*(.5+.5*h)*SCHAAL:-ZEE0+h*ZEEDIEPTE;
/* Hoe hoog het bladerdak boven de grond uitkomt, in kaarteenheden. Even
   overdreven als de rest: een boom zo groot als een dorpshuis. */
export const KRUIN=.05;
/* één meter in kaarteenheden (zie M en K in 3d-modellen.js) */
export const METER=.0015;

/* Van het reliëf op de kaart naar de hoogte in 3D.
   De platte kaart gebruikt RELIEF (vlak .2, heuvels .5, hoogland .7, bergen 1)
   als maat voor hoe sterk de schaduw het land laat golven, en daar is
   heuvelland de helft van een gebergte. Als echte hoogte klopt dat niet:
   heuvels van Araluen zijn hooguit een paar honderd meter, een gebergte is
   duizenden meters. Dus hier een eigen, veel steilere omrekening: vlak land
   en heuvels blijven laag en glooiend, hoogland komt ertussenin, en alleen
   een echt gebergte krijgt toppen. De tussenwaarden (waar het reliëf van
   twee buurlanden in elkaar overloopt) lopen gewoon mee langs de lijn. */
const AMP3=[[.2,.055],[.5,.15],[.7,.24],[1,.62]];
function amp3(a){
  if(a<=AMP3[0][0])return AMP3[0][1];
  for(let i=1;i<AMP3.length;i++){
    const [a1,v1]=AMP3[i];
    if(a<=a1){ const [a0,v0]=AMP3[i-1]; return v0+(v1-v0)*(a-a0)/(a1-a0); }
  }
  return AMP3[AMP3.length-1][1];
}
/* welke begroeiing bos is: [hoe dicht, hoeveel loof (de rest is naald)] */
const BOS={loofbos:[1,1],naaldbos:[1,0],jungle:[1,1],moeras:[.22,1]};

const klem=(v,a,b)=>v<a?a:v>b?b:v;
const glad=t=>t*t*(3-2*t);

/* ---- de ruisfuncties uit index.html, opnieuw opgebouwd uit hun broncode ---- */
let laatsteBron=null, laatsteT=null;
export function rekenregels(bron){
  if(bron===laatsteBron)return laatsteT;
  laatsteBron=bron;
  laatsteT=new Function(bron+"\nreturn {hash2,ruis,fbm,landruis,veeg,afstandTotKeten,BERGKETENS};")();
  return laatsteT;
}

/* ---- het rooster ---- */
export function rooster(W,H,RES){
  const GW=W+2*MARGE, GH=H+2*MARGE;
  const RW=Math.round(GW*RES), RH=Math.round(GH*RES);
  return {W,H,RES,M:MARGE,GW,GH,RW,RH,N:RW*RH,PW:GW,PH:GH};
}
/* De rijen die een strook van het fijne raster nodig heeft van het grove
   (één punt per eenheid) rooster: de rijen eromheen, voor het aflezen tussen
   vier punten in. */
export function groveRijen(R,y0,y1){
  return [Math.max(0,Math.floor(y0/R.RES)-2),Math.min(R.PH,Math.ceil(y1/R.RES)+2)];
}
/* een veld van het grove rooster aflezen tussen de vier omliggende punten;
   o is waar het stuk begint als het maar een strook is */
export function leesVeld(f,o,R,wx,wy){
  const PW=R.PW;
  let ix=Math.floor(wx+R.M-.5), iy=Math.floor(wy+R.M-.5);
  if(ix<0)ix=0; else if(ix>PW-2)ix=PW-2;
  if(iy<0)iy=0; else if(iy>R.PH-2)iy=R.PH-2;
  let tx=wx+R.M-.5-ix, ty=wy+R.M-.5-iy; tx=klem(tx,0,1); ty=klem(ty,0,1);
  const a=iy*PW+ix-o;
  return f[a]*(1-tx)*(1-ty)+f[a+1]*tx*(1-ty)+f[a+PW]*(1-tx)*ty+f[a+PW+1]*tx*ty;
}
/* hoe ver een punt buiten de kaart ligt (0 erbinnen) */
const buitenKaart=(R,wx,wy)=>Math.hypot(Math.max(0,-wx,wx-R.W),Math.max(0,-wy,wy-R.H));

/* Exacte afstand (Felzenszwalb) tot het dichtstbijzijnde punt waar bron[p]==0,
   in kaarteenheden. Zelfde methode als in bouwGrond(). */
export function afstandVeld(bron,RW,RH,res){
  const VER=1e20, mx=Math.max(RW,RH), N=RW*RH, uit=new Float32Array(N);
  for(let p=0;p<N;p++)uit[p]=bron[p]?VER:0;
  const f=new Float64Array(mx), dd=new Float64Array(mx), v=new Int32Array(mx), z=new Float64Array(mx+1);
  const langs=n=>{
    let k=0; v[0]=0; z[0]=-VER; z[1]=VER;
    for(let q=1;q<n;q++){
      let s;
      for(;;){ s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]); if(s<=z[k])k--; else break; }
      k++; v[k]=q; z[k]=s; z[k+1]=VER;
    }
    k=0;
    for(let q=0;q<n;q++){ while(z[k+1]<q)k++; dd[q]=(q-v[k])*(q-v[k])+f[v[k]]; }
  };
  for(let x=0;x<RW;x++){ for(let y=0;y<RH;y++)f[y]=uit[y*RW+x]; langs(RH); for(let y=0;y<RH;y++)uit[y*RW+x]=dd[y]; }
  for(let y=0;y<RH;y++){ const o=y*RW; for(let x=0;x<RW;x++)f[x]=uit[o+x]; langs(RW); for(let x=0;x<RW;x++)uit[o+x]=Math.sqrt(dd[x])/res; }
  return uit;
}

/* ---- land dat tegen de kaartrand ligt ----
   Op de kaart houdt Arrida op bij de onderrand, maar de wereld natuurlijk
   niet. Voorbij de rand loopt het land daarom nog een stuk door, en het
   versmalt daarbij geleidelijk tot een kaap met een eigen, grillige kust.
   Per zijde wordt gekeken hoeveel van de rand in de buurt land is, over een
   venster dat breder wordt naarmate je verder buiten de kaart komt; hoe
   verder buiten, hoe meer land er in dat venster moet liggen. Een smalle
   punt die de rand net raakt loopt zo een paar eenheden door en rondt af, een
   brede kust gaat er een flink eind voorbij. Het land krijgt het gebied (en
   dus het terrein) van het stuk rand waar het uit voortkomt. */
function verlengRand(R,land,reg,T){
  const {RW,RES,M,W,H}=R;
  const cx0=Math.round(M*RES), cx1=Math.round((M+W)*RES), cy0=Math.round(M*RES), cy1=Math.round((M+H)*RES);
  const VER=M*.4;              /* zo ver loopt land hooguit door: daarna is er nog ruimte voor de diepte */
  const zijden=[
    {n:cx1-cx0, rand:i=>cy0*RW+cx0+i,     punten:(f)=>{ for(let y=0;y<cy0;y++)for(let x=cx0;x<cx1;x++)f(x,y,x-cx0,(cy0-y)/RES); }},
    {n:cx1-cx0, rand:i=>(cy1-1)*RW+cx0+i, punten:(f)=>{ for(let y=cy1;y<R.RH;y++)for(let x=cx0;x<cx1;x++)f(x,y,x-cx0,(y-cy1+1)/RES); }},
    {n:cy1-cy0, rand:i=>(cy0+i)*RW+cx0,   punten:(f)=>{ for(let y=cy0;y<cy1;y++)for(let x=0;x<cx0;x++)f(x,y,y-cy0,(cx0-x)/RES); }},
    {n:cy1-cy0, rand:i=>(cy0+i)*RW+cx1-1, punten:(f)=>{ for(let y=cy0;y<cy1;y++)for(let x=cx1;x<RW;x++)f(x,y,y-cy0,(x-cx1+1)/RES); }}
  ];
  zijden.forEach((z,zi)=>{
    const som=new Float64Array(z.n+1); let heeft=false;
    for(let i=0;i<z.n;i++){ const l=land[z.rand(i)]?1:0; if(l)heeft=true; som[i+1]=som[i]+l; }
    if(!heeft)return;
    z.punten((x,y,s,d)=>{
      const w=Math.round((1+.7*d)*RES), a=Math.max(0,s-w), b=Math.min(z.n,s+w+1);
      const deel=(som[b]-som[a])/(b-a);
      if(deel<.3)return;
      const wx=x/RES-M, wy=y/RES-M;
      const ver=VER*(.4+.6*T.fbm(s/RES*.035+zi*37.1,zi*11.3,2,0));
      const drempel=.45+.55*d/ver+.16*(T.fbm(wx*.11,wy*.11,3,.2)-.5);
      if(deel<=drempel)return;
      /* het gebied van het dichtstbijzijnde stukje land op de rand */
      let r=0;
      for(let k=0;k<=w&&!r;k++){
        if(s-k>=0&&land[z.rand(s-k)])r=reg[z.rand(s-k)];
        else if(s+k<z.n&&land[z.rand(s+k)])r=reg[z.rand(s+k)];
      }
      if(!r)return;
      const p=y*RW+x; land[p]=1; reg[p]=r;
    });
  });
}

/* ======================= taak 1: voorbereiding =======================
   Alles wat over het hele veld in één keer moet: het land voorbij de rand,
   de terreinvelden op het grove rooster, de afstand tot de kust, en de plek
   voor de namen van de landen. */
function voorbereiding(G,T){
  const R=G.R, {RW,RH,RES,PW,PH,M}=R, MM=PW*PH;
  const {land,reg,info,SOORTEN,vlekken}=G;
  verlengRand(R,land,reg,T);
  const kloven=sluitKloven(R,land,reg,G.plekken||[]);
  /* het grove rooster volgt het fijne waar de kaart ophoudt; binnen de kaart
     komt het uit zijn eigen tekening (zoals op de platte kaart) */
  const pReg=G.pReg, pdReg=G.pdReg;
  for(let j=0;j<PH;j++)for(let i=0;i<PW;i++){
    if(i>=M&&i<M+R.W&&j>=M&&j<M+R.H)continue;
    const p=Math.min(RH-1,Math.floor((j+.5)*RES))*RW+Math.min(RW-1,Math.floor((i+.5)*RES));
    pReg[j*PW+i]=land[p]?reg[p]:0; pdReg[j*PW+i]=land[p]?reg[p]:0;
  }

  /* --- terreinvelden op een grof rooster, zacht over de grenzen heen ---
     Precies zoals in bouwGrond(); kleur komt later (die hangt van het thema af),
     hier alleen wat er groeit en hoe hoog en grillig het wordt. */
  const fAmp=new Float32Array(MM), fRug=new Float32Array(MM), fKoud=new Float32Array(MM);
  const fBos=new Float32Array(MM), fLoof=new Float32Array(MM);
  const mixA=new Uint8Array(MM), mixB=new Uint8Array(MM), mixF=new Float32Array(MM);
  fAmp.fill(.4); fRug.fill(.3); fLoof.fill(.5);
  const gras=SOORTEN.indexOf("grasland"); mixA.fill(gras); mixB.fill(gras);
  for(let j=0;j<PH;j++)for(let i=0;i<PW;i++){
    const p=j*PW+i, g=info[pReg[p]]; if(!g)continue;
    const x=i-M, y=j-M;
    fAmp[p]=g.amp; fRug[p]=g.rug; fKoud[p]=g.koud;
    let a=g.soorten[0], b=a, mf=0;
    if(g.soorten.length>1){
      /* de fijnheid van deze ruis hangt in bouwGrond van fFijn af; dat veld
         is hier nog niet klaar, dus een middenwaarde — het gaat alleen om
         waar het ene landschap in het andere overgaat */
      const n=T.landruis(x,y,1.4,.011,1,0)*(g.soorten.length-1);
      const i0=Math.min(g.soorten.length-2,Math.floor(n));
      mf=glad(klem((n-i0-.28)/.44,0,1)); a=g.soorten[i0]; b=g.soorten[i0+1];
    }
    mixA[p]=SOORTEN.indexOf(a); mixB[p]=SOORTEN.indexOf(b); mixF[p]=mf;
    const ba=BOS[a]||[0,.5], bb=BOS[b]||[0,.5];
    fBos[p]=ba[0]+(bb[0]-ba[0])*mf; fLoof[p]=ba[1]+(bb[1]-ba[1])*mf;
  }
  /* De platte kaart laat het reliëf over dertig eenheden in het buurland
     overlopen. Voor de schaduw is dat mooi, maar als hoogte smeert het een
     klein gebergte als de Bergen van Nacht en Ontij uit tot een paar
     heuveltjes: hier dus een kortere overgang voor de hoogte. */
  T.veeg(fAmp,PW,PH,7); T.veeg(fRug,PW,PH,30); T.veeg(fKoud,PW,PH,30);
  T.veeg(fBos,PW,PH,6); T.veeg(fLoof,PW,PH,6);
  /* Kleine bossen tussen de akkers (Araluen, Gallica…): de kaart tekent
     alleen de grote wouden, maar het boerenland heeft overal bosjes van een
     paar honderd meter tot een paar kilometer, meest loofhout. */
  if(G.bosjes)for(let j=0;j<PH;j++)for(let i=0;i<PW;i++){
    const p=j*PW+i, sterk=G.bosjes[pReg[p]]; if(!sterk)continue;
    const x=i-M, y=j-M;
    const n=T.fbm(x*.55+71,y*.55-13,3,.2)*.7+T.ruis(x*1.3-5,y*1.3+17)*.3;
    const w=glad(klem((n-(.68-.05*sterk))/.05,0,1))*sterk;
    if(w>fBos[p]){ fBos[p]=w; fLoof[p]=Math.max(fLoof[p],.8); }
  }
  /* plaatsen met een eigen landschap (het Grimsdell Woud enzovoort) */
  for(const v of vlekken){
    const ba=BOS[v.soort]||[0,.5];
    for(let y=Math.max(-M,Math.floor(v.y-v.rr));y<=Math.min(PH-1-M,Math.ceil(v.y+v.rr));y++)
      for(let x=Math.max(-M,Math.floor(v.x-v.rr));x<=Math.min(PW-1-M,Math.ceil(v.x+v.rr));x++){
        const p=(y+M)*PW+x+M; if(!pReg[p])continue;
        const golf=v.r*(.72+.56*T.ruis(x*.10+91,y*.10-53));
        const w=glad(klem(1-Math.hypot(x-v.x,y-v.y)/golf,0,1)); if(w<=0)continue;
        fBos[p]+=(ba[0]-fBos[p])*w; if(ba[0])fLoof[p]+=(ba[1]-fLoof[p])*w;
      }
  }

  return {land,reg,pReg,pdReg,fAmp,fRug,fKoud,fBos,fLoof,mixA,mixB,mixF,kloven};
}

/* ======================= taak 1b: de afstanden =======================
   Drie afstandsvelden over het hele raster, elk in een eigen worker
   tegelijk: tot de kust (vanaf het land), tot het land (vanaf zee), en tot
   de eigen grens — voor de plek van de namen van de landen. */
function afstand(G,T){
  const R=G.R, {RW,RH,RES,N,M}=R, {land,reg}=G;
  if(G.soort==="kust"){
    const kustAfst=afstandVeld(land,RW,RH,RES);
    /* hoe breed het binnenland van elk gebied is */
    const dmax=new Float32Array(256);
    for(let p=0;p<N;p++)if(land[p]&&kustAfst[p]>dmax[reg[p]])dmax[reg[p]]=kustAfst[p];
    return {kustAfst,dmax};
  }
  if(G.soort==="zee"){
    const zee=new Uint8Array(N); for(let p=0;p<N;p++)zee[p]=land[p]?0:1;
    return {zeeAfst:afstandVeld(zee,RW,RH,RES)};
  }
  /* De namen van de landen: op het punt dat het verst van de eigen grenzen
     ligt — gemeten tot zee én tot elk ander land, anders wint een gemengd
     randje op een landsgrens. */
  const pool={}, binnen=new Uint8Array(N);
  for(let y=1;y<RH-1;y++)for(let x=1;x<RW-1;x++){
    const p=y*RW+x, r=reg[p];
    binnen[p]=land[p]&&land[p-1]&&land[p+1]&&land[p-RW]&&land[p+RW]
      &&reg[p-1]===r&&reg[p+1]===r&&reg[p-RW]===r&&reg[p+RW]===r?1:0;
  }
  const dg=afstandVeld(binnen,RW,RH,RES);
  for(let p=0;p<N;p++)if(binnen[p]){
    const r=reg[p], o=pool[r];
    if(!o||dg[p]>o.d)pool[r]={d:dg[p],x:(p%RW)/RES-M,y:Math.floor(p/RW)/RES-M};
  }
  return {pool};
}
/* de aanloop van de kust en de fijnheid van de ruis, naar de maat van elk land */
export function kustVelden(R,dmax,pdReg,T){
  const {PW,PH}=R, MM=PW*PH, fKust=new Float32Array(MM), fFijn=new Float32Array(MM);
  for(let p=0;p<MM;p++){ const d=dmax[pdReg[p]]||30; fKust[p]=klem(d*.55,5,26); fFijn[p]=klem(48/Math.max(8,d),.75,2.6); }
  T.veeg(fKust,PW,PH,22); T.veeg(fFijn,PW,PH,22);
  return {fKust,fFijn};
}

/* ---- een kloof ----
   De Spleet, de kloof tussen Araluen en Morgaraths hoogvlakte, is op de
   kaart een haarfijne kier tussen twee landvormen: één rasterpunt zee. In 3D
   werd dat een laag dal met een draadje water erin, want naast zee loopt het
   land af. Daarom wordt zo'n kier hier eerst land (dan loopt het land er
   gewoon overheen), en slijt afwerking() er daarna een smalle, diepe kloof in.
   Alleen rond een plaats die erom vraagt (kloof in 3d-modellen.js), zodat een
   echte smalle zee-engte nergens dichtgaat. */
function sluitKloven(R,land,reg,plekken){
  const {RW,RH,RES,M}=R, uit=[];
  for(const pl of plekken){
    if(!pl.kloof)continue;
    const r=pl.kloof.r, x0=Math.max(2,Math.floor((pl.x+M-r)*RES)), x1=Math.min(RW-3,Math.ceil((pl.x+M+r)*RES));
    const y0=Math.max(2,Math.floor((pl.y+M-r)*RES)), y1=Math.min(RH-3,Math.ceil((pl.y+M+r)*RES));
    const w=Math.max(2,Math.round(RES)), dicht=[];
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p=y*RW+x; if(land[p])continue;
      let zee=0,n=0;
      for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){ n++; if(!land[p+dy*RW+dx])zee++; }
      if(zee/n<.4)dicht.push(p);
    }
    const pts=[];
    for(const p of dicht){
      /* het gebied van een buurpunt op het land */
      let r0=0; for(const d of [-1,1,-RW,RW,-2,2,-2*RW,2*RW])if(land[p+d]&&reg[p+d]){ r0=reg[p+d]; break; }
      land[p]=1; reg[p]=r0||reg[p];
      pts.push((p%RW)/RES-M,Math.floor(p/RW)/RES-M);
    }
    uit.push({x:pl.x,y:pl.y,breed:pl.kloof.breed,pts});
  }
  return uit;
}

/* ======================= taak 2: de hoogte, per strook =======================
   Voor elk punt van de strook: hoe ver van de kust, welk reliëf, de ruis, de
   bergketen. Elk punt staat op zichzelf, dus de stroken kunnen tegelijk.

   Het land loopt vanaf de kust geleidelijk op, zoals echt land: eerst een
   lage kuststrook, dan heuvels, en pas waar het reliëf echt bergen zegt
   gaan de toppen omhoog. De aanloop groeit mee met de maat van het land (op
   een klein eiland is hij korter), maar de hoogte daarachter komt uit AMP3 en
   niet uit de breedte van het land: Araluen mag smal zijn, het wordt er niet
   steiler van. */
function hoogte(G,T){
  const R=G.R, {RW,RES,M}=R, {y0,y1}=G;
  const n=(y1-y0)*RW, o=y0*RW, go=G.go;
  const h=new Float32Array(n), kust=new Uint8Array(n);
  const {land,rivier,kustAfst,zeeAfst,fAmp,fRug,fKust,fFijn}=G;
  /* de bergketen doet verder dan zijn uitloop niets meer: dan hoeft hij ook niet gemeten */
  const doos=[1e9,1e9,-1e9,-1e9];
  for(const k of T.BERGKETENS)for(const [x,y,r] of k.punten){
    doos[0]=Math.min(doos[0],x-r); doos[1]=Math.min(doos[1],y-r);
    doos[2]=Math.max(doos[2],x+r); doos[3]=Math.max(doos[3],y+r);
  }
  const PW=R.PW, PH=R.PH, MR=M-.5;
  for(let y=y0;y<y1;y++){
    const wy=y/RES-M;
    let iy=Math.floor(wy+MR); if(iy<0)iy=0; else if(iy>PH-2)iy=PH-2;
    const ty=klem(wy+MR-iy,0,1);
    for(let x=0;x<RW;x++){
      const p=y*RW+x, q=p-o, wx=x/RES-M;
      if(!land[q]){
        /* zeebodem: een flauwe plaat langs de kust, daarna dieper; en voorbij
           de kaart naar buiten toe de volle diepte, die van de oceaan */
        const d=zeeAfst[q];
        let v=-(1-Math.exp(-d/13))*(.86+.28*T.ruis(wx*.05+7,wy*.05-3));
        const b=buitenKaart(R,wx,wy);
        if(b>M*.55)v+=(-1-v)*glad(klem((b-M*.55)/(M*.4),0,1));
        h[q]=v;
        continue;
      }
      let ix=Math.floor(wx+MR); if(ix<0)ix=0; else if(ix>PW-2)ix=PW-2;
      const tx=klem(wx+MR-ix,0,1);
      const a=iy*PW+ix-go, w0=(1-tx)*(1-ty), w1=tx*(1-ty), w2=(1-tx)*ty, w3=tx*ty;
      const tus=f=>f[a]*w0+f[a+1]*w1+f[a+PW]*w2+f[a+PW+1]*w3;
      const dk=kustAfst[q], fK=tus(fKust);
      const k=glad(Math.min(1,dk/fK));
      kust[q]=Math.min(255,dk*18);
      const nr=T.landruis(wx,wy,tus(fFijn),.026,6,tus(fRug));
      const basis=k*amp3(tus(fAmp))*(.24+.76*nr);
      const dK=(wx<doos[0]-90||wx>doos[2]+90||wy<doos[1]-90||wy>doos[3]+90)?999:T.afstandTotKeten(wx,wy);
      const kr=klem(1-dK/70,0,1), kT=kr*kr*kr*(10-15*kr+6*kr*kr);
      const kH=kT>0?kT*(.42+.55*T.fbm(wx*.048,wy*.048,4,.55)):0;
      /* Op de platte kaart mag de bergketen tot in zee doorlopen; in 3D wordt
         dat een muur. De laatste eenheden lopen daarom altijd af: klif, geen
         wand. Op een smal stuk land (de Bergen van Nacht en Ontij, Celtica) is
         die afloop korter, anders blijft er van het gebergte niets over. */
      const afloop=glad(Math.min(1,dk/Math.min(12,fK*1.1)));
      let v=Math.min(1,basis+(kH-basis)*kT)*afloop;
      /* een rivier slijt een smalle geul uit */
      if(rivier[q])v=Math.max(0,v-rivier[q]/255*Math.min(.012,v*.5));
      h[q]=v;
    }
  }
  return {h,kust};
}

/* ======================= taak 3: afwerking =======================
   Over het hele veld: erosie, egaliseren onder kastelen en dorpen, de
   landsgrenzen, het bos, en de normalen voor de belichting. */
function afwerking(G,T){
  const R=G.R, {RW,RH,RES,N,M}=R;
  const {h,land,rivier,reg,kust,plekken}=G;
  erodeer(R,h,land);
  /* Een klif (Zeeklif, de kliffen onder het gebergte): het land loopt hier
     niet geleidelijk op vanaf het strand, maar staat meteen als een wand uit
     het water op, met een golvend plateau erboven. De wand komt vanzelf: het
     eerste rasterpunt op het land ligt al hoog, het eerste in zee laag. kust
     is de afstand tot de waterlijn (×18), dus hier is ook te zien hoe ver
     landinwaarts een punt ligt. Rond de rand van het gebied loopt het klif
     terug in het gewone land, zodat er geen trede in het landschap staat. */
  for(const pl of plekken){
    if(!pl.klif)continue;
    const {r,hoogte}=pl.klif, cx=pl.x, cy=pl.y;
    /* de hoogte (0..1) die hoort bij een wand van hoogte eenheden boven zee */
    const hVan=y=>{ const a=(y-LAND0)/SCHAAL; return -.5+Math.sqrt(.25+2*a); };
    for(let y=Math.max(0,Math.floor((cy+M-r)*RES));y<=Math.min(RH-1,Math.ceil((cy+M+r)*RES));y++)
      for(let x=Math.max(0,Math.floor((cx+M-r)*RES));x<=Math.min(RW-1,Math.ceil((cx+M+r)*RES));x++){
        const q=y*RW+x; if(!land[q])continue;
        const wx=x/RES-M, wy=y/RES-M, d=Math.hypot(wx-cx,wy-cy)/r;
        const w=1-glad(klem((d-.6)/.4,0,1)); if(w<=0)continue;
        const dk=kust[q]/18;
        /* de wand: binnen een paar tienden van een eenheid op volle hoogte */
        const wand=glad(klem((dk-.04)/.32,0,1));
        /* het plateau loopt landinwaarts nog wat op, en golft */
        const plat=.8+.2*glad(klem(dk/2.2,0,1))+.12*(T.fbm(wx*.6+3,wy*.6-8,3,.3)-.5);
        const doel=hVan(LAND0+hoogte*plat)*wand;
        if(doel>h[q])h[q]+=(doel-h[q])*w;
      }
  }
  /* Een hoogvlakte (Morgaraths Hoogvlakte): binnen de straal wordt het land
     een vlak plateau op één hoogte, met nog maar een zweem van wat er lag;
     de rand breekt steil af (de Noordelijke kliffen), en daarachter liggen
     de bergen gewoon door. De rand golft, zodat het geen cirkel wordt. */
  for(const pl of plekken){
    if(!pl.plateau)continue;
    const {r,hoogte}=pl.plateau, cx=pl.x+(pl.plateau.dx||0), cy=pl.y+(pl.plateau.dy||0), R2=r*1.15;
    for(let y=Math.max(0,Math.floor((cy+M-R2)*RES));y<=Math.min(RH-1,Math.ceil((cy+M+R2)*RES));y++)
      for(let x=Math.max(0,Math.floor((cx+M-R2)*RES));x<=Math.min(RW-1,Math.ceil((cx+M+R2)*RES));x++){
        const q=y*RW+x; if(!land[q])continue;
        const wx=x/RES-M, wy=y/RES-M;
        const rand=r*(.85+.25*T.fbm(wx*.12+5,wy*.12-9,3,.3));
        const d=Math.hypot(wx-cx,wy-cy);
        const w=1-glad(klem((d-rand)/(r*.08),0,1)); if(w<=0)continue;
        const vlak=hoogte*(1+.08*(T.fbm(wx*.35-3,wy*.35+8,3,.2)-.5));
        /* het plateau komt niet hoger dan de bergen eromheen het toelaten:
           waar het land al hoger lag, blijft er een rotsige rand staan */
        h[q]=h[q]>vlak*1.25?h[q]*(1-w*.5)+vlak*w*.5:h[q]+(vlak-h[q])*w;
      }
    /* en eromheen een gebergte: kale kammen (ruis met omgeklapte dalen), die
       naar de kust toe aflopen in de kliffen */
    const bg=pl.plateau.bergen; if(!bg)continue;
    for(let y=Math.max(0,Math.floor((cy+M-bg.r)*RES));y<=Math.min(RH-1,Math.ceil((cy+M+bg.r)*RES));y++)
      for(let x=Math.max(0,Math.floor((cx+M-bg.r)*RES));x<=Math.min(RW-1,Math.ceil((cx+M+bg.r)*RES));x++){
        const q=y*RW+x; if(!land[q])continue;
        const wx=x/RES-M, wy=y/RES-M, d=Math.hypot(wx-cx,wy-cy);
        const rand=r*(.85+.25*T.fbm(wx*.12+5,wy*.12-9,3,.3));
        /* niet aan de noordkant: daar breekt het plateau naar Araluen af */
        const wz=glad(klem((wy-cy+1.5)/3.5,0,1));
        const wr=glad(klem((d-rand-.6)/2.5,0,1))*(1-glad(klem((d-bg.r*.8)/(bg.r*.2),0,1)))*wz;
        if(wr<=0)continue;
        const wk=glad(klem((kust[q]/18)/3.5,0,1));
        const f=T.fbm(wx*.16+31,wy*.16-17,4,.5), kam=1-Math.abs(2*f-1);
        const m=bg.hoogte*(.35+.65*kam*kam)*wr*wk;
        if(m>h[q])h[q]=m;
      }
  }
  /* de kloven: steile wanden, een bodem net boven zee */
  for(const k of G.kloven||[]){
    if(!k.pts.length)continue;
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(let i=0;i<k.pts.length;i+=2){ x0=Math.min(x0,k.pts[i]); x1=Math.max(x1,k.pts[i]); y0=Math.min(y0,k.pts[i+1]); y1=Math.max(y1,k.pts[i+1]); }
    const B=k.breed*2.2;
    for(let y=Math.max(0,Math.floor((y0+M-B)*RES));y<=Math.min(RH-1,Math.ceil((y1+M+B)*RES));y++)
      for(let x=Math.max(0,Math.floor((x0+M-B)*RES));x<=Math.min(RW-1,Math.ceil((x1+M+B)*RES));x++){
        const q=y*RW+x; if(!land[q])continue;
        const wx=x/RES-M, wy=y/RES-M;
        let d=1e9; for(let i=0;i<k.pts.length;i+=2){ const dx=wx-k.pts[i], dy=wy-k.pts[i+1]; const dd=dx*dx+dy*dy; if(dd<d)d=dd; }
        d=Math.sqrt(d);
        const t=klem(1-(d-k.breed*.35)/(k.breed*1.3),0,1), w=t*t*(3-2*t);
        h[q]=h[q]*(1-w)+.001*w;
      }
  }
  /* Een kasteel staat niet scheef op een helling: de grond eronder is
     geëgaliseerd, en loopt daarbuiten zacht over in het land eromheen.
     Dorpen krijgen hetzelfde, iets minder streng. */
  for(const pl of plekken){
    if(!pl.vlak)continue;
    const [R0,R1,kracht]=pl.vlak, cx=pl.x, cy=pl.y;
    const x0=Math.max(0,Math.floor((cx+M-R1)*RES)), x1=Math.min(RW-1,Math.ceil((cx+M+R1)*RES));
    const y0=Math.max(0,Math.floor((cy+M-R1)*RES)), y1=Math.min(RH-1,Math.ceil((cy+M+R1)*RES));
    let s=0,n=0;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const q=y*RW+x; if(land[q]&&Math.hypot(x/RES-M-cx,y/RES-M-cy)<R0){s+=h[q];n++;}
    }
    if(!n)continue;
    /* een plaats aan zee: het vlak komt niet lager dan het land er al
       lag, anders zakt de kust onder water */
    const doel=s/n;
    const nooitLager=Math.max(doel,0);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const q=y*RW+x; if(!land[q])continue;
      const d=Math.hypot(x/RES-M-cx,y/RES-M-cy); if(d>=R1)continue;
      const w=d<R0?1:1-glad((d-R0)/(R1-R0));
      const nh=h[q]+(doel-h[q])*w*kracht;
      h[q]=doel<.02?Math.max(nh,Math.min(h[q],nooitLager+.02)):nh;
    }
  }
  /* Een bergmeer (Mizu Umi Bakudai): een kom in het land, met de waterspiegel
     op de hoogte van de laagste oever — dan loopt het nergens over. De oever
     golft een beetje, zodat het geen cirkel wordt. */
  const meren=[];
  for(const pl of plekken){
    if(!pl.meer)continue;
    const r=pl.meer.r, cx=pl.x, cy=pl.y;
    const lees=(wx,wy)=>{ const x=Math.round((wx+M)*RES), y=Math.round((wy+M)*RES); return h[klem(y,0,RH-1)*RW+klem(x,0,RW-1)]; };
    let L=1;
    for(let i=0;i<96;i++){ const a=i/96*Math.PI*2; for(const f of [.8,.9,1])L=Math.min(L,lees(cx+Math.cos(a)*r*f,cy+Math.sin(a)*r*f)); }
    L=Math.max(L,.004);
    /* binnen de oever de kom; daarbuiten loopt het land eerst zacht op, zodat
       het meer in een dal ligt en niet in een put */
    const R2=r*1.7;
    for(let y=Math.max(0,Math.floor((cy+M-R2)*RES));y<=Math.min(RH-1,Math.ceil((cy+M+R2)*RES));y++)
      for(let x=Math.max(0,Math.floor((cx+M-R2)*RES));x<=Math.min(RW-1,Math.ceil((cx+M+R2)*RES));x++){
        const q=y*RW+x, wx=x/RES-M, wy=y/RES-M;
        const oever=r*(.8+.18*T.fbm(wx*.35+11,wy*.35-7,3,0));
        const d=Math.hypot(wx-cx,wy-cy)/oever;
        if(d<1)h[q]=Math.min(h[q],Math.max(.002,L-pl.meer.diepte*(1-d*d)-.0015));
        else if(h[q]>L){ const t=klem((d-1)/((R2/oever)-1),0,1); h[q]=L+.002+(h[q]-L-.002)*t*t*(3-2*t); }
      }
    meren.push({x:cx,y:cy,r,niveau:Yvan(L)});
  }
  const grens=new Uint8Array(N);
  for(let y=1;y<RH-1;y++)for(let x=1;x<RW-1;x++){
    const p=y*RW+x; if(!land[p])continue; const r0=reg[p];
    if((land[p-1]&&reg[p-1]!==r0)||(land[p+1]&&reg[p+1]!==r0)||(land[p-RW]&&reg[p-RW]!==r0)||(land[p+RW]&&reg[p+RW]!==r0))grens[p]=1;
  }
  /* wat hier binnenkwam gaat ook weer terug: in een worker is het overgedragen */
  return {h,grens,land,rivier,reg,kust,meren};
}

/* ---- erosie ----
   Ruis geeft bergen als verfrommeld papier: overal even veel bultjes. Echte
   bergen zijn door water gevormd — scherpe kammen, geulen die samenkomen tot
   dalen, en in het dal een vlakke bodem van wat er naar beneden spoelde. Dit
   bootst dat na: duizenden druppels vallen op het hoogland, rollen bergaf,
   nemen materiaal mee waar ze snel gaan en laten het vallen waar ze afremmen.
   (Naar het bekende recept van Hans Theobald Beyer en Sebastian Lague.)

   Het gebeurt op een grover rooster van één punt per kaarteenheid, alleen
   op hoogland en bergen; het verschil wordt daarna over het fijne raster
   gelegd. De druppels krijgen vaste startplekken, zodat de bergen bij elke
   keer laden precies hetzelfde zijn. */
function erodeer(R,h,land){
  const {RW,RH,RES}=R, EW=R.GW, EH=R.GH, E=new Float32Array(EW*EH);
  for(let y=0;y<EH;y++)for(let x=0;x<EW;x++){
    const p=Math.min(RH-1,Math.round((y+.5)*RES))*RW+Math.min(RW-1,Math.round((x+.5)*RES));
    E[y*EW+x]=land[p]?h[p]:-.05;
  }
  const voor=E.slice();
  /* de borstel waarmee een druppel uitslijt: een schijfje van straal 2 */
  const B=2, bo=[], bw=[];
  let som=0;
  for(let dy=-B;dy<=B;dy++)for(let dx=-B;dx<=B;dx++){
    const d=Math.hypot(dx,dy); if(d>B)continue;
    bo.push(dy*EW+dx); bw.push(B-d); som+=B-d;
  }
  for(let i=0;i<bw.length;i++)bw[i]/=som;
  const TRAAG=.05, DRAAG=4, MINDRAAG=.01, SLIJT=.3, LEG=.3, DAMP=.012, ZWAARTE=4, LEVEN=34;
  /* startplekken: alleen waar het land hoog genoeg is om te slijten */
  const starts=[];
  for(let y=B+1;y<EH-B-1;y++)for(let x=B+1;x<EW-B-1;x++)if(E[y*EW+x]>.1)starts.push(y*EW+x);
  const druppels=Math.min(260000,Math.round(starts.length*2.2));
  let zaad=12345;
  const toeval=()=>{ zaad=(Math.imul(zaad,1664525)+1013904223)>>>0; return zaad/4294967296; };
  for(let it=0;it<druppels;it++){
    const s=starts[Math.floor(toeval()*starts.length)];
    let px=s%EW+toeval(), py=Math.floor(s/EW)+toeval();
    let dx=0, dy=0, snel=1, water=1, last=0;
    for(let l=0;l<LEVEN;l++){
      const nx=px|0, ny=py|0, i=ny*EW+nx, fx=px-nx, fy=py-ny;
      const a=E[i], b=E[i+1], c=E[i+EW], d=E[i+EW+1];
      const gx=(b-a)*(1-fy)+(d-c)*fy, gy=(c-a)*(1-fx)+(d-b)*fx;
      const hoog=a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy;
      dx=dx*TRAAG-gx*(1-TRAAG); dy=dy*TRAAG-gy*(1-TRAAG);
      const len=Math.hypot(dx,dy); if(len<1e-9)break;
      dx/=len; dy/=len; px+=dx; py+=dy;
      if(px<B+1||py<B+1||px>=EW-B-2||py>=EH-B-2)break;
      const mx=px|0, my=py|0, j=my*EW+mx, gx2=px-mx, gy2=py-my;
      const nieuw=E[j]*(1-gx2)*(1-gy2)+E[j+1]*gx2*(1-gy2)+E[j+EW]*(1-gx2)*gy2+E[j+EW+1]*gx2*gy2;
      const dh=nieuw-hoog;
      if(nieuw<.002){ /* de zee in: wat er nog in zit valt hier neer */
        E[i]+=last*.25*(1-fx)*(1-fy); break;
      }
      const draag=Math.max(-dh*snel*water*DRAAG,MINDRAAG);
      if(last>draag||dh>0){
        const neer=dh>0?Math.min(dh,last):(last-draag)*LEG;
        last-=neer;
        E[i]+=neer*(1-fx)*(1-fy); E[i+1]+=neer*fx*(1-fy); E[i+EW]+=neer*(1-fx)*fy; E[i+EW+1]+=neer*fx*fy;
      }else{
        const weg=Math.min((draag-last)*SLIJT,-dh);
        for(let k=0;k<bo.length;k++){
          const n=i+bo[k], w=weg*bw[k], af=E[n]<w?Math.max(0,E[n]):w;
          E[n]-=af; last+=af;
        }
      }
      snel=Math.sqrt(Math.max(0,snel*snel-dh*ZWAARTE));
      water*=1-DAMP;
    }
  }
  /* het verschil, zacht over het fijne raster gelegd */
  for(let p=0;p<E.length;p++)E[p]-=voor[p];
  for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){
    const p=y*RW+x; if(!land[p])continue;
    const fx=Math.min(EW-1.001,Math.max(0,x/RES-.5)), fy=Math.min(EH-1.001,Math.max(0,y/RES-.5));
    const x0=fx|0, y0=fy|0, tx=fx-x0, ty=fy-y0, q=y0*EW+x0;
    const d=E[q]*(1-tx)*(1-ty)+E[q+1]*tx*(1-ty)+E[q+EW]*(1-tx)*ty+E[q+EW+1]*tx*ty;
    if(d!==0)h[p]=Math.max(.0008,h[p]+d);
  }
}

/* ---- het bos ----
   Bos is in 3D geen verzameling losse boompjes maar een dak van kruinen: een
   massa die boven het land uitsteekt, met een bosrand, open plekken, en een
   boomgrens hoger op de berg. Dit veld zegt per punt hoeveel bladerdak er
   staat (0–255); het land in 3D komt daar KRUIN eenheden mee omhoog, en de
   shader tekent er de kruinen in. Waar het ophoudt: langs de kust (strand),
   langs rivieren, op steile rotswanden, boven de boomgrens, en rond kastelen
   en dorpen, die in hun eigen open plek met akkers liggen. */
function bos(G,T){
  const R=G.R, {RW,RH,RES,M}=R, {y0,y1,hr0,hr1}=G, ho=hr0*RW;
  const {h,land,rivier,kust,fBos,plekken}=G, meren=G.meren||[];
  const rijen=hr1-hr0, b=new Uint8Array(rijen*RW);
  /* de open plekken in vakjes van 4 eenheden, zodat elk punt alleen naar
     de plekken in zijn buurt hoeft te kijken */
  const OV=4, openVak=new Map();
  for(const p of plekken){ if(!p.open)continue; const k=Math.floor(p.x/OV)+","+Math.floor(p.y/OV); if(!openVak.has(k))openVak.set(k,[]); openVak.get(k).push(p); }
  const openCache=new Map(), LEEG=[];
  const openBij=(x,y)=>{
    const i0=Math.floor(x/OV), j0=Math.floor(y/OV), sl=i0*100003+j0;
    let uit=openCache.get(sl); if(uit)return uit;
    uit=[]; for(let j=j0-1;j<=j0+1;j++)for(let i=i0-1;i<=i0+1;i++){ const l=openVak.get(i+","+j); if(l)for(const p of l)uit.push(p); }
    if(!uit.length)uit=LEEG; openCache.set(sl,uit); return uit;
  };
  /* het bladerdak voor de strook plus een rij erboven en eronder: die zijn
     nodig voor de normalen aan de rand */
  for(let y=Math.max(1,y0-1,hr0+1);y<Math.min(RH-1,y1+1,hr1-1);y++){
    const wy=y/RES-M;
    for(let x=1;x<RW-1;x++){
      const p=y*RW+x, q=p-ho; if(!land[q]||rivier[q]>30)continue;
      const wx=x/RES-M;
      const bw=leesVeld(fBos,G.go,R,wx,wy); if(bw<.05)continue;
      if(meren.some(m=>Math.hypot(wx-m.x,wy-m.y)<m.r))continue;
      const hh=h[q];
      const gx=(Yvan(h[q+1])-Yvan(h[q-1]))*RES*.5, gz=(Yvan(h[q+RW])-Yvan(h[q-RW]))*RES*.5;
      const steil=Math.sqrt(gx*gx+gz*gz);
      /* open plekken en een rafelige bosrand: twee lagen ruis */
      const c=T.fbm(wx*.19+17,wy*.19-5,3,0)*.75+T.ruis(wx*.9+3,wy*.9+41)*.25;
      let v=bw*(.62+.76*(c-.5)*1.6)*(1-glad(klem((hh-.36)/.26,0,1)))*(1-glad(klem((steil-1.1)/1.2,0,1)));
      v*=klem((kust[q]/18-.35)/.5,0,1);
      if(rivier[q])v*=1-rivier[q]/60;
      /* (een weg door het bos opent het bladerdak niet: een laan van een paar
         meter is smaller dan een rasterpunt, en van boven zie je hem niet) */
      for(const pl of openBij(wx,wy)){
        /* de rand van de open plek loopt over een stuk dat met de plek
           meegroeit: een erf in het bos is een klein rond gat, geen vlek */
        const rand=Math.max(.06,pl.open*.7);
        const dx=wx-pl.x, dy=wy-pl.y; if(dx*dx+dy*dy>(pl.open+rand*1.5)*(pl.open+rand*1.5))continue;
        const d=Math.sqrt(dx*dx+dy*dy)+(T.ruis(wx*5,wy*5)-.5)*rand;
        v*=glad(klem((d-pl.open)/rand,0,1));
      }
      b[q]=glad(klem((v-.30)/.08,0,1))*255;
    }
  }
  /* object-ruimte-normalen uit het hoogteveld, met het bladerdak erbij:
     daarmee is elk rasterpunt scherp belicht, ook waar het 3D-net grover is
     dan het plaatje. In de vierde waarde staat het bos, voor de kruinen in
     de shader. */
  const n=(y1-y0)*RW, normalen=new Uint8Array(n*4), s=2/RES;
  const Y=(q,x,y)=>Yvan(h[q])+(b[q]?dakHoogte(b[q],x/RES-M,y/RES-M,T):0);
  for(let y=y0;y<y1;y++)for(let x=0;x<RW;x++){
    const q=y*RW+x-ho;
    const l=x>0?Y(q-1,x-1,y):Y(q,x,y), r=x<RW-1?Y(q+1,x+1,y):Y(q,x,y);
    const o=y>0?Y(q-RW,x,y-1):Y(q,x,y), d=y<RH-1?Y(q+RW,x,y+1):Y(q,x,y);
    const nx=-(r-l)/s, nz=-(d-o)/s, len=Math.hypot(nx,1,nz), u=(y*RW+x-y0*RW)*4;
    normalen[u]=(nx/len*.5+.5)*255; normalen[u+1]=(1/len*.5+.5)*255; normalen[u+2]=(nz/len*.5+.5)*255; normalen[u+3]=b[q];
  }
  return {bos:b.slice((y0-hr0)*RW,(y1-hr0)*RW),normalen};
}
/* Hoe hoog het bladerdak boven de grond uitkomt (KRUIN, met wat variatie):
   het bos is een massa die boven het land uitsteekt, met een bosrand, open
   plekken en een boomgrens hoger op de berg. Het land in 3D komt daar mee
   omhoog, en de shader tekent er de kruinen in. */
export function dakHoogte(bosWaarde,wx,wy,T){
  if(!bosWaarde)return 0;
  return bosWaarde/255*KRUIN*(.8+.4*T.ruis(wx*.55+5,wy*.55-9));
}

/* ======================= taak 4: de kleur, per strook =======================
   Zelfde opbouw als in bouwGrond(): begroeiing, de tint van het land, rots
   en sneeuw op de hoogte, de korrel van het bos. Daarbij wat de platte kaart
   niet nodig heeft: steile hellingen worden rots, in kommen en geulen valt
   wat minder licht. De strook krijgt aan beide kanten wat rijen extra mee
   (hr): die zijn nodig om de holtes te meten, maar worden niet gekleurd. */
function kleur(G,T){
  const R=G.R, {RW,RES,M}=R, {y0,y1,hr0,hr1,go}=G;
  const {h,land,kust,grens,rivier,bos,fR,fG,fB,fKorrel,fVlek,fKoud,th}=G;
  const ho=hr0*RW, o=y0*RW;
  const uit=new Uint8Array((y1-y0)*RW*4);
  /* holtes en ruggen: verschil tussen de hoogte en een vervaagde hoogte */
  const rijen=hr1-hr0, holte=new Float32Array(rijen*RW);
  {
    const b=h.slice(); T.veeg(b,RW,rijen,Math.round(1.5*RES));
    for(let i=0;i<b.length;i++)holte[i]=(h[i]-b[i])*SCHAAL;
    b.set(h); T.veeg(b,RW,rijen,Math.round(7*RES));
    for(let i=0;i<b.length;i++)holte[i]+=(h[i]-b[i])*SCHAAL*.3;
  }
  const {ROTS,SNEEUW,GRENS,ZAND,RIV,BO,BD}=th;
  const doos=[1e9,1e9,-1e9,-1e9];
  for(const k of T.BERGKETENS)for(const [x,y,r] of k.punten){
    doos[0]=Math.min(doos[0],x-r); doos[1]=Math.min(doos[1],y-r);
    doos[2]=Math.max(doos[2],x+r); doos[3]=Math.max(doos[3],y+r);
  }
  const k=[0,0,0];
  const meng=(doel,t)=>{ k[0]+=(doel[0]-k[0])*t; k[1]+=(doel[1]-k[1])*t; k[2]+=(doel[2]-k[2])*t; };
  for(let y=y0;y<y1;y++){
    const wy=y/RES-M;
    for(let x=0;x<RW;x++){
      const p=y*RW+x, q=p-o, hp=p-ho, u=q*4, wx=x/RES-M, hh=h[hp];
      if(!land[q]){
        /* zeebodem: zand langs de kust, dieper donker en blauwig */
        const t=glad(klem(-hh/.55,0,1));
        const n=.92+.16*T.ruis(wx*.35,wy*.35);
        uit[u]=(BO[0]+(BD[0]-BO[0])*t)*n; uit[u+1]=(BO[1]+(BD[1]-BO[1])*t)*n; uit[u+2]=(BO[2]+(BD[2]-BO[2])*t)*n;
        uit[u+3]=255; continue;
      }
      k[0]=leesVeld(fR,go,R,wx,wy); k[1]=leesVeld(fG,go,R,wx,wy); k[2]=leesVeld(fB,go,R,wx,wy);
      const xl=x>0?hp-1:hp, xr=x<RW-1?hp+1:hp, yo=hp-RW>=0?hp-RW:hp, yb=hp+RW<h.length?hp+RW:hp;
      const gx=(Yvan(h[xr])-Yvan(h[xl]))*RES*.5, gz=(Yvan(h[yb])-Yvan(h[yo]))*RES*.5;
      const helling=Math.sqrt(gx*gx+gz*gz);
      /* rots: hoog in de bergen, en op elke steile wand */
      if(hh>.30)meng(ROTS,Math.min(1,(hh-.30)/.40));
      meng(ROTS,glad(klem((helling-.8)/1.3,0,1))*.8);
      const dK=(wx<doos[0]-40||wx>doos[2]+40||wy<doos[1]-40||wy>doos[3]+40)?999:T.afstandTotKeten(wx,wy);
      const kk=glad(klem(1-dK/30,0,1));
      const koud=Math.max(leesVeld(fKoud,go,R,wx,wy),kk), sg=.90-.6*koud;
      if(hh>sg)meng(SNEEUW,Math.min(1,(hh-sg)/.30)*(1-glad(klem((helling-1.6)/1.6,0,1))*.7));
      /* in een koud land ligt ook op het hoogland sneeuw: in kommen en op
         de noordhellingen, plekkerig, en meer naarmate het hoger is */
      const sneeuwLand=G.fSneeuw?leesVeld(G.fSneeuw,go,R,wx,wy):0;
      if(sneeuwLand>.05&&hh>.015){
        const vlek=T.fbm(wx*.5+19,wy*.5-41,3,.25), luw=klem(-holte[hp]*.8+.5,0,1);
        const t=glad(klem((hh-.012)/.06,0,1))*Math.min(1,sneeuwLand*1.3)*glad(klem((vlek*.7+luw*.5-(.7-.26*sneeuwLand))/.1,0,1));
        meng(SNEEUW,t*(1-glad(klem((helling-1.4)/1.2,0,1))));
      }
      let m=1+(T.fbm(wx*.42,wy*.42,4,0)-.5)*leesVeld(fKorrel,go,R,wx,wy)*1.25
             +(T.ruis(wx*.085+311,wy*.085-127)-.5)*leesVeld(fVlek,go,R,wx,wy);
      /* Bos is van boven een donker dek van kruinen; dat dek staat precies
         waar het bladerdak staat. */
      const bw=bos[q]/255;
      if(bw>0){ m*=1-.5*bw; k[1]+=(k[1]*.08)*bw; k[0]-=k[0]*.1*bw; k[2]-=k[2]*.05*bw; }
      m*=klem(1+holte[hp]*.07,.68,1.14);
      /* zand langs de kust, maar niet boven op een klif */
      if(kust[q]<30){ const t=1-kust[q]/30; meng(ZAND,t*t*.85*(1-glad(klem((hh-.025)/.03,0,1)))); }
      if(grens[q]){ meng(GRENS,.22); }
      let r=k[0]*m, g=k[1]*m, b=k[2]*m, nat=0;
      if(rivier[q]){ const t=rivier[q]/255; r+=(RIV[0]-r)*t; g+=(RIV[1]-g)*t; b+=(RIV[2]-b)*t; nat=t*.9; }
      uit[u]=klem(r,0,255); uit[u+1]=klem(g,0,255); uit[u+2]=klem(b,0,255);
      uit[u+3]=255-nat*255;
    }
  }
  return {kleur:uit};
}


/* ======================= taak 5: nederzettingen en wegen =======================
   Het land tussen de plaatsen op de kaart is niet leeg: daar wonen de mensen
   die de akkers bewerken. Deze taak legt vast waar (en hoe groot) de
   naamloze boerderijen, gehuchten en dorpen liggen, en welke wegen alles met
   elkaar verbinden. Alles uit vast toeval, dus bij elke keer laden
   hetzelfde.

   Waar iemand woont
     Een rooster van vakken van VAKN eenheden, met in elk vak één plek op een
     eigen toevallige positie. Of daar echt iets ligt, hangt af van hoe dicht
     het land bewoond is (per gebied: dicht[], uit het land en zijn begroeiing),
     en van de plek zelf: laag en vlak land, niet in het bos, niet in de
     rivier, niet te dicht bij de zee, en niet vlak bij een plaats van de
     kaart (die heeft zijn eigen dorp al).

   De wegen
     Grote wegen lopen tussen de plaatsen van de kaart en de dorpen, zoals
     echte wegen lopen: van elk punt naar zijn buren, maar niet naar een buur
     waar je via een ander punt even goed komt (de "relatieve buurgraaf").
     Elk stuk weg zoekt over een grof rooster de goedkoopste route: steile
     hellingen, bos en rivieren kosten meer, de zee kan niet, en een weg die
     er al ligt kost minder, zodat wegen samenkomen in plaats van naast
     elkaar te lopen. Gehuchten en boerderijen krijgen een karrespoor naar de
     dichtstbijzijnde weg.

   De uitkomst
     de plekken (x, y, soort, toeval, richting van de straat, gebied), de
     wegen als lijnen en de bruggen. De shader tekent de wegen uit de
     lijnstukken zelf (zie wegLijnen()). */
export const VAKN=2.3;
export const SOORT_PLEK={boerderij:0,gehucht:1,dorp:2};
function nederzettingen(G,T){
  const R=G.R, {RW,RH,RES,M,PW,PH,W,H}=R;
  const {h,land,rivier,reg,fBos,dicht,wegLand,plaatsen,meren}=G;
  const MM=PW*PH;
  /* ---- het grove rooster: een punt per eenheid ---- */
  const fijn=(i,j)=>Math.min(RH-1,Math.floor((j+.5)*RES))*RW+Math.min(RW-1,Math.floor((i+.5)*RES));
  const hc=new Float32Array(MM), op=new Uint8Array(MM), riv=new Uint8Array(MM), rg=new Uint8Array(MM);
  for(let j=0;j<PH;j++)for(let i=0;i<PW;i++){
    const c=j*PW+i, p=fijn(i,j);
    hc[c]=h[p]; op[c]=land[p]; rg[c]=reg[p];
    /* een rivier ergens in de cel */
    let r=0; const x0=Math.floor(i*RES), y0=Math.floor(j*RES);
    for(let y=y0;y<Math.min(RH,y0+RES);y++)for(let x=x0;x<Math.min(RW,x0+RES);x++)if(rivier[y*RW+x]>r)r=rivier[y*RW+x];
    riv[c]=r;
  }
  for(const m of meren||[])for(let j=Math.max(0,Math.floor(m.y+M-m.r));j<=Math.min(PH-1,Math.ceil(m.y+M+m.r));j++)
    for(let i=Math.max(0,Math.floor(m.x+M-m.r));i<=Math.min(PW-1,Math.ceil(m.x+M+m.r));i++)
      if(Math.hypot(i+.5-M-m.x,j+.5-M-m.y)<m.r)op[j*PW+i]=0;
  const helling=new Float32Array(MM);
  for(let j=1;j<PH-1;j++)for(let i=1;i<PW-1;i++){
    const c=j*PW+i; if(!op[c])continue;
    const gx=(Yvan(Math.max(0,hc[c+1]))-Yvan(Math.max(0,hc[c-1])))*.5, gz=(Yvan(Math.max(0,hc[c+PW]))-Yvan(Math.max(0,hc[c-PW])))*.5;
    helling[c]=Math.hypot(gx,gz);
  }
  /* de afstand tot de zee, op het grove rooster (voor de vissersplekken en de kust) */
  const zeeAf=afstandVeld(op,PW,PH,1);
  const grof=(x,y)=>{ const i=Math.floor(x+M), j=Math.floor(y+M); return i<0||j<0||i>=PW||j>=PH?-1:j*PW+i; };

  /* ---- de plekken ---- */
  const plekken=[];
  const nx=Math.ceil(W/VAKN), ny=Math.ceil(H/VAKN);
  const vrijVan=plaatsen.map(p=>[p.x,p.y,p.r]);
  for(let vj=0;vj<ny;vj++)for(let vi=0;vi<nx;vi++){
    const a=T.hash2(vi*7+311,vj*13-77), b=T.hash2(vi*3-41,vj*5+919), k=T.hash2(vi+5,vj*31+3);
    const x=(vi+.15+.7*a)*VAKN, y=(vj+.15+.7*b)*VAKN, c=grof(x,y);
    if(c<0||!op[c])continue;
    const d=dicht[rg[c]]||0; if(d<=0)continue;
    if(hc[c]>.2||helling[c]>.55||riv[c]>40||zeeAf[c]<1.2)continue;
    /* bos: een open plek kan, maar diep in het bos woont bijna niemand */
    const bos=leesVeld(fBos,0,R,x,y);
    let kans=d*(1-.82*klem(bos,0,1))*(hc[c]<.1?1:.65)*(helling[c]<.25?1:.6);
    if(k>kans*.62)continue;
    if(vrijVan.some(([px,py,pr])=>Math.hypot(px-x,py-y)<pr+.9))continue;
    /* hoe groot: de meeste plekken zijn een boerderij, een op de zoveel een dorp */
    const g=T.hash2(vi*17+3,vj*7+101);
    const soort=g<.1*Math.min(1.6,d)?2:g<.42?1:0;
    plekken.push({x,y,soort,zaad:Math.floor(T.hash2(vi,vj)*1e6),r:rg[c],a:T.hash2(vi*5+1,vj*9+2)*Math.PI,weg:wegLand[rg[c]]});
  }

  /* ---- het kostenveld voor de wegen ---- */
  const kost=new Float32Array(MM);
  for(let c=0;c<MM;c++){
    if(!op[c]){ kost[c]=Infinity; continue; }
    const hl=helling[c];
    kost[c]=1+5*hl*hl+1.4*klem(leesVeld(fBos,0,R,(c%PW)+.5-M,Math.floor(c/PW)+.5-M),0,1)+(hc[c]>.3?2:0)+(riv[c]>80?6:0)+(wegLand[rg[c]]?0:2.5);
  }
  const opWeg=new Uint8Array(MM);
  /* A* over het grove rooster, van cel a naar cel b (of naar de eerste cel
     waar al een weg ligt, als b<0), hooguit tot maxR eenheden ver */
  const gk=new Float32Array(MM).fill(Infinity), van=new Int32Array(MM).fill(-1), dicht2=new Uint8Array(MM);
  const aangeraakt=[];
  const hoop=[], hoopK=[];
  const duw=(c,f)=>{ hoop.push(c); hoopK.push(f); let i=hoop.length-1; while(i>0){ const o=(i-1)>>1; if(hoopK[o]<=hoopK[i])break; [hoop[o],hoop[i]]=[hoop[i],hoop[o]]; [hoopK[o],hoopK[i]]=[hoopK[i],hoopK[o]]; i=o; } };
  const pak=()=>{ const top=hoop[0], lc=hoop.pop(), lk=hoopK.pop(); if(hoop.length){ hoop[0]=lc; hoopK[0]=lk; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i; if(l<hoop.length&&hoopK[l]<hoopK[m])m=l; if(r<hoop.length&&hoopK[r]<hoopK[m])m=r; if(m===i)break; [hoop[m],hoop[i]]=[hoop[i],hoop[m]]; [hoopK[m],hoopK[i]]=[hoopK[i],hoopK[m]]; i=m; } } return top; };
  const BUREN=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[-1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,-1,Math.SQRT2]];
  function zoek(a,b,maxR){
    for(const c of aangeraakt){ gk[c]=Infinity; van[c]=-1; dicht2[c]=0; }
    aangeraakt.length=0; hoop.length=0; hoopK.length=0;
    const ai=a%PW, aj=(a/PW)|0, bi=b>=0?b%PW:0, bj=b>=0?(b/PW)|0:0;
    const heur=c=>b<0?0:Math.hypot((c%PW)-bi,((c/PW)|0)-bj)*.45;
    gk[a]=0; aangeraakt.push(a); duw(a,heur(a));
    let n=0;
    while(hoop.length){
      const c=pak(); if(dicht2[c])continue; dicht2[c]=1;
      if(c===b||(b<0&&opWeg[c]&&c!==a))return c;
      if(++n>400000)return -1;
      const ci=c%PW, cj=(c/PW)|0;
      for(const [di,dj,l] of BUREN){
        const ni=ci+di, nj=cj+dj; if(ni<0||nj<0||ni>=PW||nj>=PH)continue;
        if(Math.abs(ni-ai)>maxR||Math.abs(nj-aj)>maxR)continue;
        const q=nj*PW+ni; if(kost[q]===Infinity&&q!==b)continue;
        /* een diagonale stap mag niet langs de zee om de hoek */
        if(di&&dj&&(kost[cj*PW+ni]===Infinity||kost[nj*PW+ci]===Infinity))continue;
        const k=(kost[c]+kost[q])*.5*l*(opWeg[q]?.42:1);
        const ng=gk[c]+k;
        if(ng<gk[q]){ if(gk[q]===Infinity)aangeraakt.push(q); gk[q]=ng; van[q]=c; duw(q,ng+heur(q)); }
      }
    }
    return -1;
  }
  const pad=eind=>{ const uit=[]; for(let c=eind;c>=0;c=van[c])uit.push(c); return uit.reverse(); };
  /* een pad van cellen naar een vloeiende lijn in kaarteenheden */
  const lijn=(cellen,beginXY,eindXY)=>{
    let p=cellen.map(c=>[(c%PW)+.5-M,((c/PW)|0)+.5-M]);
    if(beginXY)p[0]=beginXY; if(eindXY)p[p.length-1]=eindXY;
    /* trappetjes van het rooster eruit: punten op een rechte lijn weg, dan
       twee keer afronden (Chaikin) */
    for(let k=0;k<3;k++){
      if(p.length<3)break;
      const q=[p[0]];
      for(let i=0;i<p.length-1;i++){ const [x0,y0]=p[i],[x1,y1]=p[i+1]; q.push([x0*.75+x1*.25,y0*.75+y1*.25],[x0*.25+x1*.75,y0*.25+y1*.75]); }
      q.push(p[p.length-1]); p=q;
    }
    return p;
  };
  const wegen=[];
  const legWeg=(cellen,breed,beginXY,eindXY)=>{
    if(cellen.length<2)return;
    for(const c of cellen)opWeg[c]=1;
    wegen.push({pts:lijn(cellen,beginXY,eindXY),breed});
  };

  /* ---- de grote wegen: de relatieve buurgraaf over plaatsen en dorpen ---- */
  const knopen=[];
  for(const p of plaatsen)if(p.groot){ const c=grof(p.x,p.y); if(c>=0&&op[c])knopen.push({x:p.x,y:p.y,c,weg:p.weg}); }
  for(const p of plekken)if(p.soort===2&&p.weg){ const c=grof(p.x,p.y); knopen.push({x:p.x,y:p.y,c,weg:1,plek:p}); }
  const randen=[];
  for(let a=0;a<knopen.length;a++)for(let b=a+1;b<knopen.length;b++){
    const A=knopen[a], B=knopen[b];
    if(!A.weg&&!B.weg)continue;
    const d=Math.hypot(A.x-B.x,A.y-B.y); if(d>34)continue;
    let houd=true;
    for(let c=0;c<knopen.length&&houd;c++){
      if(c===a||c===b)continue;
      const C=knopen[c];
      if(Math.max(Math.hypot(A.x-C.x,A.y-C.y),Math.hypot(B.x-C.x,B.y-C.y))<d)houd=false;
    }
    if(houd)randen.push([d,a,b]);
  }
  randen.sort((p,q)=>p[0]-q[0]);
  for(const [d,a,b] of randen){
    const A=knopen[a], B=knopen[b];
    const e=zoek(A.c,B.c,Math.ceil(d*.7+8));
    if(e<0)continue;
    const cellen=pad(e);
    /* een omweg van meer dan het dubbele is geen weg tussen deze twee */
    let L=0; for(let i=1;i<cellen.length;i++){ const c0=cellen[i-1],c1=cellen[i]; L+=Math.hypot((c1%PW)-(c0%PW),((c1/PW)|0)-((c0/PW)|0)); }
    if(L>d*2.2+3)continue;
    legWeg(cellen,5*METER,[A.x,A.y],[B.x,B.y]);
  }
  /* ---- karresporen: van elk gehucht en elke boerderij naar de dichtstbijzijnde weg ---- */
  for(const p of plekken){
    if(!p.weg&&p.soort<2)continue;
    const c=grof(p.x,p.y);
    if(opWeg[c]){ p.a=richtingBij(wegen,p.x,p.y,p.a); continue; }
    const e=zoek(c,-1,p.soort===0?5:8);
    if(e<0)continue;
    const cellen=pad(e);
    if(p.soort===0&&cellen.length>7)continue;
    legWeg(cellen,(p.soort===0?2.6:3.4)*METER,[p.x,p.y],null);
    const pts=wegen[wegen.length-1].pts;
    /* de straat van het gehucht ligt in het verlengde van de weg erheen */
    const q=pts[Math.min(pts.length-1,6)];
    p.a=Math.atan2(q[1]-p.y,q[0]-p.x);
  }
  for(const p of plekken)if(p.soort===2){ const r=richtingBij(wegen,p.x,p.y,null); if(r!=null)p.a=r; }

  /* ---- de bruggen: waar een weg een rivier oversteekt ---- */
  const bruggen=[];
  for(const w of wegen){
    let vorig=false;
    for(let i=1;i<w.pts.length;i++){
      const [x0,y0]=w.pts[i-1],[x1,y1]=w.pts[i], l=Math.hypot(x1-x0,y1-y0), n=Math.max(1,Math.ceil(l/.08));
      for(let k=0;k<n;k++){
        const x=x0+(x1-x0)*k/n, y=y0+(y1-y0)*k/n, fx=Math.round((x+M)*RES), fy=Math.round((y+M)*RES);
        const r=fx>=0&&fy>=0&&fx<RW&&fy<RH?rivier[fy*RW+fx]:0;
        const nu=r>90;
        if(nu&&!vorig&&!bruggen.some(b=>Math.hypot(b[0]-x,b[1]-y)<.8))bruggen.push([x,y,Math.atan2(y1-y0,x1-x0),w.breed]);
        vorig=nu;
      }
    }
  }
  /* ---- de straat van elk gehucht en dorp: een rechte lijn langs zijn richting ---- */
  for(const p of plekken){
    if(p.soort===0)continue;
    const L=(p.soort===2?.42:.26)*.25, c=Math.cos(p.a), s=Math.sin(p.a);
    wegen.push({pts:[[p.x-c*L,p.y-s*L],[p.x+c*L,p.y+s*L]],breed:4*METER,soort:1});
  }
  const uitP=new Float32Array(plekken.length*6);
  plekken.forEach((p,i)=>{ uitP.set([p.x,p.y,p.soort,p.zaad,p.a,p.r],i*6); });
  return {plekken:uitP,wegen:JSON.stringify(wegen.map(w=>({b:w.breed,s:w.soort||0,p:w.pts.map(([x,y])=>[+x.toFixed(3),+y.toFixed(3)])}))),bruggen:new Float32Array(bruggen.flat())};
}
/* de richting van de weg die het dichtst bij (x,y) langs komt */
function richtingBij(wegen,x,y,anders){
  let best=1e9, r=anders;
  for(const w of wegen)for(let i=1;i<w.pts.length;i++){
    const [x0,y0]=w.pts[i-1],[x1,y1]=w.pts[i];
    const d=Math.hypot((x0+x1)/2-x,(y0+y1)/2-y);
    if(d<best){ best=d; r=Math.atan2(y1-y0,x1-x0); }
  }
  return best<1.5?r:anders;
}
export const WEGRAND=.03;
/* De wegen voor de shader: alle lijnstukken (uitgedund waar de weg recht
   loopt), en per cel van een eenheid welke lijnstukken er langs komen. De
   shader rekent dan per beeldpunt de echte afstand tot die paar lijnstukken
   uit — scherp op elke afstand, ook waar een weg veel smaller is dan een
   rasterpunt. Uit: seg (per lijnstuk twee keer vier getallen: x0,y0,x1,y1
   en halve breedte, soort), lijst (de nummers van de lijnstukken per cel,
   achter elkaar) en cel (per cel: begin in de lijst ×32 + aantal). */
export const SEGBREED=2048, LIJSTBREED=4096;
export function wegLijnen(R,wegen){
  const {PW,PH,M}=R;
  /* uitdunnen (Douglas-Peucker): wat binnen een halve meter op de lijn ligt, mag weg */
  const dun=(p,tol)=>{
    if(p.length<3)return p;
    const houd=new Uint8Array(p.length); houd[0]=houd[p.length-1]=1;
    const stap=(a,b)=>{
      let best=-1, bi=-1; const [x0,y0]=p[a],[x1,y1]=p[b], dx=x1-x0, dy=y1-y0, l=Math.hypot(dx,dy)||1e-9;
      for(let i=a+1;i<b;i++){ const d=Math.abs((p[i][0]-x0)*dy-(p[i][1]-y0)*dx)/l; if(d>best){best=d;bi=i;} }
      if(best>tol){ houd[bi]=1; stap(a,bi); stap(bi,b); }
    };
    stap(0,p.length-1);
    return p.filter((_,i)=>houd[i]);
  };
  const segs=[];
  for(const w of wegen){
    const p=dun(w.pts,.003), half=w.breed/2, soort=w.soort||0;
    for(let i=1;i<p.length;i++)segs.push(p[i-1][0],p[i-1][1],p[i][0],p[i][1],half,soort);
  }
  const n=segs.length/6;
  /* per cel de lijnstukken die er (met hun breedte en wat rand) in vallen */
  const perCel=new Map();
  for(let k=0;k<n;k++){
    const o=k*6, x0=segs[o],y0=segs[o+1],x1=segs[o+2],y1=segs[o+3], r=segs[o+4]+.04;
    for(let j=Math.floor(Math.min(y0,y1)-r+M);j<=Math.floor(Math.max(y0,y1)+r+M);j++)
      for(let i=Math.floor(Math.min(x0,x1)-r+M);i<=Math.floor(Math.max(x0,x1)+r+M);i++){
        if(i<0||j<0||i>=PW||j>=PH)continue;
        /* komt het lijnstuk in de buurt van de cel? (vanaf het midden, ruim gemeten) */
        const cx=i+.5-M, cy=j+.5-M;
        const dx=x1-x0, dy=y1-y0, ll=dx*dx+dy*dy||1e-9, t=klem(((cx-x0)*dx+(cy-y0)*dy)/ll,0,1);
        if(Math.hypot(x0+dx*t-cx,y0+dy*t-cy)>r+.7072)continue;
        const c=j*PW+i; let l=perCel.get(c); if(!l)perCel.set(c,l=[]); if(l.length<31)l.push(k);
      }
  }
  let tot=0; for(const l of perCel.values())tot+=l.length;
  const lijst=new Float32Array(Math.max(LIJSTBREED,Math.ceil(tot/LIJSTBREED)*LIJSTBREED));
  const cel=new Float32Array(PW*PH);
  let o=0;
  for(const [c,l] of perCel){ cel[c]=o*32+l.length; for(const k of l)lijst[o++]=k; }
  const rijen=Math.max(1,Math.ceil(n/SEGBREED));
  const seg=new Float32Array(SEGBREED*2*rijen*4);
  for(let k=0;k<n;k++){
    const a=k*6, t=((Math.floor(k/SEGBREED)*SEGBREED*2)+(k%SEGBREED)*2)*4;
    seg[t]=segs[a]; seg[t+1]=segs[a+1]; seg[t+2]=segs[a+2]; seg[t+3]=segs[a+3];
    seg[t+4]=segs[a+4]; seg[t+5]=segs[a+5];
  }
  return {seg,segRijen:rijen,lijst,lijstRijen:lijst.length/LIJSTBREED,cel,n};
}
export const TAKEN={voorbereiding,afstand,hoogte,afwerking,bos,kleur,nederzettingen};

/* ---- als worker ----
   Een bericht is een taak met zijn gegevens; het antwoord gaat terug met de
   rijen als overdraagbare buffers, zodat er niets gekopieerd hoeft. */
function buffers(o){
  const b=[];
  for(const k in o){ const v=o[k]; if(v&&v.buffer instanceof ArrayBuffer&&!b.includes(v.buffer))b.push(v.buffer); }
  return b;
}
if(typeof WorkerGlobalScope!=="undefined"&&self instanceof WorkerGlobalScope){
  self.onmessage=e=>{
    const {nr,taak,G,bron}=e.data;
    try{
      const uit=TAKEN[taak](G,rekenregels(bron));
      self.postMessage({nr,uit},buffers(uit));
    }catch(fout){ self.postMessage({nr,fout:String(fout&&fout.stack||fout)}); }
  };
}
