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
export const KRUIN=.2;

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
  const R=G.R, {RW,RH,RES,N,PW,PH,M}=R, MM=PW*PH;
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
  const fKust=new Float32Array(MM), fFijn=new Float32Array(MM), fBos=new Float32Array(MM), fLoof=new Float32Array(MM);
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

  /* --- afstand tot de kust, aan beide kanten --- */
  const zee=new Uint8Array(N); for(let p=0;p<N;p++)zee[p]=land[p]?0:1;
  const kustAfst=afstandVeld(land,RW,RH,RES);
  const zeeAfst=afstandVeld(zee,RW,RH,RES);
  const dmax=new Float32Array(256);
  for(let p=0;p<N;p++)if(land[p]&&kustAfst[p]>dmax[reg[p]])dmax[reg[p]]=kustAfst[p];
  for(let p=0;p<MM;p++){ const d=dmax[pdReg[p]]||30; fKust[p]=klem(d*.55,5,26); fFijn[p]=klem(48/Math.max(8,d),.75,2.6); }
  T.veeg(fKust,PW,PH,22); T.veeg(fFijn,PW,PH,22);

  /* De namen van de landen: op het punt dat het verst van de eigen grenzen
     ligt — gemeten tot zee én tot elk ander land, anders wint een gemengd
     randje op een landsgrens. */
  const pool={};
  {
    const binnen=zee; binnen.fill(0);
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
  }
  return {land,reg,pReg,pdReg,kustAfst,zeeAfst,fAmp,fRug,fKoud,fKust,fFijn,fBos,fLoof,mixA,mixB,mixF,pool,kloven};
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
    const doel=s/n;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const q=y*RW+x; if(!land[q])continue;
      const d=Math.hypot(x/RES-M-cx,y/RES-M-cy); if(d>=R1)continue;
      const w=d<R0?1:1-glad((d-R0)/(R1-R0));
      h[q]+=(doel-h[q])*w*kracht;
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
  const bos=bosVeld({...G,meren},T);
  const normalen=bouwNormalen(R,h,bos,T);
  /* wat hier binnenkwam gaat ook weer terug: in een worker is het overgedragen */
  return {h,grens,bos,normalen,land,rivier,reg,kust,meren};
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
function bosVeld(G,T){
  const R=G.R, {RW,RH,RES,N,M}=R, {h,land,rivier,kust,fBos,plekken}=G, meren=G.meren||[];
  const bos=new Uint8Array(N);
  const open=plekken.filter(p=>p.open);
  for(let y=1;y<RH-1;y++){
    const wy=y/RES-M;
    for(let x=1;x<RW-1;x++){
      const p=y*RW+x; if(!land[p]||rivier[p]>30)continue;
      const wx=x/RES-M;
      const b=leesVeld(fBos,0,R,wx,wy); if(b<.05)continue;
      if(meren.some(m=>Math.hypot(wx-m.x,wy-m.y)<m.r))continue;
      const hh=h[p];
      const gx=(Yvan(h[p+1])-Yvan(h[p-1]))*RES*.5, gz=(Yvan(h[p+RW])-Yvan(h[p-RW]))*RES*.5;
      const steil=Math.sqrt(gx*gx+gz*gz);
      /* open plekken en een rafelige bosrand: twee lagen ruis */
      const c=T.fbm(wx*.19+17,wy*.19-5,3,0)*.75+T.ruis(wx*.9+3,wy*.9+41)*.25;
      let v=b*(.62+.76*(c-.5)*1.6)*(1-glad(klem((hh-.36)/.26,0,1)))*(1-glad(klem((steil-1.1)/1.2,0,1)));
      v*=klem((kust[p]/18-.35)/.5,0,1);
      if(rivier[p])v*=1-rivier[p]/60;
      for(const pl of open){
        const dx=wx-pl.x, dy=wy-pl.y; if(dx*dx+dy*dy>(pl.open+1.2)*(pl.open+1.2))continue;
        const d=Math.sqrt(dx*dx+dy*dy)+(T.ruis(wx*1.3,wy*1.3)-.5)*.5;
        v*=glad(klem((d-pl.open)/1.0,0,1));
      }
      bos[p]=glad(klem((v-.30)/.08,0,1))*255;
    }
  }
  return bos;
}
/* hoe hoog het bladerdak op dit punt staat, in kaarteenheden */
export function dakHoogte(bosWaarde,wx,wy,T){
  if(!bosWaarde)return 0;
  return bosWaarde/255*KRUIN*(.8+.4*T.ruis(wx*.55+5,wy*.55-9));
}

/* object-ruimte-normalen uit het hoogteveld, met het bladerdak erbij: daarmee
   is elk rasterpunt scherp belicht, ook waar het 3D-net grover is dan het
   plaatje. In de vierde waarde staat het bos, voor de kruinen in de shader. */
function bouwNormalen(R,h,bos,T){
  const {RW,RH,RES,N,M}=R, uit=new Uint8Array(N*4), s=2/RES;
  const Y=(p,x,y)=>Yvan(h[p])+(bos[p]?dakHoogte(bos[p],x/RES-M,y/RES-M,T):0);
  for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){
    const p=y*RW+x;
    const l=x>0?Y(p-1,x-1,y):Y(p,x,y), r=x<RW-1?Y(p+1,x+1,y):Y(p,x,y);
    const o=y>0?Y(p-RW,x,y-1):Y(p,x,y), b=y<RH-1?Y(p+RW,x,y+1):Y(p,x,y);
    const nx=-(r-l)/s, nz=-(b-o)/s, len=Math.hypot(nx,1,nz), q=p*4;
    uit[q]=(nx/len*.5+.5)*255; uit[q+1]=(1/len*.5+.5)*255; uit[q+2]=(nz/len*.5+.5)*255; uit[q+3]=bos[p];
  }
  return uit;
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
      const koud=Math.max(leesVeld(fKoud,go,R,wx,wy),kk), sg=.90-.48*koud;
      if(hh>sg)meng(SNEEUW,Math.min(1,(hh-sg)/.30)*(1-glad(klem((helling-1.6)/1.6,0,1))*.7));
      let m=1+(T.fbm(wx*.42,wy*.42,4,0)-.5)*leesVeld(fKorrel,go,R,wx,wy)*1.25
             +(T.ruis(wx*.085+311,wy*.085-127)-.5)*leesVeld(fVlek,go,R,wx,wy);
      /* Bos is van boven een donker dek van kruinen; dat dek staat precies
         waar het bladerdak staat. */
      const bw=bos[q]/255;
      if(bw>0){ m*=1-.40*bw; k[1]+=(k[1]*.10)*bw; k[0]-=k[0]*.06*bw; }
      m*=klem(1+holte[hp]*.07,.68,1.14);
      if(kust[q]<30){ const t=1-kust[q]/30; meng(ZAND,t*t*.85); }
      if(grens[q]){ meng(GRENS,.22); }
      let r=k[0]*m, g=k[1]*m, b=k[2]*m, nat=0;
      if(rivier[q]){ const t=rivier[q]/255; r+=(RIV[0]-r)*t; g+=(RIV[1]-g)*t; b+=(RIV[2]-b)*t; nat=t*.9; }
      uit[u]=klem(r,0,255); uit[u+1]=klem(g,0,255); uit[u+2]=klem(b,0,255);
      uit[u+3]=255-nat*255;
    }
  }
  return {kleur:uit};
}

export const TAKEN={voorbereiding,hoogte,afwerking,kleur};

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
