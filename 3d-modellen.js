/* ==========================================================================
   3d-modellen.js — wat er gebouwd staat: kastelen, steden, havens, ruïnes

   Elke plaats op de kaart krijgt hier een eigen model, zo goed als de boeken
   het beschrijven: Redmont van rode steen boven Wensley, Kasteel Araluen met
   slanke witte torens en tuinen, Hallasholm met zijn houten Grote Zaal en een
   strand vol wolfschepen, de zwarte burcht Montsombre met de kooien langs de
   weg, de woestijnsteden van Arrida, de burchten van Nihon-Ja. Daarnaast
   bouwt bouwGehucht() de naamloze gehuchten en boerderijen die het land
   tussen de plaatsen bewoond maken (zie de nederzettingen in 3d.js).

   Opbouw
     BOUWERS     plaats-id → een functie die de plaats bouwt. Bovenaan elke
                 bouwer staat wat de boeken (en data.json) erover zeggen.
     SOORTEN     de standaard per soort, voor alles wat geen eigen bouwer heeft.
     STIJLEN     per land: muren, daken, de vorm van een huis, het soort kasteel
                 en het soort schip — elk met zijn materiaal.
     de bouwdoos de onderdelen waarmee alles gebouwd wordt: blok, toren met
                 borstwering, muur met weergang en kantelen, zadeldak met
                 gevels, poortgebouw, huis, dorp met straten, schip, vlag…

   Maat
     Alles is in meters gedacht en met M omgerekend naar kaarteenheden. Eén
     maat voor de hele wereld, zodat de verhoudingen kloppen: een huis is een
     tiende van een kasteel, een kantelen zo groot als een man, een wolfschip
     korter dan de Grote Zaal. Alleen het geheel is groter dan echt (een
     kasteel van negentig meter is op deze kaart geen stip maar een burcht),
     de onderdelen onderling niet.

   Materiaal
     Elk onderdeel heeft een materiaal (MAT: steen, breuksteen, pleister,
     vakwerk, hout, riet, pannen, lei, plaggen, leem, marmer, papier, aarde).
     Dat gaat per hoekpunt mee, met de plek op het vlak (langs de muur, de
     hoogte erop) en de hoogte boven de grond. De shader (GEBOUW_GLSL) tekent
     daarmee de lagen steen, de balken, de pannen, de ramen — en 's nachts het
     licht erachter. Van ver vallen die patronen weg in hun gemiddelde kleur,
     zodat er niets flikkert. Zo kost een hele wereld vol gebouwen nog altijd
     maar een handvol tekenopdrachten, zonder één plaatje.

   Coördinaten: elke bouwer werkt in een eigen vlak rond zijn plaats, (u,v) in
   kaarteenheden, gedraaid zoals de plaats het wil; b.w(u,v) geeft de plek op
   de kaart. Hoogtes zijn absolute wereldhoogtes (y), zoals yOp() ze geeft.
   ========================================================================== */
import * as THREE from "three";
import {dorpPlan,havenPlan,METER} from "./3d-grond.js";

const klem=(v,a,b)=>v<a?a:v>b?b:v;
/* Eén meter in de maten van de modellen. De bouwers rekenen in die maat; elk
   model wordt daarna met K verkleind rond zijn eigen midden (horizontaal
   rond de plaats, verticaal rond de grond daar) tot zijn echte grootte op de
   kaart. Een meter op de kaart is dus M·K kaarteenheden (METER in
   3d-grond.js): één kaarteenheid is zo'n 650 meter, en Redmont ligt een
   kleine kilometer van Wensley en een dag rijden van Kasteel Araluen. */
export const M=.006, K=.25;
const M_=M;

/* ======================= materialen =======================
   Het nummer gaat per hoekpunt naar de shader; de shader hieronder zegt wat
   elk nummer tekent. */
export const MAT={vlak:0,steen:1,breuk:2,pleister:3,vakwerk:4,hout:5,riet:6,pannen:7,lei:8,plag:9,leem:10,marmer:11,papier:12,aarde:13,kassei:14,schindel:15};

/* ======================= de bouwdoos: vormen =======================
   Eenheidsvormen, met de voet op y=0 en het midden op x=z=0. Zonder index,
   zodat ze los aan elkaar geregen kunnen worden. Elke vorm weet wat voor
   vorm hij is (doos, rond, dak, vlak): daarmee wordt de plek op het vlak
   berekend waar de shader zijn patroon op legt. De onderkant van een doos of
   dak ziet niemand; die gaat er meteen af. */
function sjabloon(g,vorm,metBodem=false){
  g=g.index?g.toNonIndexed():g;
  if(g.getAttribute("uv"))g.deleteAttribute("uv");
  g.computeVertexNormals();
  let p=g.getAttribute("position").array, n=g.getAttribute("normal").array;
  if(!metBodem&&(vorm==="doos"||vorm==="dak")){
    const P=[],Nn=[];
    for(let i=0;i<p.length;i+=9){
      if(n[i+1]<-.9&&n[i+4]<-.9&&n[i+7]<-.9)continue;
      for(let k=0;k<9;k++){ P.push(p[i+k]); Nn.push(n[i+k]); }
    }
    p=new Float32Array(P); n=new Float32Array(Nn);
  }
  return {p,n,vorm};
}
/* Een veelvlak uit punten en vlakken, met de vlakken naar buiten gedraaid
   (gezien vanaf de as door het midden). Zo hoeft niemand per driehoek na te
   denken over de draairichting. */
function naarBuiten(pos){
  let my=0; for(let i=1;i<pos.length;i+=3)my+=pos[i]; my/=pos.length/3;
  for(let i=0;i<pos.length;i+=9){
    const ax=pos[i],ay=pos[i+1],az=pos[i+2], bx=pos[i+3],by=pos[i+4],bz=pos[i+5], cx=pos[i+6],cy=pos[i+7],cz=pos[i+8];
    const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const mx=(ax+bx+cx)/3, mY=(ay+by+cy)/3-my, mz=(az+bz+cz)/3;
    /* plat vlak op de as (boven of onder): kijk naar de hoogte */
    const buiten=Math.abs(mx)+Math.abs(mz)<1e-6?mY*ny:mx*nx+mY*ny*.0001+mz*nz;
    if(buiten<0){ for(let k=0;k<3;k++){ const t=pos[i+3+k]; pos[i+3+k]=pos[i+6+k]; pos[i+6+k]=t; } }
  }
  return pos;
}
function veelvlak(punten,vlakken){
  const pos=[];
  for(const v of vlakken)for(let i=1;i<v.length-1;i++)pos.push(...punten[v[0]],...punten[v[i]],...punten[v[i+1]]);
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(naarBuiten(pos),3));
  return g;
}
/* een vorm uit ringen van rechthoeken, van onder naar boven:
   [halve breedte, halve diepte, hoogte, hoeveel de hoeken extra opkrullen] */
function loft(ringen,dicht=true){
  const pos=[];
  const hoek=(r,k)=>{ const [hx,hz,y,krul]=r, sx=k===0||k===3?-1:1, sz=k<2?-1:1; return [sx*hx,y+(krul||0),sz*hz]; };
  for(let i=0;i<ringen.length-1;i++){
    for(let k=0;k<4;k++){
      const a=hoek(ringen[i],k), b=hoek(ringen[i],(k+1)%4), c=hoek(ringen[i+1],(k+1)%4), d=hoek(ringen[i+1],k);
      pos.push(...a,...b,...c, ...a,...c,...d);
    }
  }
  if(dicht){ const t=ringen[ringen.length-1], a=hoek(t,0),b=hoek(t,1),c=hoek(t,2),d=hoek(t,3); pos.push(...a,...b,...c,...a,...c,...d); }
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(naarBuiten(pos),3));
  return g;
}
/* een draaivorm (koepel, uienkoepel) uit een profiel van [straal, hoogte] */
function draai(profiel,seg=12){
  return new THREE.LatheGeometry(profiel.map(([r,y])=>new THREE.Vector2(r,y)),seg);
}
const V={};
function vormen(){
  if(V.blok)return V;
  V.blok=sjabloon(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),"doos");
  V.cil=sjabloon(new THREE.CylinderGeometry(1,1,1,14,1,true).translate(0,.5,0),"rond");
  V.cilDicht=sjabloon(new THREE.CylinderGeometry(1,1,1,14).translate(0,.5,0),"rond");
  V.cil8=sjabloon(new THREE.CylinderGeometry(1,1,1,8).translate(0,.5,0),"rond");
  V.cil6=sjabloon(new THREE.CylinderGeometry(1,1,1,6).translate(0,.5,0),"rond");
  /* een taps toelopende voet (de schuine plint onder een toren) */
  V.afgeknot=sjabloon(new THREE.CylinderGeometry(.84,1,1,14,1,true).translate(0,.5,0),"rond");
  V.afgeknot4=sjabloon(new THREE.CylinderGeometry(.84*Math.SQRT1_2,Math.SQRT1_2,1,4,1,true).rotateY(Math.PI/4).translate(0,.5,0),"doos");
  V.kegel=sjabloon(new THREE.ConeGeometry(1,1,14,1,true).translate(0,.5,0),"rond");
  V.kegel8=sjabloon(new THREE.ConeGeometry(1,1,8,1,true).translate(0,.5,0),"rond");
  V.kegel6=sjabloon(new THREE.ConeGeometry(1,1,6,1,true).translate(0,.5,0),"rond");
  V.pir=sjabloon(new THREE.ConeGeometry(Math.SQRT1_2,1,4,1,true).rotateY(Math.PI/4).translate(0,.5,0),"dak");
  /* zadeldak: nok langs x op hoogte 1, goten op z=±.5; de gevels zijn de
     driehoeken op x=±.5 (die krijgen het materiaal van de muur) */
  V.zadel=sjabloon(veelvlak([[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5],[-.5,1,0],[.5,1,0]],
    [[0,1,5,4],[3,2,5,4],[0,3,4],[1,2,5],[0,1,2,3]]),"dak");
  /* lessenaarsdak: één helling, hoog aan z=-.5 (tegen een muur aan) */
  V.lessenaar=sjabloon(veelvlak([[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5],[-.5,1,-.5],[.5,1,-.5]],
    [[0,1,5,4],[3,2,5,4],[0,3,4],[1,2,5],[0,1,2,3]]),"dak");
  /* schilddak: nok half zo lang als het huis */
  V.schild=sjabloon(loft([[.5,.5,0],[.25,.001,1]]),"dak");
  /* pagodedak: breed uitlopend, met opkrullende hoeken */
  V.pagode=sjabloon(loft([[.5,.5,0,.09],[.36,.36,.28,.02],[.22,.22,.62],[.12,.005,1]]),"dak");
  V.koepel=sjabloon(new THREE.SphereGeometry(1,14,7,0,Math.PI*2,0,Math.PI/2),"rond");
  V.ui=sjabloon(draai([[0,0],[.78,.08],[1,.32],[.82,.6],[.4,.82],[.1,.95],[.02,1]],12),"rond");
  V.bol=sjabloon(new THREE.IcosahedronGeometry(1,1),"rond");
  V.vlak=sjabloon(new THREE.PlaneGeometry(1,1).translate(.5,.5,0),"vlak");        /* een vlag: van de paal af */
  V.doek=sjabloon(new THREE.PlaneGeometry(1,1).translate(0,.5,0),"vlak");         /* een zeil: om de mast heen */
  V.driehoek=sjabloon((()=>{ const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3)); return g; })(),"vlak");
  V.schijf=sjabloon(new THREE.CircleGeometry(1,16).rotateX(-Math.PI/2),"vlak");
  return V;
}

/* ---- de verzamelbak: alles van één soort materiaal achter elkaar ----
   Per hoekpunt: plek, normaal, kleur, en voor de shader
     aMat  = [materiaal, toeval, verdieping, vloer]  — verdieping is de hoogte
             van een rij ramen (0: geen ramen), vloer de wereldhoogte waar de
             ramen vanaf tellen
     aVlak = [langs, hoog, halve breedte, boven]     — de plek op het vlak in
             kaarteenheden (langs de muur vanaf het midden, de hoogte erop),
             hoe breed het vlak is (ramen blijven uit de hoeken), en hoe hoog
             het punt boven de grond ligt (voor het donker aan de voet) */
class Bak{
  constructor(dobber){ this.p=[]; this.n=[]; this.c=[]; this.m=[]; this.f=[]; this.d=dobber?[]:null; }
  voeg(s,m,nm,kleur,info,dob,boven){
    const P=s.p, Nn=s.n, e=m.elements, f=nm.elements;
    const {sx,sy,sz}=info, vorm=s.vorm;
    const gv=info.gevel;
    for(let i=0;i<P.length;i+=3){
      const lx=P[i], ly=P[i+1], lz=P[i+2], a=Nn[i], b=Nn[i+1], c=Nn[i+2];
      const x=e[0]*lx+e[4]*ly+e[8]*lz+e[12], y=e[1]*lx+e[5]*ly+e[9]*lz+e[13], z=e[2]*lx+e[6]*ly+e[10]*lz+e[14];
      this.p.push(x,y,z);
      let nx=f[0]*a+f[3]*b+f[6]*c, ny=f[1]*a+f[4]*b+f[7]*c, nz=f[2]*a+f[5]*b+f[8]*c;
      const l=Math.hypot(nx,ny,nz)||1; this.n.push(nx/l,ny/l,nz/l);
      /* de gevel van een zadeldak hoort bij de muur */
      const isGevel=gv&&vorm==="dak"&&Math.abs(a)>.85;
      const k=isGevel?gv.kleur:kleur;
      this.c.push(k.r,k.g,k.b);
      let u,v,half;
      if(vorm==="rond"){ u=Math.atan2(lz,lx)*(sx+sz)*.5; v=ly*sy; half=99; }
      else if(vorm==="vlak"){ u=lx*sx; v=ly*sy; half=sx*.5; }
      else if(Math.abs(b)>.9&&vorm==="doos"){ u=lx*sx; v=lz*sz; half=sx*.5; }
      else if(Math.abs(a)>Math.abs(c)){ u=lz*sz; v=ly*sy; half=sz*.5; }
      else { u=lx*sx; v=ly*sy; half=sx*.5; }
      this.m.push(isGevel?gv.mat:info.mat,info.zaad,isGevel?gv.verd||0:info.verd,info.vloer);
      this.f.push(u,v,half,boven(x,y,z));
      if(this.d)this.d.push(dob[0],dob[1],dob[2],dob[3]);
    }
  }
  geo(){
    if(!this.p.length)return null;
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute("normal",new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute("color",new THREE.Float32BufferAttribute(this.c,3));
    g.setAttribute("aMat",new THREE.Float32BufferAttribute(this.m,4));
    g.setAttribute("aVlak",new THREE.Float32BufferAttribute(this.f,4));
    if(this.d)g.setAttribute("aDobber",new THREE.Float32BufferAttribute(this.d,4));
    g.computeBoundingSphere();
    return g;
  }
}

/* ======================= de shader van de materialen =======================
   Voor MeshStandardMaterial (via onBeforeCompile, zie 3d.js). Elk materiaal is
   een patroon op het vlak in echte maten — een laag steen is zo hoog als een
   laag steen, wat de maat van het gebouw ook is. zicht(P) zegt hoe goed een
   patroon met periode P nog te zien is: kleiner dan een paar beeldpunten en
   het gaat over in zijn gemiddelde, net als de kruinen van het bos. */
export const GEBOUW_GLSL_V=`
attribute vec4 aMat; attribute vec4 aVlak;
varying vec4 vMat; varying vec4 vVlak; varying vec3 vNw; varying vec3 vWp;`;
export const GEBOUW_GLSL_V_MAIN=`
vMat=aMat; vVlak=aVlak;
vNw=normalize(mat3(modelMatrix)*objectNormal);
vWp=(modelMatrix*vec4(transformed,1.0)).xyz;`;
export const GEBOUW_GLSL_F=`
varying vec4 vMat; varying vec4 vVlak; varying vec3 vNw; varying vec3 vWp;
uniform float uNacht;
float gHash(vec2 c){
  uvec2 q=uvec2(ivec2(floor(c))+ivec2(32768));
  q=q*uvec2(1597334673U,3812015801U);
  uint n=(q.x^q.y)*1597334673U;
  return float(n)*(1.0/4294967295.0);
}
float gRuis(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gHash(i),gHash(i+vec2(1.0,0.0)),f.x),mix(gHash(i+vec2(0.0,1.0)),gHash(i+vec2(1.0,1.0)),f.x),f.y);
}
float gZicht(float P,float px){ return 1.0-smoothstep(.22,.6,px/P); }
/* een rechthoek in [a,b] (beide assen), met zachte randen ter grootte van een beeldpunt */
float gVak(vec2 f,vec2 a,vec2 b,vec2 aa){
  vec2 s=smoothstep(a-aa,a+aa,f)*(1.0-smoothstep(b-aa,b+aa,f));
  return s.x*s.y;
}
/* lagen blokken (steen, pannen, lei, planken): rij-hoogte h, bloklengte L,
   verspringing; geeft [licht, voeg] */
vec2 gBlokken(vec2 fv,float h,float L,float versp,float zaad,float px,float voegB){
  float rij=floor(fv.y/h); float x=fv.x+fract(rij*versp+zaad*.37)*L;
  vec2 c=vec2(floor(x/L),rij); vec2 f=vec2(fract(x/L),fract(fv.y/h));
  float voeg=min(min(f.x,1.0-f.x)*L,min(f.y,1.0-f.y)*h);
  float v=1.0-smoothstep(voegB*.5,voegB*.5+px*.7,voeg);
  return vec2(gHash(c+zaad*91.0),v);
}`;
/* het patroon zelf: na de kleur uit de hoekpunten (color_fragment) */
export const GEBOUW_GLSL_KLEUR=`
float gId=floor(vMat.x+.5), gZaad=vMat.y, gVerd=vMat.z, gVloer=vMat.w;
vec2 fv=vVlak.xy; float gHalf=vVlak.z, gBoven=vVlak.w;
vec3 gN=normalize(vNw);
float gZij=1.0-smoothstep(.35,.7,abs(gN.y));
float px=max(max(length(dFdx(fv)),length(dFdy(fv))),1e-6);
float hv=(vWp.y-gVloer)*${(1/K).toFixed(4)};
vec3 gK=diffuseColor.rgb; float gL=1.0; float gGloed=0.0;
float gRaamB=.4;        /* hoe breed een raam is, als deel van zijn vak */
if(gId==1.0){           /* steen: gehouwen blokken in lagen */
  vec2 b=gBlokken(fv,.0042,.0095,.5,gZaad,px,.0005);
  float z=gZicht(.0042,px);
  gL=mix(.96,(.9+.2*b.x)*(1.0-.3*b.y),z);
  gRaamB=.16;
}else if(gId==2.0){     /* breuksteen: onregelmatige stenen, donkere voegen */
  vec2 p=fv/.0046, i=floor(p), f=fract(p); float d1=9.0,d2=9.0; vec2 id=vec2(0.0);
  for(int j=-1;j<=1;j++)for(int k=-1;k<=1;k++){
    vec2 g=vec2(float(k),float(j)), o=vec2(gHash(i+g),gHash(i+g+17.3))*.8+.1, r=g+o-f;
    float d=dot(r,r); if(d<d1){ d2=d1; d1=d; id=i+g; } else if(d<d2)d2=d;
  }
  float voeg=1.0-smoothstep(.0,.12+px/.0046,sqrt(d2)-sqrt(d1));
  gL=mix(.92,(.82+.3*gHash(id+gZaad))*(1.0-.4*voeg),gZicht(.0046,px));
  gRaamB=.2;
}else if(gId==3.0||gId==10.0){   /* pleister en leem: vlekken, en onderaan opspattend vuil */
  float n=gRuis(fv*140.0+gZaad*13.0)*.6+gRuis(fv*31.0)*.4;
  gL=mix(1.0,.93+.12*n,gZicht(.008,px));
  if(gId==10.0){ gL*=mix(1.0,.95+.05*sin(hv*900.0),gZicht(.006,px)); gRaamB=.26; }
}else if(gId==4.0){     /* vakwerk: pleister met donkere balken */
  float n=gRuis(fv*140.0+gZaad*13.0);
  gL=mix(1.0,.95+.08*n,gZicht(.008,px));
  if(gZij>.5&&gVerd>0.0&&hv>-.002){
    float S=gVerd, P=S*.36;
    float uu=fv.x+gHalf, fu=fract(uu/P), pi=floor(uu/P);
    float k=floor(hv/S), fy=fract(hv/S);
    float bw=.0011, aa=px*.7;
    float paal=1.0-smoothstep(bw*.5,bw*.5+aa,min(fu,1.0-fu)*P);
    float regel=1.0-smoothstep(bw*.5,bw*.5+aa,min(fy,1.0-fy)*S);
    float sh=gHash(vec2(pi,k+gZaad*7.0));
    float schoor=sh<.3?1.0-smoothstep(bw*.5,bw*.5+aa,abs(fu*P-fy*S*(P/S))*.7):0.0;
    float balk=max(max(paal,regel),schoor)*gZicht(P*.7,px);
    gK=mix(gK,vec3(.21,.15,.11),balk);
    gRaamB=.3;
  }
}else if(gId==5.0||gId==15.0){  /* hout: planken (verdieping < 0: staand), schindels in rijen */
  vec2 q=gVerd<0.0?vec2(fv.y,fv.x):fv;
  float h=gId==15.0?.0024:.0028;
  vec2 b=gBlokken(q,h,gId==15.0?.0035:.04,gId==15.0?.5:.31,gZaad,px,.00035);
  float korrel=gRuis(vec2(q.x*420.0,floor(q.y/h)*7.3));
  gL=mix(.95,(.86+.2*b.x)*(.9+.14*korrel)*(1.0-.35*b.y),gZicht(h,px));
}else if(gId==6.0){     /* riet: strepen langs de helling, lagen, donkere dakvoet */
  float n=gRuis(vec2(fv.x*900.0,fv.y*70.0+gZaad*5.0));
  float lagen=smoothstep(0.0,.35,fract(fv.y/.005));
  gL=mix(.95,(.82+.3*n)*(.9+.1*lagen),gZicht(.0012,px));
  gL*=mix(.78,1.0,smoothstep(0.0,.004,fv.y));
  gK=mix(gK,gK*vec3(.85,1.02,.8),gRuis(fv*60.0+gZaad)*.35);   /* mos */
}else if(gId==7.0){     /* pannen: rijen golvende pannen, elke pan een eigen tint */
  float h=.0027, w=.0033;
  vec2 c=vec2(floor(fv.x/w),floor(fv.y/h)), f=vec2(fract(fv.x/w),fract(fv.y/h));
  float p=(.86+.16*sin(f.x*6.2832))*mix(.78,1.06,f.y)*(.88+.24*gHash(c+gZaad*13.0));
  gL=mix(.95,p,gZicht(h,px));
}else if(gId==8.0){     /* lei: kleine platte leien, verspringend */
  vec2 b=gBlokken(fv,.0019,.0028,.5,gZaad,px,.0003);
  gL=mix(.97,(.88+.24*b.x)*(1.0-.35*b.y),gZicht(.0019,px));
  gK*=mix(vec3(1.0),vec3(.99,.99,1.0),b.x);
  /* lei is van ver geen zwart: het matte grijs vangt de hemel */
  gK*=1.45;
}else if(gId==9.0){     /* plaggen: gras op het dak */
  float n=gRuis(fv*160.0+gZaad*9.0)*.6+gRuis(fv*40.0)*.4;
  gK=mix(gK,gK*vec3(.82,1.1,.78),n*.8);
  gL=mix(.97,.85+.25*n,gZicht(.006,px));
}else if(gId==11.0){    /* marmer: glad, met een zweem van aders */
  float n=gRuis(fv*240.0+gZaad);
  gL=mix(1.0,.97+.06*n,gZicht(.004,px));
  gRaamB=.22;
}else if(gId==12.0){    /* papier: witte vakken in een raster van donker hout */
  float P=.0085, uu=fract((fv.x+gHalf)/P), yy=fract(hv/.0075);
  float lat=max(1.0-smoothstep(.04,.04+px/P,min(uu,1.0-uu)),1.0-smoothstep(.05,.05+px/.0075,min(yy,1.0-yy)));
  gK=mix(gK,vec3(.24,.18,.13),lat*gZicht(P,px));
}else if(gId==13.0){    /* aarde: aangestampt, met sporen */
  float n=gRuis(fv*90.0)*.6+gRuis(fv*400.0)*.4;
  gL=.88+.24*n;
}else if(gId==14.0){    /* kasseien */
  vec2 b=gBlokken(fv,.0022,.0024,.5,gZaad,px,.0004);
  gL=mix(.95,(.85+.25*b.x)*(1.0-.4*b.y),gZicht(.0022,px));
}
/* ramen: rijen op elke verdieping, uit de hoeken weg; 's nachts brandt er
   achter een deel ervan licht */
if(gVerd>0.0&&gZij>.5&&(gId==1.0||gId==2.0||gId==3.0||gId==4.0||gId==10.0||gId==11.0)){
  float S=gVerd, cw=gId==4.0?S*.72:(gId==1.0||gId==2.0)?S*1.7:S*1.05;
  float cx=fv.x/cw+.5, ci=floor(cx), fx=fract(cx);
  float k=floor(hv/S), fy=fract(hv/S);
  float binnen=step(abs(fv.x),gHalf-S*.38)*step(0.0,hv);
  /* niet elk vak een raam: een muur is geen kantoorgebouw */
  binnen*=step(.22,gHash(vec2(ci*3.0+gZaad*17.0,k*5.0+gZaad)));
  float r=gVak(vec2(fx,fy),vec2(.5-gRaamB*.5,.36),vec2(.5+gRaamB*.5,.76),vec2(px/cw,px/S))*binnen;
  float z=gZicht(S*.5,px);
  gK=mix(gK,vec3(.075,.08,.09),r*z*.9);
  gL=mix(gL,gL*(1.0-.14*binnen),1.0-z);
  gGloed=r*step(gHash(vec2(ci*7.0+k*31.0,gZaad*113.0)),.42)*uNacht;
}
/* waar het gebouw de grond raakt is het donkerder: het licht van de hemel
   komt daar niet bij (en er spat modder op) */
if(gZij>.3)gL*=mix(.66,1.0,smoothstep(0.0,.014,gBoven));
/* Verwering: geen gebouw is zo schoon als nieuw. Alles in wereldmaat, zodat
   het op een toren even groot is als op een schuur.
   - vlekken van een paar meter: de ene steen, de ene kalklaag is de andere niet
   - regenstrepen op de muren, vooral van boven naar beneden
   - een vuile voet tot een paar meter hoog
   - korstmos en mos op de daken, en een donkerder onderrand
   Daarna de kleur zelf: een kwart minder verzadigd en iets donkerder dan
   de opgegeven kleur, zoals echte steen, kalk en dakpannen. */
{
  float zg=gZicht(.01,px);
  float vlek=gRuis(vWp.xz*95.0+vWp.y*70.0+gZaad)*.65+gRuis(vWp.xz*260.0-vWp.y*190.0)*.35;
  gL*=mix(1.0,.86+.22*vlek,zg);
  bool dak=gId==6.0||gId==7.0||gId==8.0||gId==9.0||gId==15.0;
  if(gZij>.5&&!dak){
    float streep=gRuis(vec2(fv.x*240.0+gZaad*3.1,hv*9.0+gZaad))*.7+gRuis(vec2(fv.x*610.0,hv*21.0))*.3;
    gL*=1.0-.17*smoothstep(.45,.85,streep)*zg;
    gL*=mix(.82,1.0,smoothstep(0.0,.022,gBoven));
  }
  if(dak||gZij<=.5){
    float mos=smoothstep(.5,.85,gRuis(vWp.xz*420.0+gZaad*5.0)*.6+gRuis(vWp.xz*1300.0)*.4);
    vec3 grijs=vec3(dot(gK,vec3(.3,.59,.11)));
    gK=mix(gK,grijs*vec3(.92,.97,.82),mos*.35*zg);
    if(dak)gL*=mix(.8,1.0,smoothstep(0.0,.006,fv.y));
  }
  float lum=dot(gK,vec3(.2126,.7152,.0722));
  gK=mix(vec3(lum),gK,.74)*.92;
}
diffuseColor.rgb=gK*gL;`;
/* het licht achter de ramen: in emissivemap_fragment */
export const GEBOUW_GLSL_GLOED=`
totalEmissiveRadiance+=vec3(1.0,.62,.3)*gGloed*2.2;`;

/* ======================= bouwstijlen per land =======================
   Kleuren gedempt, zoals echte steen, kalk en riet: een kasteel is grijs
   met een zweem van zijn steen, geen speelgoedblok. Per land:
     muur/muurMat   de buitenmuur van een huis (en het materiaal ervan)
     dak/dakMat     het dak van een huis
     steen/steenMat kastelen en stadsmuren
     torendak/torendakMat  de spitsen
     huis           de vorm van een huis; kasteel: het soort burcht; schip:
                    wat er in de haven ligt; kantelen: de vorm op de muur */
const STIJLEN={
  /* Araluen: Engels platteland — witgekalkte muren en vakwerk, riet en hier
     en daar rode pannen; kastelen van grijze steen met leien spitsen */
  araluen:{muur:["#E6DFCC","#DED4BC","#D7CBB0","#EAE4D6"],muurMat:["vakwerk","vakwerk","pleister"],
    dak:["#9E8A5C","#93805A","#8A7A58","#8E5A44","#7E5040"],dakMat:["riet","riet","riet","pannen","pannen"],
    steen:["#A9A498","#9F9A8E","#B2AC9F"],steenMat:"steen",torendak:["#6E6F71","#67696B","#747473"],torendakMat:"lei",
    huis:"zadel",kasteel:"araluen",schip:"kogge",kantelen:"blok",vlag:"#2F5D3A",kerk:"toren"},
  /* Hibernia: lage witte stenen huisjes met riet, ronde torens */
  hibernia:{muur:["#ECEAE2","#E4E1D7","#DCD8CC"],muurMat:["pleister"],dak:["#9A8656","#8E7E52","#857650"],dakMat:["riet"],
    steen:["#A3A199","#97958C","#ADABA2"],steenMat:"breuk",torendak:["#5A626A"],torendakMat:"lei",
    huis:"zadel",kasteel:"hibernia",schip:"kogge",kantelen:"blok",vlag:"#3E6B3A",kerk:"rond"},
  /* Picta: ruw grijs steen, lage huizen met plaggendaken */
  picta:{muur:["#8C8981","#958F86","#837F77"],muurMat:["breuk"],dak:["#6A7046","#76764C","#5C643F"],dakMat:["plag"],
    steen:["#87847C","#7C7971"],steenMat:"breuk",torendak:["#5A5A52"],torendakMat:"plag",
    huis:"plag",kasteel:"broch",schip:"kogge",kantelen:"blok",vlag:"#2D3E6B",kerk:null},
  /* Skandia: donker hout, lange huizen met plaggen of houten schindels */
  skandia:{muur:["#8E7258","#836A50","#977A5C","#8A6E54"],muurMat:["hout"],dak:["#66724A","#5C6A42","#6A5644","#5A4A3A"],dakMat:["plag","plag","schindel","schindel"],
    steen:["#8A8378","#7B756B"],steenMat:"breuk",torendak:["#3E3226"],torendakMat:"schindel",
    huis:"lang",kasteel:"skandia",schip:"wolf",kantelen:null,vlag:"#8E2B2B",kerk:null},
  /* Teutlandt: vakwerk met steile rode daken */
  teutlandt:{muur:["#E9E0CC","#E2D7BE","#ECE6D8"],muurMat:["vakwerk"],dak:["#8A4A38","#7C4232","#93503C"],dakMat:["pannen"],
    steen:["#A49D90","#989083"],steenMat:"steen",torendak:["#7C4232","#4A525C"],torendakMat:"lei",
    huis:"steil",kasteel:"teutlandt",schip:"kogge",kantelen:"blok",vlag:"#C9A94A",kerk:"toren"},
  /* Gallica: kalksteen, leien daken, kastelen met puntige ronde torens */
  gallica:{muur:["#E2DAC8","#DAD0BA","#E6DFD0","#D4C9B2"],muurMat:["pleister","steen"],dak:["#565E68","#4E5660","#5E6670","#7E4E3C"],dakMat:["lei","lei","lei","pannen"],
    steen:["#D2C9B6","#C8BEA9","#DAD3C4"],steenMat:"steen",torendak:["#4E5660","#474F59"],torendakMat:"lei",
    huis:"steil",kasteel:"gallica",schip:"kogge",kantelen:"blok",vlag:"#2B4C7E",kerk:"toren"},
  /* Iberion: witte muren, rode pannen, laag */
  iberion:{muur:["#EEEAE0","#E8E1D2","#E0D6BF"],muurMat:["pleister"],dak:["#A8644A","#9C5A42","#B07052"],dakMat:["pannen"],
    steen:["#D3C7AC","#C9BC9F"],steenMat:"steen",torendak:["#9C5A42"],torendakMat:"pannen",
    huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"blok",vlag:"#B8862E",kerk:"toren"},
  /* Toscana: oker en terracotta, lage pannendaken, torens met zwaluwstaarten */
  toscana:{muur:["#DDBE8E","#D3A976","#E6D0A8","#D2B083","#E3D8BE"],muurMat:["pleister"],dak:["#A85E40","#9C563A","#B26A48","#94523A"],dakMat:["pannen"],
    steen:["#D2C4A6","#C8B794","#DACFB4"],steenMat:"steen",torendak:["#A85E40"],torendakMat:"pannen",
    huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"zwaluw",vlag:"#8E2B2B",kerk:"campanile"},
  /* Helleno: wit, met zuilen */
  helleno:{muur:["#EFEDE6","#E8E4D9"],muurMat:["pleister"],dak:["#AE6E4E","#A06446"],dakMat:["pannen"],
    steen:["#E0DBCE","#D5CFBF"],steenMat:"marmer",torendak:["#AE6E4E"],torendakMat:"pannen",
    huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"blok",vlag:"#2B5A9E",kerk:"koepel"},
  /* Arrida: leem en kalk, platte daken, koepels en minaretten, palmen */
  arrida:{muur:["#DAC8A0","#D0BA8E","#E6DCC6","#C8AE86","#ECE6D8"],muurMat:["leem"],dak:["#D0BA8E"],dakMat:["leem"],
    steen:["#CDB68C","#C3AA7E","#D6C29C"],steenMat:"leem",torendak:["#E2DCCC","#4A8A82","#D0BA8E"],torendakMat:"pleister",
    huis:"plat",kasteel:"arrida",schip:"dhow",kantelen:"driehoek",vlag:"#2E7A5E",kerk:"moskee"},
  /* Indus: roze zandsteen, uienkoepels */
  indus:{muur:["#D2A284","#C89878","#DCB294","#E4D6C4"],muurMat:["leem"],dak:["#B47A62"],dakMat:["leem"],
    steen:["#C69272","#BC886A","#CFA184"],steenMat:"steen",torendak:["#E8E0D2","#C69272"],torendakMat:"pleister",
    huis:"plat",kasteel:"arrida",schip:"dhow",kantelen:"driehoek",vlag:"#D08A2E",kerk:"moskee"},
  /* Nihon-Ja: wit pleister en donker hout, donkere pannen met opkrullende hoeken */
  "nihon-ja":{muur:["#E8E3D6","#DFD8C8"],muurMat:["papier"],dak:["#45494C","#4C5053","#3F4447"],dakMat:["lei"],
    steen:["#979287","#8A857A"],steenMat:"breuk",torendak:["#45494C"],torendakMat:"lei",
    huis:"japans",kasteel:"nihon",schip:"jonk",kantelen:null,vlag:"#B8302A",kerk:"pagode"},
  /* de Oostelijke Steppen: ronde tenten van vilt */
  steppen:{muur:["#E2D8C2","#D8CBAE","#CEC0A0"],muurMat:["vlak"],dak:["#C4B48C"],dakMat:["vlak"],
    steen:["#B3AA94"],steenMat:"breuk",torendak:["#8E2B2B"],torendakMat:"vlak",
    huis:"joert",kasteel:"skandia",schip:"kogge",kantelen:null,vlag:"#8E2B2B",kerk:null}
};
const STIJL_VAN={araluen:"araluen",hibernia:"hibernia",picta:"picta",celtica:"picta","mountains-of-rain-and-night":"picta",
  skandia:"skandia",skorghijl:"skandia",sonderland:"skandia",teutlandt:"teutlandt",alpina:"teutlandt",ursali:"teutlandt",aslava:"teutlandt",
  gallica:"gallica",iberion:"iberion",toscana:"toscana",santorillos:"helleno",helleno:"helleno",baralat:"arrida",
  arrida:"arrida",indus:"indus","nihon-ja":"nihon-ja","eastern-steps":"steppen","middle-kingdoms":"steppen"};
const matVan=n=>typeof n==="number"?n:(MAT[n]??0);

/* ======================= de bouwer van één plaats ======================= */
export function maakBouwer(omg){
  const S=vormen();
  const {X,Z,yOp,hNorm,opLand,hash2}=omg;
  const bakken={vast:new Bak(),doek:new Bak(),schip:new Bak(true),plas:new Bak(),wiek:new Bak(true),vlag:new Bak()};
  const lampjes=[], bomen=[], wegen=[], rook=[];
  const m4=new THREE.Matrix4(), nm=new THREE.Matrix3(), q=new THREE.Quaternion(), e=new THREE.Euler(), sv=new THREE.Vector3(), pv=new THREE.Vector3();
  const kl=new THREE.Color(), klG=new THREE.Color();
  /* van wereld terug naar de kaart, voor de hoogte boven de grond */
  const X0=X(0), Z0=Z(0);
  /* hoe hoog een punt boven de grond (of de zee) ligt, in modelmaat */
  const bovenLand=(x,y,z)=>(y-yOp(x-X0,z-Z0))/K;
  const bovenZee=(x,y)=>y/K;

  /* b: een bouwer rond kaartpunt (cx,cy), gedraaid over rot */
  /* De ruimte van een model: horizontaal K keer zo groot als de kaart rond
     (cx,cy), verticaal K keer zo hoog rond gC, de grond in het midden (of het
     zeeniveau, voor schepen en steigers). De grond wordt op dezelfde manier
     omgerekend, dus wat op de grond staat, staat er ook na het verkleinen op;
     en een helling is in de modelruimte even steil als echt. */
  function rond(cx,cy,rot,zaad,o={}){
    const co=Math.cos(rot), si=Math.sin(rot);
    const k=o.schaal??K, gC=o.zee?0:yOp(cx,cy);
    let teller=0;
    const b={cx,cy,rot,top:0,straal:.5,k,gC,
      /* toeval dat bij deze plaats hoort: elke keer laden hetzelfde */
      r:(i)=>hash2((cx*131+i*17+zaad)|0,(cy*71+i*29)|0),
      w:(u,v)=>[cx+(u*co-v*si)*k,cy+(u*si+v*co)*k],
      /* een plek op de kaart naast deze, met een verschuiving in modelmaat (niet gedraaid) */
      naast:(du,dv)=>[cx+du*k,cy+dv*k],
      /* van modelhoogte naar wereldhoogte en terug */
      wy:y=>gC+(y-gC)*k,
      my:y=>gC+(y-gC)/k,
      grond:(u,v)=>{ const [x,y]=b.w(u,v); return gC+(yOp(x,y)-gC)/k; },
      land:(u,v)=>{ const [x,y]=b.w(u,v); return opLand(x,y); },
      diep:(u,v)=>{ const [x,y]=b.w(u,v); return hNorm(x,y); },
      /* de laagste grond onder een voetafdruk: daar begint de voet */
      voet:(u,v,ru,rv,r=0)=>{
        let m=b.grond(u,v); const c=Math.cos(r),s=Math.sin(r);
        for(const [a,d] of [[-ru,-rv],[ru,-rv],[ru,rv],[-ru,rv]])m=Math.min(m,b.grond(u+a*c-d*s,v+a*s+d*c));
        return Math.max(m,b.my(.02));
      },
      /* de hoogste grond onder een voetafdruk: daar ligt de vloer */
      kruin:(u,v,ru,rv,r=0)=>{
        let m=b.grond(u,v); const c=Math.cos(r),s=Math.sin(r);
        for(const [a,d] of [[-ru,-rv],[ru,-rv],[ru,rv],[-ru,rv]])m=Math.max(m,b.grond(u+a*c-d*s,v+a*s+d*c));
        return Math.max(m,b.my(.02));
      }
    };
    const kleurVan=(k,var_)=>{ kl.set(k); if(var_){ const f=1+(b.r(teller++)-.5)*var_; kl.r*=f; kl.g*=f; kl.b*=f; } return kl; };
    /* één stuk neerzetten: vorm s, plek (u,y,v) lokaal, maat, draaiing r
       (lokaal), kleur, en in o: mat (materiaal), verd (hoogte van een rij
       ramen), vloer (waar de ramen vanaf tellen), gevel (kleur en materiaal
       van de gevels van een zadeldak) */
    b.stuk=(bak,s,u,y,v,sx,sy,sz,r,kleur,o={})=>{
      const [x,yy]=b.w(u,v);
      m4.compose(pv.set(X(x),b.wy(y),Z(yy)),q.setFromEuler(e.set(o.rx||0,-(rot+(r||0)),o.rz||0,"YXZ")),sv.set(sx*k,sy*k,sz*k));
      nm.getNormalMatrix(m4);
      /* de maten op het vlak blijven in modelmaat (zo heeft een laag steen
         zijn eigen hoogte); de vloer gaat als wereldhoogte mee */
      const info={sx,sy,sz,mat:matVan(o.mat),zaad:(b.r(teller+3)*97)%97,verd:o.verd||0,vloer:b.wy(o.vloer??y)};
      if(o.gevel){ klG.set(o.gevel.kleur||o.gevel); info.gevel={kleur:klG,mat:matVan(o.gevel.mat),verd:o.gevel.verd||0}; }
      bakken[bak].voeg(s,m4,nm,kleurVan(kleur,o.var??.08),info,o.dob,bak==="schip"?bovenZee:bovenLand);
      b.top=Math.max(b.top,y+sy);
    };
    /* een blok op de grond: voet bx×bz, hoogte h boven de grond (y: eigen voet) */
    b.blok=(u,v,bx,bz,h,kleur,o={})=>{
      const y0=o.y??b.voet(u,v,bx/2,bz/2,o.r||0)-.012, top=o.y!=null?o.y+h:(o.vloer??b.grond(u,v))+h;
      b.stuk(o.bak||"vast",S.blok,u,y0,v,bx,Math.max(.002,top-y0),bz,o.r||0,kleur,o);
      return top;
    };
    b.cil=(u,v,rad,h,kleur,o={})=>{
      const y0=o.y??b.voet(u,v,rad*.7,rad*.7)-.012, top=o.y!=null?o.y+h:b.grond(u,v)+h;
      b.stuk(o.bak||"vast",o.zes?S.cil6:o.acht?S.cil8:o.open?S.cil:S.cilDicht,u,y0,v,rad,top-y0,rad,o.r||0,kleur,o);
      return top;
    };
    /* vormen die ergens bovenop komen: y is waar ze beginnen */
    b.kegel=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",o.zes?S.kegel6:o.acht?S.kegel8:S.kegel,u,y,v,rad,h,rad,o.r||0,kleur,o);
    b.pir=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.pir,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.zadel=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.zadel,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.lessenaar=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.lessenaar,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.schild=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.schild,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.pagode=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.pagode,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.koepel=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",S.koepel,u,y,v,rad,h,rad,0,kleur,o);
    b.ui=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",S.ui,u,y,v,rad,h,rad,0,kleur,o);
    b.bol=(u,v,y,rad,kleur,o={})=>b.stuk(o.bak||"vast",S.bol,u,y,v,rad,o.h??rad,rad,0,kleur,o);
    b.lamp=(u,y,v)=>{ const [x,yy]=b.w(u,v); lampjes.push(X(x),b.wy(y),Z(yy)); };
    /* een schoorsteen die rookt: de plek van de rook (zie maakRook in 3d.js) */
    b.rook=(u,y,v)=>{ const [x,yy]=b.w(u,v); rook.push(X(x),b.wy(y),Z(yy)); };
    b.boom=(u,v,soort,maat=1)=>{ const [x,y]=b.w(u,v); if(opLand(x,y))bomen.push(x,y,soort,maat*k); };
    /* een weg of straat (lokale punten): die tekent de grond (zie de wegen in 3d.js) */
    b.weg=(pts,breed=4.5*M,soort=0)=>{ wegen.push({pts:pts.map(([u,v])=>b.w(u,v)),breed:breed*k,soort}); };
    /* een paal met een vlag. Het doek gaat in een eigen bak: de shader laat
       het wapperen, meer naarmate het verder van de paal is */
    b.vlag=(u,v,y,h,kleur,o={})=>{
      const m=o.maat||1;
      b.stuk("vast",S.cil6,u,y,v,.25*M,h,.25*M,0,"#4A3A2A");
      b.stuk("vlag",S.vlak,u,y+h-3.4*M*m,v,6*M*m,3.4*M*m,1,o.r??.6,kleur);
    };
    /* kantelen langs een lijn, op hoogte y, aan de buitenkant van een muur
       van dikte dik (n: de richting naar buiten) */
    b.kantelen=(u0,v0,u1,v1,y,dik,kleur,o={})=>{
      const vorm=o.kantelen===undefined?"blok":o.kantelen; if(!vorm)return;
      const lang=Math.hypot(u1-u0,v1-v0), r=Math.atan2(v1-v0,u1-u0);
      const breed=1.7*M, gat=1.1*M, hoog=(o.kantH??1.4)*M, diep=Math.min(dik,.75*M);
      const n=Math.max(1,Math.floor(lang/(breed+gat)));
      const [nu,nv]=o.buiten||[0,0], off=dik/2-diep/2;
      for(let i=0;i<n;i++){
        const t=(i+.5)/n-.5, cu=(u0+u1)/2+Math.cos(r)*t*lang+nu*off, cv=(v0+v1)/2+Math.sin(r)*t*lang+nv*off;
        if(vorm==="driehoek")b.stuk("vast",S.pir,cu,y,cv,breed*1.1,hoog*1.5,diep*1.2,r,kleur,{mat:o.mat});
        else if(vorm==="zwaluw"){ b.stuk("vast",S.blok,cu,y,cv,breed,hoog*.7,diep,r,kleur,{mat:o.mat}); b.stuk("vast",S.zadel,cu,y+hoog*.7,cv,diep,hoog*.55,breed,r+Math.PI/2,kleur,{mat:o.mat,rx:Math.PI}); }
        else b.stuk("vast",S.blok,cu,y,cv,breed,hoog,diep,r,kleur,{mat:o.mat});
      }
    };
    /* Een muur van (u0,v0) naar (u1,v1): dik genoeg voor een weergang, met
       kantelen aan de buitenkant (de kant die van het midden van de bouwer af
       ligt, of o.buiten). */
    b.muur=(u0,v0,u1,v1,h,dik,kleur,o={})=>{
      const lang=Math.hypot(u1-u0,v1-v0), r=Math.atan2(v1-v0,u1-u0), mu=(u0+u1)/2, mv=(v0+v1)/2;
      /* op een helling loopt een muur in stukken met de grond mee, anders
         wordt het een wig die boven het laagste punt uittorent */
      if(o.y==null&&lang>.1){
        const verval=Math.abs(b.grond(u0,v0)-b.grond(u1,v1))+Math.abs(b.grond(mu,mv)-(b.grond(u0,v0)+b.grond(u1,v1))/2);
        if(verval>h*.35){
          const n=Math.ceil(lang/.07); let top=0;
          for(let i=0;i<n;i++)top=Math.max(top,b.muur(u0+(u1-u0)*i/n,v0+(v1-v0)*i/n,u0+(u1-u0)*(i+1)/n,v0+(v1-v0)*(i+1)/n,h,dik,kleur,{...o,buiten:o.buiten||naarBuiten2(u0,v0,u1,v1)}));
          return top;
        }
      }
      const y0=o.y??Math.min(b.voet(u0,v0,dik,dik),b.voet(mu,mv,dik,dik),b.voet(u1,v1,dik,dik))-.015;
      const top=o.top??Math.max(b.grond(u0,v0),b.grond(mu,mv),b.grond(u1,v1))+h;
      b.stuk("vast",S.blok,mu,y0,mv,lang+dik*.02,top-y0,dik,r,kleur,{mat:o.mat??"steen",var:o.var});
      b.kantelen(u0,v0,u1,v1,top,dik,kleur,{...o,buiten:o.buiten||naarBuiten2(u0,v0,u1,v1)});
      return top;
    };
    /* welke kant van een lijn ligt van het midden af (de buitenkant) */
    const naarBuiten2=(u0,v0,u1,v1)=>{
      const lang=Math.hypot(u1-u0,v1-v0)||1; let nu=-(v1-v0)/lang, nv=(u1-u0)/lang;
      if(nu*(u0+u1)+nv*(v0+v1)<0){ nu=-nu; nv=-nv; }
      return [nu,nv];
    };
    /* een muur rond een veelhoek van punten */
    /* een ringmuur langs punten. open: zijden die helemaal wegblijven.
       gat: [zijde, breedte] — die zijde krijgt in het midden een opening
       voor een poortgebouw, en loopt aan weerszijden door tot de hoeken
       (anders gaapt er naast de poort een gat tot aan de hoektoren) */
    b.ring=(punten,h,dik,kleur,o={})=>{
      for(let i=0;i<punten.length;i++){
        const a=punten[i], c=punten[(i+1)%punten.length];
        if(o.open&&o.open.includes(i))continue;
        if(o.gat&&o.gat[0]===i){
          const L=Math.hypot(c[0]-a[0],c[1]-a[1]), t=Math.max(0,.5-o.gat[1]/2/L);
          const p1=[a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t], p2=[c[0]+(a[0]-c[0])*t,c[1]+(a[1]-c[1])*t];
          if(t>0){ b.muur(a[0],a[1],p1[0],p1[1],h,dik,kleur,o); b.muur(p2[0],p2[1],c[0],c[1],h,dik,kleur,o); }
          continue;
        }
        b.muur(a[0],a[1],c[0],c[1],h,dik,kleur,o);
      }
    };
    /* Een toren: rond of vierkant, met een schuine plint aan de voet, een
       uitkragende borstwering (de krans) met kantelen, en een dak naar
       keuze. h is de hoogte van de schacht tot de borstwering. */
    b.toren=(u,v,rad,h,kleur,o={})=>{
      const mat=o.mat??"steen", g=b.grond(u,v), y0=o.y??b.voet(u,v,rad,rad)-.015;
      const vierkant=!!o.vierkant, ry=o.r||0;
      const top=(o.y!=null?o.y:g)+h;
      const plint=o.plint===false?0:Math.min(h*.3,rad*1.6);
      if(plint)b.stuk("vast",vierkant?S.afgeknot4:S.afgeknot,u,y0,v,rad*(vierkant?2.3:1.16),(o.y!=null?o.y:g)+plint-y0,rad*(vierkant?2.3:1.16),ry,kleur,{mat,var:.04});
      if(vierkant)b.stuk("vast",S.blok,u,y0,v,rad*2,top-y0,rad*2,ry,kleur,{mat,verd:o.ramen||0,vloer:g});
      else b.stuk("vast",S.cil,u,y0,v,rad,top-y0,rad,0,kleur,{mat,verd:o.ramen||0,vloer:g});
      const dak=o.dak||"kegel", dk=o.dakKleur||kleur, dm=o.dakMat??"lei";
      let y=top;
      if(o.krans!==false&&dak!=="koepel"&&dak!=="ui"){
        /* de krans: iets breder dan de schacht, met kantelen erop */
        const kr=rad*1.14, kh=1.6*M;
        if(vierkant)b.stuk("vast",S.blok,u,y-kh,v,kr*2,kh,kr*2,ry,kleur,{mat,var:.05});
        else b.stuk("vast",S.cilDicht,u,y-kh,v,kr,kh,kr,0,kleur,{mat,var:.05});
        if(dak==="plat"||o.kantelenOok){
          const n=vierkant?0:Math.max(6,Math.round(kr*Math.PI*2/(2.8*M)));
          if(vierkant){ const p=[[-kr,-kr],[kr,-kr],[kr,kr],[-kr,kr]].map(([a,c])=>[u+a*Math.cos(ry)-c*Math.sin(ry),v+a*Math.sin(ry)+c*Math.cos(ry)]);
            for(let i=0;i<4;i++){ const A=p[i],C=p[(i+1)%4], mu=(A[0]+C[0])/2-u, mv=(A[1]+C[1])/2-v, l=Math.hypot(mu,mv)||1; b.kantelen(A[0],A[1],C[0],C[1],y,1.2*M,kleur,{kantelen:o.kantelen??"blok",buiten:[mu/l,mv/l],mat}); } }
          else for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; b.stuk("vast",S.blok,u+Math.cos(a)*kr*.94,y,v+Math.sin(a)*kr*.94,1.6*M,1.4*M,.7*M,a+Math.PI/2,kleur,{mat}); }
        }
      }
      switch(dak){
        case "kegel": {
          /* niet te spits: een echte torenspits is lager en breder dan een
             sprookjeshoed */
          const dh=(o.dakH??rad*2.2)*.76, dr=rad*(o.overstek??1.2);
          if(vierkant)b.pir(u,v,y,dr*2,dr*2,dh,dk,{r:ry,mat:dm}); else b.kegel(u,v,y,dr,dh,dk,{mat:dm});
          b.stuk("vast",S.cil6,u,y+dh*.96,v,.15*M,1.8*M,.15*M,0,"#6A5E4A");   /* een pinakel op de punt */
          y+=dh; break;
        }
        case "plat": y+=1.4*M; break;
        case "koepel": b.koepel(u,v,y,rad*1.02,rad*1.05,dk,{mat:dm}); y+=rad*1.05; break;
        case "ui": b.ui(u,v,y,rad*1.15,rad*2.1,dk,{mat:dm}); b.stuk("vast",S.kegel6,u,y+rad*2.1,v,.3*M,2.5*M,.3*M,0,"#C9A94A"); y+=rad*2.1+2.5*M; break;
        case "pagode": for(let i=0;i<(o.lagen||3);i++){ const s=1-i*.22; b.pagode(u,v,y+i*rad*.9,rad*3*s,rad*3*s,rad*1.1,dk,{r:ry,mat:dm}); } y+=(o.lagen||3)*rad*.9; break;
      }
      if(o.vlag)b.vlag(u,v,y-(dak==="kegel"?.6*M:0),5*M,o.vlag);
      return y;
    };
    /* een poortgebouw: twee torens naast de doorgang, een blok erboven met
       kantelen, en de donkere poort zelf; r is de richting naar buiten */
    b.poort=(u,v,r,breed,h,kleur,dak,o={})=>{
      const mat=o.mat??"steen", tr=breed*.26;
      for(const z of [-1,1]){
        const pu=u-Math.sin(r)*z*breed*.4+Math.cos(r)*tr*.4, pv=v+Math.cos(r)*z*breed*.4+Math.sin(r)*tr*.4;
        b.toren(pu,pv,tr,h,kleur,{dak:dak?"kegel":"plat",dakKleur:dak,dakH:tr*2,mat,ramen:0});
      }
      const g=b.grond(u,v);
      const top=b.blok(u,v,breed*.56,breed*.72,h*.9,kleur,{r,mat,vloer:g});
      b.kantelen(u+Math.cos(r)*breed*.33-Math.sin(r)*breed*.28,v+Math.sin(r)*breed*.33+Math.cos(r)*breed*.28,
                 u+Math.cos(r)*breed*.33+Math.sin(r)*breed*.28,v+Math.sin(r)*breed*.33-Math.cos(r)*breed*.28,top,1.2*M,kleur,{buiten:[Math.cos(r),Math.sin(r)],mat,kantelen:o.kantelen});
      /* de poortopening: donker, met de valhekkleur erin */
      b.blok(u+Math.cos(r)*breed*.355,v+Math.sin(r)*breed*.355,.5*M,3.4*M,Math.min(h*.45,4.8*M),"#3A2E24",{r,var:0,y:g-.01,mat:"hout",verd:-1});
    };
    /* een tent: rond (kegel) of met een nok */
    b.tent=(u,v,rad,h,kleur,o={})=>{
      const y=b.voet(u,v,rad*.7,rad*.7)-.006;
      if(o.nok)b.stuk("doek",S.zadel,u,y,v,rad*2.2,h,rad*1.6,o.r||0,kleur);
      else b.stuk("doek",S.kegel6,u,y,v,rad,h,rad,o.r||0,kleur);
      if(o.vlag)b.vlag(u,v,y+h*.9,3.5*M,o.vlag,{maat:.6});
    };
    /* een plas, vijver of gracht: een vlakke schijf water */
    b.plas=(u,v,ru,rv,y,o={})=>b.stuk("plas",S.schijf,u,y,v,ru,1,rv,o.r||0,o.kleur||"#4E7E8C",{var:0});
    /* een rots (voor kliffen, pasjes, steenhopen) */
    b.rots=(u,v,rad,kleur="#8A8579",o={})=>{ const y=b.voet(u,v,rad*.5,rad*.5)-rad*.3; b.stuk("vast",S.bol,u,y,v,rad,rad*(o.plat??.7),rad*(.8+b.r(teller+7)*.4),b.r(teller+3)*6,kleur,{var:.15,mat:"breuk"}); };
    /* een omheining of lage heg langs een lijn */
    b.heg=(u0,v0,u1,v1,kleur="#4E5E36",h=1.3*M,dik=1*M)=>{
      const lang=Math.hypot(u1-u0,v1-v0); if(lang<1e-4)return;
      b.stuk("vast",S.blok,(u0+u1)/2,Math.min(b.grond(u0,v0),b.grond(u1,v1))-.004,(v0+v1)/2,lang,h+.004+Math.abs(b.grond(u0,v0)-b.grond(u1,v1)),dik,Math.atan2(v1-v0,u1-u0),kleur,{var:.12,mat:"plag"});
    };
    return b;
  }

  /* ---- huizen ----
     Eén huis in de stijl van zijn land. Een gewoon huis is tien à twaalf
     meter lang en zes à zeven diep, met muren van een verdieping en een dak
     dat over de muren heen steekt; daarbij een schoorsteen, een deur, en
     soms een aanbouw. Het staat op de laagste grond onder zijn voetafdruk
     (op een helling zakt de muur iets het land in, liever dan dat het huis
     zweeft); de ramen tellen vanaf de hoogste grond, de vloer. */
  function huis(b,u,v,stijl,o={}){
    const st=STIJLEN[stijl]||STIJLEN.araluen, r=o.r||0, m=o.maat||1, n=o.nr||0;
    const rr=i=>b.r(n*7+i);
    const kies=(lijst,i)=>lijst[Math.floor(rr(i)*lijst.length)%lijst.length];
    const mi=Math.floor(rr(1)*st.muur.length)%st.muur.length;
    const muur=o.muur||st.muur[mi], muurMat=o.muurMat||st.muurMat[Math.floor(rr(9)*st.muurMat.length)%st.muurMat.length];
    const di=Math.floor(rr(2)*st.dak.length)%st.dak.length;
    const dak=o.dak||st.dak[di], dakMat=o.dakMat||st.dakMat[di%st.dakMat.length];
    const lag=o.verdiepingen||1;
    const L=(9+rr(4)*4)*M*m*(o.lang||1), D=(6+rr(5)*1.6)*M*m, verdH=3.3*M*Math.min(1.2,m), wH=verdH*lag+.5*M;
    if(!b.land(u,v))return 0;
    const c=Math.cos(r), s=Math.sin(r);
    const g=b.kruin(u,v,L/2,D/2,r), vorm=o.vorm||st.huis;
    const muurO={r,mat:muurMat,verd:verdH,vloer:g,var:.05};
    let top;
    /* een deur in de lange gevel (lokaal -z), een donker vlak met een kozijn */
    const deur=(du,dd,hoog=2.2*M,breed=1.2*M)=>{
      const pu=u+du*c+dd*s, pv=v+du*s-dd*c;
      b.blok(pu,pv,breed,.25*M,hoog,"#4A3828",{r,y:g-.005,var:.15});
    };
    const schoorsteen=(du,hoog)=>{
      const pu=u+du*c, pv=v+du*s;
      b.blok(pu,pv,1.1*M,1.1*M,hoog,"#8A8074",{r,y:g-.01,mat:"breuk",var:.1});
      b.blok(pu,pv,1.4*M,1.4*M,.35*M,"#5E564C",{r,y:g+hoog-.002,var:.1});
      /* in zo'n vier van de tien huizen brandt het vuur */
      if(rr(17)<.4)b.rook(pu,g+hoog+.4*M,pv);
    };
    switch(vorm){
      case "zadel": case "steil": {
        top=b.blok(u,v,L,D,wH,muur,{...muurO,vloer:g});
        const helling=vorm==="steil"?.85:.62, dh=D*helling;
        b.zadel(u,v,top-.3*M,L+1.2*M,D+1.4*M,dh,dak,{r,mat:dakMat,gevel:{kleur:muur,mat:muurMat==="vakwerk"?"vakwerk":"pleister",verd:verdH}});
        if(rr(11)<.75)schoorsteen((rr(12)<.5?-1:1)*(L/2-1*M),wH+dh*.85);
        deur((rr(13)-.5)*L*.4,D/2);
        /* soms een aanbouw achter, of een vleugel haaks erop */
        if(o.aanbouw!==false&&rr(14)<.35){
          const aL=L*(.4+rr(15)*.3), aD=3.2*M, au=u+(rr(16)-.5)*(L-aL)*c-(D/2+aD/2)*s*-1, av=v+(rr(16)-.5)*(L-aL)*s+(D/2+aD/2)*c;
          const at=b.blok(au,av,aL,aD,wH*.7,muur,{...muurO,verd:0});
          b.lessenaar(au,av,at-.2*M,aL+.6*M,aD+.8*M,wH*.35,dak,{r:r+Math.PI,mat:dakMat,gevel:{kleur:muur,mat:"pleister"}});
        }else if(o.aanbouw!==false&&rr(14)<.5){
          const wL=D*1.1, wD=D*.8, au=u+(L/2-wD/2)*c+(D/2+wL/2-.5*M)*s*-1, av=v+(L/2-wD/2)*s+(D/2+wL/2-.5*M)*c;
          const at=b.blok(au,av,wD,wL,wH,muur,{...muurO,r:r+Math.PI/2});
          b.zadel(au,av,at-.3*M,wL+.8*M,wD+1.2*M,wD*helling,dak,{r:r+Math.PI/2,mat:dakMat,gevel:{kleur:muur,mat:"pleister",verd:verdH}});
        }
        top+=dh; break;
      }
      case "lang": {   /* Skandisch langhuis: lage houten wanden, een groot dak tot bijna op de grond */
        const LL=L*1.9, DD=D*1.1;
        top=b.blok(u,v,LL,DD,2.3*M,muur,{r,mat:"hout",verd:-1,vloer:g,var:.06});
        b.zadel(u,v,top-.3*M,LL+1*M,DD+2.6*M,DD*.78,dak,{r,mat:dakMat,gevel:{kleur:muur,mat:"hout",verd:-1}});
        deur(0,DD/2,1.9*M,1.4*M);
        if(rr(11)<.6)b.blok(u+L*.4*c,v+L*.4*s,.8*M,.8*M,2.3*M+DD*.78+.6*M,"#5E564C",{r,y:g,var:.1});
        top+=DD*.78; break;
      }
      case "plag": {   /* Pictisch: laag, dikke muren van breuksteen, een rond plaggendak */
        top=b.blok(u,v,L*.85,D,2.2*M,muur,{r,mat:"breuk",vloer:g});
        b.schild(u,v,top-.3*M,L*.85+.8*M,D+1*M,D*.55,dak,{r,mat:"plag"});
        deur(0,D/2,1.8*M,1*M);
        top+=D*.55; break;
      }
      case "pan": {    /* Toscaans: één of twee lagen, een laag pannendak */
        const hoog=o.verdiepingen||(rr(21)<.4?2:1), h=verdH*hoog+.5*M;
        top=b.blok(u,v,L,D,h,muur,{...muurO});
        b.schild(u,v,top-.2*M,L+.9*M,D+.9*M,D*.24,dak,{r,mat:"pannen"});
        deur((rr(13)-.5)*L*.4,D/2,2.4*M);
        top+=D*.24; break;
      }
      case "plat": {   /* Arridisch: een blok met een borstweringetje, soms een koepeltje */
        const hoog=o.verdiepingen||(rr(23)<.3?2:1), h=verdH*hoog+.6*M;
        top=b.blok(u,v,L*.9,D*1.05,h,muur,{...muurO,mat:"leem"});
        for(const [a,cc,l] of [[0,-1,L*.9],[0,1,L*.9],[-1,0,D*1.05],[1,0,D*1.05]]){
          const pu=u+a*L*.45*c-cc*D*.525*s, pv=v+a*L*.45*s+cc*D*.525*c;
          b.blok(pu,pv,a?.5*M:l,a?l:.5*M,.9*M,muur,{r,y:top,mat:"leem"});
        }
        if(rr(29)<.15){ b.koepel(u,v,top,D*.32,D*.34,rr(31)<.5?"#ECE6D8":muur,{mat:"pleister"}); top+=D*.34; }
        deur((rr(13)-.5)*L*.3,D*.525,2.2*M,1.1*M);
        break;
      }
      case "japans": { /* hout en papier op een stenen voet, een donker dak dat uitwaaiert */
        const v0=b.blok(u,v,L,D,.8*M,"#8E897E",{r,mat:"breuk",vloer:g});
        top=b.blok(u,v,L*.92,D*.9,3*M,muur,{r,y:v0,mat:"papier",vloer:v0});
        b.pagode(u,v,top-.3*M,L*1.25,D*1.35,D*.5,dak,{r,mat:"lei"});
        top+=D*.5; break;
      }
      case "joert": {
        top=b.cil(u,v,D*.5,2*M,muur,{acht:true,mat:"vlak"});
        b.kegel(u,v,top,D*.52,D*.3,dak,{acht:true,mat:"vlak"});
        top+=D*.3; break;
      }
    }
    return top;
  }

  /* ---- een dorp ----
     Een dorp groeit langs zijn straten: een hoofdstraat door het midden, soms
     een tweede die hem kruist, en bij een stad een paar meer. Langs de straat
     staan de huizen met hun lange kant (of in Teutlandt en Gallica vaak hun
     gevel) naar de straat, met een tuin erachter; in het midden een plein met
     een kerk of hal en een put. Een huis komt alleen waar het op het land
     past, niet te steil, niet in de rivier en niet op een ander huis. */
  function dorp(b,stijl,o={}){
    const st=STIJLEN[stijl]||STIJLEN.araluen;
    const R=o.straal||.4, aantal=o.aantal||14, maat=o.maat||1;
    const ri=o.richting??b.r(1)*Math.PI;
    const straten=[];
    const straat=(a,van,tot,buig)=>{
      const pts=[]; const n=Math.max(3,Math.round((tot-van)/.05));
      for(let i=0;i<=n;i++){
        const t=van+(tot-van)*i/n, z=Math.sin(t/R*2.1+b.r(straten.length+30)*6)*R*buig;
        pts.push([Math.cos(a)*t-Math.sin(a)*z,Math.sin(a)*t+Math.cos(a)*z]);
      }
      straten.push(pts);
    };
    const lengte=R*(o.rek||1.15);
    straat(ri,-lengte,lengte,o.buig??.1);
    if(o.enkel){}
    else if(aantal>9||b.r(2)<.5){ const a2=ri+Math.PI/2+(b.r(3)-.5)*.6; straat(a2,b.r(4)<.5?-R*.9:0,R*.95,.08); }
    if(aantal>26){ straat(ri+(b.r(5)-.5)*.5,-R*.9,R*.9,.06); straten[straten.length-1]=straten[straten.length-1].map(([u,v])=>[u-Math.sin(ri)*R*.42,v+Math.cos(ri)*R*.42]); }
    if(aantal>40){ straat(ri+(b.r(6)-.5)*.5,-R*.9,R*.9,.06); straten[straten.length-1]=straten[straten.length-1].map(([u,v])=>[u+Math.sin(ri)*R*.42,v-Math.cos(ri)*R*.42]); }
    const plein=o.geenPlein?0:(5+aantal*.25)*M+.03;
    const [pu,pv]=o.plein||[0,0];
    /* kandidaatplekken langs de straten, aan beide kanten */
    const kand=[];
    straten.forEach((pts,si)=>{
      let acc=0;
      for(let i=1;i<pts.length;i++){
        const [a0,b0]=pts[i-1],[a1,b1]=pts[i], l=Math.hypot(a1-a0,b1-b0), dir=Math.atan2(b1-b0,a1-a0);
        acc+=l;
        const stap=(o.stad?9:11+b.r(si*50+i)*5)*M*maat;
        for(let t=0;t<l;t+=stap*.5){
          for(const z of [-1,1]){
            const gevel=(st.huis==="steil"&&b.r(si*91+i*3+(z>0?1:0))<.55)||st.huis==="plat";
            const D=(gevel?11:6.6)*M*maat, set=(o.rooilijn??3.4)*M+D/2+(o.breedStraat??2.2)*M;
            const u=a0+(a1-a0)*t/l-Math.sin(dir)*z*set, v=b0+(b1-b0)*t/l+Math.cos(dir)*z*set;
            const d=Math.hypot(u-pu,v-pv);
            kand.push({u,v,r:dir+(gevel?Math.PI/2:0)+(z<0&&!gevel?Math.PI:0)+(b.r(i*13+si+(z>0?7:0))-.5)*(o.stad?.04:.12),d:d+b.r(i*7+si*3+(z>0?5:0))*R*(o.stad?.15:.3),dir,z});
          }
        }
      }
    });
    kand.sort((a,c)=>a.d-c.d);
    const gezet=[];
    for(const k of kand){
      if(gezet.length>=aantal)break;
      if(k.d>R*1.25)continue;
      const {u,v}=k;
      if(Math.hypot(u-pu,v-pv)<plein)continue;
      if(o.weg&&o.weg(u,v))continue;
      const ru=8*M*maat;
      if(!b.land(u,v)||!b.land(u+ru,v)||!b.land(u-ru,v)||!b.land(u,v+ru)||!b.land(u,v-ru))continue;
      if(omg.rivierOp&&omg.rivierOp(...b.w(u,v))>20)continue;
      const g=b.grond(u,v), s=Math.abs(b.grond(u+ru,v)-g)+Math.abs(b.grond(u,v+ru)-g);
      if(s>ru*1.1)continue;
      if(gezet.some(([a,c])=>Math.hypot(a-u,c-v)<(o.stad?9:11)*M*maat))continue;
      /* niet op een straat */
      if(straten.some(pts=>pts.some(([a,c])=>Math.hypot(a-u,c-v)<4.4*M*maat)))continue;
      gezet.push([u,v]);
      const t=huis(b,u,v,stijl,{r:k.r,nr:gezet.length+(o.zaad||0)*41,maat,verdiepingen:o.verdiepingen&&b.r(gezet.length*5)<o.stad?2:undefined});
      b.top=Math.max(b.top,t);
      /* de tuin erachter: een boom of twee, soms een heg */
      if(o.tuinen!==false&&b.r(gezet.length*17+3)<.55){
        const tz=k.z*(11*M*maat), tu=u-Math.sin(k.dir)*tz, tv=v+Math.cos(k.dir)*tz;
        if(b.land(tu,tv))b.boom(tu+(b.r(gezet.length+71)-.5)*.02,tv+(b.r(gezet.length+73)-.5)*.02,st.huis==="plat"?4:(stijl==="toscana"&&b.r(gezet.length)<.3?7:2),.42);
      }
    }
    /* de straten tekenen in de grond */
    if(!o.geenWeg)for(const pts of straten)b.weg(pts,(o.breedStraat??2.2)*2*M,1);
    /* het plein: kerk, hal, tempel of moskee, en een put */
    if(!o.geenPlein)pleinGebouw(b,stijl,pu+Math.cos(ri+Math.PI/2)*plein*.55,pv+Math.sin(ri+Math.PI/2)*plein*.55,ri);
    b.straal=Math.max(b.straal,R*1.1);
    return {straten,gezet};
  }
  /* het gebouw op het plein, naar het land */
  function pleinGebouw(b,stijl,u,v,r){
    const st=STIJLEN[stijl]||STIJLEN.araluen, g=b.voet(u,v,6*M,6*M);
    const c=Math.cos(r), s=Math.sin(r);
    switch(st.kerk){
      case "toren": case "rond": {   /* een dorpskerk: schip met steil dak, toren met spits */
        const muur=st.steen[0], dak=st.torendak[0];
        const top=b.blok(u,v,17*M,8*M,7*M,muur,{r,mat:st.steenMat,verd:4.5*M,vloer:g});
        b.zadel(u,v,top-.2*M,17.8*M,9*M,6*M,dak,{r,mat:st.torendakMat,gevel:{kleur:muur,mat:st.steenMat}});
        const tu=u-c*10.5*M, tv=v-s*10.5*M;
        if(st.kerk==="rond")b.toren(tu,tv,2.6*M,17*M,muur,{dak:"kegel",dakKleur:dak,dakH:6*M,mat:st.steenMat,krans:false,plint:false});
        else b.toren(tu,tv,3*M,15*M,muur,{vierkant:true,r,dak:"kegel",dakKleur:dak,dakH:11*M,mat:st.steenMat,krans:false,plint:false,overstek:1.05});
        break;
      }
      case "campanile": {
        const muur=st.muur[4]||st.muur[0];
        const top=b.blok(u,v,16*M,9*M,8*M,muur,{r,mat:"pleister",verd:5*M,vloer:g});
        b.schild(u,v,top-.2*M,16.6*M,9.6*M,2.4*M,st.dak[0],{r,mat:"pannen"});
        b.toren(u-c*10*M,v-s*10*M,2.6*M,24*M,muur,{vierkant:true,r,dak:"kegel",dakKleur:st.dak[0],dakH:3*M,mat:"pleister",krans:false,plint:false,overstek:1.1});
        break;
      }
      case "koepel": case "moskee": {
        const muur=st.muur[4]||st.muur[0];
        const top=b.blok(u,v,13*M,13*M,7*M,muur,{r,mat:st.huis==="plat"?"leem":"pleister",vloer:g});
        b.koepel(u,v,top,5.6*M,5.4*M,st.torendak[1]||st.torendak[0],{mat:"pleister"});
        if(st.kerk==="moskee")b.toren(u+c*9*M-s*5*M,v+s*9*M+c*5*M,1.3*M,20*M,muur,{dak:"koepel",dakKleur:st.torendak[0],mat:"leem",plint:false});
        break;
      }
      case "pagode": {
        const top=b.blok(u,v,9*M,9*M,1*M,"#8E897E",{r,mat:"breuk"});
        let y=top; for(let i=0;i<3;i++){ const f=1-i*.22; b.blok(u,v,6.5*M*f,6.5*M*f,2.6*M,"#7A5E46",{r,y,mat:"hout"}); b.pagode(u,v,y+2.4*M,10*M*f,10*M*f,2.4*M,"#45494C",{r,mat:"lei"}); y+=4.2*M; }
        break;
      }
      default: {   /* een grote hal of een eenvoudige houten kapel */
        if(st.huis==="lang"){ huis(b,u,v,stijl,{r,maat:1.5,nr:99,aanbouw:false}); break; }
        const top=b.blok(u,v,10*M,7*M,5*M,st.muur[0],{r,mat:st.muurMat[0],vloer:g});
        b.zadel(u,v,top-.2*M,10.8*M,8*M,4.5*M,st.dak[0],{r,mat:st.dakMat[0],gevel:{kleur:st.muur[0],mat:st.muurMat[0]}});
      }
    }
    /* de put */
    const wu=u+s*9*M, wv=v-c*9*M, wg=b.grond(wu,wv);
    b.cil(wu,wv,1*M,.9*M,"#8E887C",{mat:"breuk",y:wg-.005});
    for(const z of [-1,1])b.blok(wu+c*z*.9*M,wv+s*z*.9*M,.2*M,.2*M,2.2*M,"#5E4A38",{r,y:wg});
    b.zadel(wu,wv,wg+2.2*M,2.2*M,1.6*M,.9*M,"#6A5440",{r:r+Math.PI/2,mat:"hout"});
  }

  /* ---- schepen ----
     Een romp uit spanten, smal aan de punten, met een zeeg (hoger aan
     voor- en achtersteven). Daarop wat bij het soort hoort: het vierkante
     gestreepte zeil en de schildenrij van een wolfschip, de driehoekszeilen
     van de Reiger, het latijnzeil van een dhow, de latten van een jonk. Op
     schaal: een wolfschip is zo'n vijfentwintig meter. */
  function romp(bak,b,L,B,diep,zeeg,steven,kleur,plek,dob){
    const st=10, ring=[];
    for(let i=0;i<=st;i++){
      const t=i/st*2-1, w=B/2*(1-Math.pow(Math.abs(t),2.2)), z=zeeg*t*t+(Math.abs(t)>.85?steven*(Math.abs(t)-.85)/.15:0);
      ring.push([t*L/2,w,z]);
    }
    const pos=[];
    for(let i=0;i<st;i++){
      const [x0,w0,z0]=ring[i], [x1,w1,z1]=ring[i+1];
      for(const s of [-1,1]){
        /* boord en bodem, aan elke kant */
        pos.push(x0,z0,s*w0, x1,z1,s*w1, x1,-diep,0,  x0,z0,s*w0, x1,-diep,0, x0,-diep,0);
      }
      pos.push(x0,z0*.6,-w0*.9, x1,z1*.6,-w1*.9, x1,z1*.6,w1*.9,  x0,z0*.6,-w0*.9, x1,z1*.6,w1*.9, x0,z0*.6,w0*.9); /* dek */
    }
    const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); g.computeVertexNormals();
    const s={p:g.getAttribute("position").array,n:g.getAttribute("normal").array,vorm:"vlak"};
    const [mx,my,richting]=plek;
    m4.compose(pv.set(X(mx),0,Z(my)),q.setFromEuler(e.set(0,-richting,0)),sv.set(K,K,K));
    nm.getNormalMatrix(m4);
    kl.set(kleur); bakken[bak].voeg(s,m4,nm,kl,{sx:1,sy:1,sz:1,mat:MAT.hout,zaad:dob[2]%97,verd:0,vloer:0},dob,bovenZee);
  }
  /* een varend schip draait in de shader over een cirkel van VAARSTRAAL
     (zie de schepen in 3d.js); de vierde waarde van dob is dan 10 + de koers
     (cirkel links van de koers) of -(10 + de koers) (cirkel rechts) */
  const VAARSTRAAL=.15;
  function schip(soort,mx,my,richting,zaad,o={}){
    const tau=Math.PI*2, kk=10+((richting%tau)+tau)%tau, dob=[X(mx),Z(my),zaad*7.3,o.vaar?o.vaar*kk:1];
    const b=rond(mx,my,richting,zaad,{zee:true});
    const sk=(s,u,y,v,sx,sy,sz,r,k,oo={})=>b.stuk("schip",s,u,y,v,sx,sy,sz,r,k,{...oo,dob,var:.05});
    const m=(o.maat||1)*M;
    switch(soort){
      case "wolf": case "reiger": {
        const L=30*m, B=6*m;
        romp("schip",b,L,B,1.4*m,1.5*m,3.4*m,o.romp||"#5B4330",[mx,my,richting],dob);
        /* de schilden langs de boord */
        if(soort==="wolf")for(let i=-6;i<=6;i++)for(const z of [-1,1])sk(S.cil8,i*L*.062,.5*m,z*B*.47,.9*m,.25*m,.9*m,0,["#A33A2A","#E0D6BC","#2E4E7A","#C9A94A"][(i+7+(z>0?1:0)+zaad)%4],{rx:Math.PI/2,mat:"vlak"});
        sk(S.cil6,0,0,0,.25*m,14*m,.25*m,0,"#4A3826");
        if(soort==="wolf"){
          /* het vierkante zeil, gestreept */
          const str=o.zeil||["#A83A2C","#EDE4CF"];
          for(let i=0;i<5;i++)sk(S.doek,0,4.5*m+i*1.8*m,0,9*m,1.8*m,1,Math.PI/2,str[i%2]);
        }else{
          /* de Reiger: twee driehoekige windzeilen, Hals eigen ontwerp */
          sk(S.driehoek,.0,2*m,0,10*m,12*m,1,Math.PI,"#EFE8D6");
          sk(S.driehoek,-7*m,2*m,0,7*m,9*m,1,Math.PI,"#E4DCC6");
        }
        break;
      }
      case "kogge": {
        const L=22*m, B=7.5*m;
        romp("schip",b,L,B,2.4*m,1.4*m,1.6*m,o.romp||"#6A4E36",[mx,my,richting],dob);
        sk(S.blok,-L*.34,1*m,0,4.5*m,3*m,B*.8,0,"#5E4430",{mat:"hout"});   /* achterkasteel */
        sk(S.cil6,0,0,0,.3*m,17*m,.3*m,0,"#4A3826");
        sk(S.doek,0,5.5*m,0,9*m,9*m,1,Math.PI/2,o.zeil||"#EDE4CF");
        break;
      }
      case "galei": {
        const L=30*m, B=5*m;
        romp("schip",b,L,B,1.4*m,1*m,1.6*m,o.romp||"#4E3A2A",[mx,my,richting],dob);
        for(let i=-7;i<=7;i++)for(const z of [-1,1])sk(S.blok,i*L*.055,-.1*m,z*B*.9,.2*m,.2*m,4*m,0,"#3E2E20");  /* riemen */
        sk(S.cil6,2*m,0,0,.3*m,15*m,.3*m,0,"#4A3826");
        sk(S.driehoek,9*m,2.4*m,0,-18*m,13*m,1,0,o.zeil||"#E8DFC8");
        break;
      }
      case "dhow": {
        const L=18*m, B=5.5*m;
        romp("schip",b,L,B,2*m,1.8*m,2.4*m,o.romp||"#7A5A3C",[mx,my,richting],dob);
        sk(S.cil6,1.6*m,0,0,.3*m,13*m,.3*m,0,"#4A3826");
        sk(S.driehoek,8*m,2.4*m,0,-16*m,12*m,1,0,o.zeil||"#F0EADA");
        break;
      }
      case "jonk": {
        const L=20*m, B=7*m;
        romp("schip",b,L,B,2*m,1*m,2.8*m,o.romp||"#5E4632",[mx,my,richting],dob);
        sk(S.blok,-L*.36,.8*m,0,4*m,3.2*m,B*.85,0,"#4E3A28",{mat:"hout"});
        for(const [u,h] of [[2.4,15],[-3.2,12]]){
          sk(S.cil6,u*m,0,0,.3*m,h*m,.3*m,0,"#3E2E20");
          for(let i=0;i<4;i++)sk(S.doek,u*m,4*m+i*2.2*m,0,6.5*m,2.1*m,1,Math.PI/2,i%2?"#A0522D":"#B5653A");
        }
        break;
      }
      default: {  /* een vissersbootje */
        romp("schip",b,7*m,2.4*m,.8*m,.5*m,.5*m,o.romp||"#6B5038",[mx,my,richting],dob);
        if(o.zeil!==false){ sk(S.cil6,.3*m,0,0,.15*m,5.5*m,.15*m,0,"#4A3826"); sk(S.driehoek,.3*m,1*m,0,-3.6*m,4*m,1,0,o.zeil||"#E8DFC8"); }
      }
    }
  }

  /* ---- de kust: waar ligt het water vanaf hier, en waar begint het ---- */
  function zeeRichting(cx,cy,R=1.6){
    let sx=0,sz=0,n=0;
    for(let i=0;i<24;i++){ const a=i/24*Math.PI*2; for(const r of [R*.5,R]){ if(hNorm(cx+Math.cos(a)*r,cy+Math.sin(a)*r)<-.01){ sx+=Math.cos(a); sz+=Math.sin(a); n++; } } }
    if(!n)return null;
    const l=Math.hypot(sx,sz)||1;
    return Math.atan2(sz/l,sx/l);
  }
  /* langs een richting: waar het land ophoudt (de waterlijn) */
  function waterlijn(cx,cy,a,max=4){
    let t=0; const dx=Math.cos(a), dy=Math.sin(a);
    if(hNorm(cx,cy)<0){ while(t>-max&&hNorm(cx+dx*t,cy+dy*t)<0)t-=.02; return t; }
    while(t<max&&hNorm(cx+dx*t,cy+dy*t)>=0)t+=.02;
    return t;
  }
  /* schepen op het water voor een haven: waar het diep genoeg is, niet op elkaar */
  function vloot(cx,cy,a,soort,aantal,zaad,o={}){
    const gelegd=[];
    for(let k=0;k<aantal*30&&gelegd.length<aantal;k++){
      const hk=hash2((cx*31+k*7+zaad)|0,(cy*17+k*13)|0), hk2=hash2((cy*29+k*5)|0,(cx*11+k*19+zaad)|0);
      /* de afstanden in modelmaat: een haven op schaal heeft zijn schepen dichtbij */
      const hoek=a+(hk-.5)*(o.spreid??1.6), d=((o.van??.35)+hk2*(o.tot??.9))*K*(1+Math.floor(k/(aantal*10))*.6);
      const x=cx+Math.cos(hoek)*d, y=cy+Math.sin(hoek)*d, rr=.1*K;
      if(hNorm(x,y)>(o.ondiep??-.02))continue;
      if(hNorm(x+rr,y)>-.005||hNorm(x-rr,y)>-.005||hNorm(x,y+rr)>-.005||hNorm(x,y-rr)>-.005)continue;
      if(gelegd.some(([gx,gy])=>Math.hypot(gx-x,gy-y)<(o.ruimte??.22)*K))continue;
      gelegd.push([x,y]);
      const r=o.richting!=null?o.richting+(hk2-.5)*.4:hk*Math.PI*2;
      /* de helft van de schepen voor anker vaart: alleen als de hele cirkel
         die het schip vaart over open water loopt */
      let vaar=0;
      if(o.varen!==false&&hash2((x*97)|0,(y*89+k)|0)<.5){
        /* links of rechtsom: de kant waar de cirkel helemaal op zee ligt */
        for(const z of [1,-1]){
          const mx=x-Math.sin(r)*VAARSTRAAL*z, my=y+Math.cos(r)*VAARSTRAAL*z;
          let vrij=true;
          for(let i=0;i<20&&vrij;i++){ const a=i/20*Math.PI*2; for(const f of [.8,1,1.2])if(hNorm(mx+Math.cos(a)*VAARSTRAAL*f,my+Math.sin(a)*VAARSTRAAL*f)>-.008){ vrij=false; break; } }
          if(vrij){ vaar=z; break; }
        }
      }
      schip(Array.isArray(soort)?soort[gelegd.length%soort.length]:soort,x,y,r,zaad+k,{...o,vaar});
    }
    return gelegd;
  }
  /* een steiger vanaf de waterlijn het water in: planken op palen */
  function steiger(b,cx,cy,a,lang=.25,kleur="#6B5138"){
    const t=waterlijn(cx,cy,a), dx=Math.cos(a), dy=Math.sin(a);
    const x0=cx+dx*(t-.05*K), y0=cy+dy*(t-.05*K);
    const c=rond(x0,y0,a,7,{zee:true});
    c.stuk("vast",V.blok,lang/2,.02,0,lang,.5*M,3*M,0,kleur,{mat:"hout"});
    for(let i=0;i<=Math.floor(lang/(4*M));i++)for(const z of [-1,1])c.stuk("vast",V.cil6,i*4*M,-.2,z*1.3*M,.25*M,.22+.5*M,.25*M,0,"#4E3A28");
    return [x0+dx*lang*K,y0+dy*lang*K];
  }
  /* een kade langs de waterlijn: een stenen rand met een bolder hier en daar */
  function kade(b,cx,cy,a,lang,kleur="#8E887C"){
    const t=waterlijn(cx,cy,a), dx=Math.cos(a), dy=Math.sin(a);
    const x0=cx+dx*(t-.012*K), y0=cy+dy*(t-.012*K);
    const c=rond(x0,y0,a+Math.PI/2,9,{zee:true});
    const g=Math.max(.03,c.grond(0,-3*M));
    c.blok(0,0,lang,4*M,.2*M,kleur,{y:-.15,mat:"steen"});
    c.stuk("vast",V.blok,0,-.15,0,lang,g+.15,4*M,0,kleur,{mat:"steen"});
    for(let i=-2;i<=2;i++)c.cil(i*lang*.2,1*M,.35*M,.8*M,"#3E3830",{y:g});
    return [x0,y0];
  }

  /* ---- een windmolen: een stenen torenmolen met een kap en vier wieken ---- */
  function molen(b,u,v,r){
    const g=b.voet(u,v,3*M,3*M);
    b.stuk("vast",S.afgeknot,u,g-.01,v,3.4*M,10*M+.01,3.4*M,0,"#C9C1AE",{mat:"pleister",var:.06});
    const top=g+10*M;
    b.koepel(u,v,top-.2*M,3.1*M,3.2*M,"#6E5A44",{mat:"schindel"});
    /* de as wijst naar lokaal r; de wieken in een vlak loodrecht erop. Ze
       draaien: elk hoekpunt weet waar de naaf zit en hoe de as loopt
       (aDobber), de shader in 3d.js draait ze daaromheen. */
    const c=Math.cos(r), s=Math.sin(r), au=u+c*3.4*M, av=v+s*3.4*M, ay=top+1.6*M;
    const [nx,ny]=b.w(au,av), dob=[X(nx),Z(ny),b.wy(ay),b.rot+r];
    for(let i=0;i<4;i++){
      const hk=i*Math.PI/2+.35;
      b.stuk("wiek",S.blok,au,ay,av,.35*M,9.5*M,.35*M,r+Math.PI/2,"#5E4A38",{rz:hk,mat:"hout",dob});
      b.stuk("wiek",S.vlak,au,ay,av,1.6*M,8*M,1,r+Math.PI/2,"#D8CFB8",{rz:hk+Math.PI,var:.04,dob});
    }
  }
  /* ---- een boerenerf: het woonhuis, een schuur, een hooiberg, een omheinde wei ---- */
  /* Een kudde: schapen (wit, met een donkere kop) of koeien (groter, bruin,
     zwart of bont), los verspreid in een ovaal rond (u,v), elk een andere
     kant op; alleen op droog land en niet in een rivier. */
  function kudde(b,u,v,ru,rv,n,soort,r0=0,zaad=0){
    const c=Math.cos(r0), s=Math.sin(r0), koe=soort==="koe";
    for(let i=0;i<n;i++){
      const a=b.r(700+zaad+i)*Math.PI*2, d=Math.sqrt(b.r(730+zaad+i));
      const lu=Math.cos(a)*d*ru, lv=Math.sin(a)*d*rv, su=u+lu*c-lv*s, sv=v+lu*s+lv*c;
      if(!b.land(su,sv)||(omg.rivierOp&&omg.rivierOp(...b.w(su,sv))>20))continue;
      const g=b.grond(su,sv), ri=b.r(760+zaad+i)*6.28;
      const lijf=koe?["#6E4A32","#2E2A26","#D8D0C2","#8A5A3A"][Math.floor(b.r(790+zaad+i)*4)]:(b.r(790+zaad+i)<.85?"#E4DECE":"#3A3430");
      const L=koe?2.3*M:1.3*M, B2=koe?.9*M:.7*M, H=koe?1.1*M:.8*M, y=koe?.6*M:.3*M;
      b.blok(su,sv,L,B2,H,lijf,{r:ri,y:g+y,var:.06});
      b.blok(su+Math.cos(ri)*L*.6,sv+Math.sin(ri)*L*.6,koe?.6*M:.4*M,koe?.5*M:.35*M,koe?.6*M:.4*M,koe?"#3A2E26":"#3A3430",{r:ri,y:g+y+H*.55});
      if(koe)for(const [lx,lz] of [[.35,.3],[-.35,.3],[.35,-.3],[-.35,-.3]])
        b.blok(su+Math.cos(ri)*L*lx-Math.sin(ri)*B2*lz,sv+Math.sin(ri)*L*lx+Math.cos(ri)*B2*lz,.25*M,.25*M,y+.05*M,"#3A2E26",{r:ri,y:g-.02*M,var:0});
    }
  }
  function boerderij(b,stijl,zaad){
    const st=STIJLEN[stijl]||STIJLEN.araluen, a=b.r(1)*Math.PI*2, c=Math.cos(a), s=Math.sin(a);
    if(!b.land(0,0))return;
    if(st.huis==="joert"){ for(let i=0;i<3;i++){ const t=i*2.1+b.r(i); huis(b,Math.cos(t)*7*M,Math.sin(t)*7*M,stijl,{nr:zaad+i}); } return; }
    huis(b,0,0,stijl,{r:a,nr:zaad,maat:1.05});
    /* de schuur: haaks op het huis, met de erf ertussen */
    const su=-s*15*M+c*4*M, sv=c*15*M+s*4*M;
    if(b.land(su,sv)&&st.huis!=="plat"&&st.huis!=="japans"){
      const g=b.kruin(su,sv,8*M,5*M), top=b.blok(su,sv,16*M,9*M,4.6*M,stijl==="skandia"?st.muur[0]:"#9C8266",{r:a+Math.PI/2,mat:"hout",verd:-1,vloer:g});
      b.zadel(su,sv,top-.2*M,16.8*M,10.6*M,6*M,st.dak[Math.floor(b.r(3)*st.dak.length)],{r:a+Math.PI/2,mat:st.dakMat[0]==="pannen"?"pannen":st.dakMat[0],gevel:{kleur:"#9C8266",mat:"hout",verd:-1}});
    }else if(b.land(su,sv)){
      huis(b,su,sv,stijl,{r:a+Math.PI/2,nr:zaad+7,maat:.8,aanbouw:false});
    }
    /* een hooiberg of twee */
    if(st.huis==="zadel"||st.huis==="steil"||st.huis==="plag")for(let i=0;i<1+Math.floor(b.r(5)*2);i++){
      const hu=c*(9+i*4)*M+s*9*M, hv=s*(9+i*4)*M-c*9*M; if(!b.land(hu,hv))continue;
      const g=b.grond(hu,hv); b.cil(hu,hv,2*M,2.4*M,"#C2A866",{mat:"riet",y:g-.005}); b.kegel(hu,hv,g+2.4*M,2.2*M,2.2*M,"#B89E5E",{mat:"riet"});
    }
    /* een omheinde wei achter het erf */
    if(b.r(6)<.6&&st.huis!=="plat"){
      const wu=c*26*M, wv=s*26*M, L=22*M, D=16*M;
      const hoek=(x,z)=>[wu+x*c-z*s,wv+x*s+z*c];
      const pts=[hoek(-L/2,-D/2),hoek(L/2,-D/2),hoek(L/2,D/2),hoek(-L/2,D/2)];
      for(let i=0;i<4;i++){ if(i===0&&b.r(8)<.5)continue; const [p0,p1]=[pts[i],pts[(i+1)%4]]; if(b.land(...p0)&&b.land(...p1))b.heg(p0[0],p0[1],p1[0],p1[1],"#6B5640",1*M,.3*M); }
      /* met vee erin */
      kudde(b,wu,wv,L*.4,D*.38,3+Math.floor(b.r(9)*5),b.r(10)<.5?"koe":"schaap",Math.atan2(s,c),zaad%97);
    }
  }
  /* Een plan uitvoeren (zie dorpPlan en havenPlan in 3d-grond.js): de
     huizen, schuren, stadshuizen en pakhuizen, elk alleen waar het op
     droog en niet te steil land past; de brink of het marktplein met de
     kerk en kraampjes; de muur. Het plan staat in kaartmaat ten opzichte
     van het midden van b; straten: ook de straten in de grond leggen (voor
     een plaats op de kaart; de straten van de naamloze plekken legt de
     rekenploeg zelf). */
  function bouwPlan(b,plan,stijl,soort,a,zaad,o={}){
    const st=STIJLEN[stijl]||STIJLEN.araluen, ru=7*M;
    let nr=(zaad%71)*41;
    for(const h of plan.huizen){
      const u=h.x/K, v=h.y/K;
      if(!b.land(u,v)||!b.land(u+ru,v)||!b.land(u-ru,v)||!b.land(u,v+ru)||!b.land(u,v-ru))continue;
      if(omg.rivierOp&&omg.rivierOp(...b.w(u,v))>20)continue;
      const g=b.grond(u,v); if(Math.abs(b.grond(u+ru,v)-g)+Math.abs(b.grond(u,v+ru)-g)>ru*1.1)continue;
      nr++;
      let t;
      if(h.soort===1&&st.huis!=="plat"&&st.huis!=="joert")
        /* een schuur: groter, lager, van donker hout */
        t=huis(b,u,v,stijl,{r:h.r,nr,maat:1.15,lang:1.35,aanbouw:false,muur:"#6E5A44",muurMat:"hout"});
      else if(h.soort===2)
        /* een stadshuis: smal en hoog, met de gevel aan de straat */
        t=huis(b,u,v,stijl,{r:h.r,nr,maat:.85,lang:.8,aanbouw:false,verdiepingen:h.lagen});
      else if(h.soort===3)
        /* een pakhuis aan de kade: groot, twee of drie lagen hoog */
        t=huis(b,u,v,stijl,{r:h.r,nr,maat:1.4,lang:1.15,aanbouw:false,verdiepingen:2+(b.r(nr)<.3?1:0)});
      else t=huis(b,u,v,stijl,{r:h.r,nr,verdiepingen:h.lagen>1?h.lagen:undefined});
      b.top=Math.max(b.top,t||0);
    }
    const pl=plan.plein;
    if(pl&&soort===2){
      /* de kerk op de brink */
      if(b.land(pl.x/K,pl.y/K))pleinGebouw(b,stijl,pl.x/K,pl.y/K,a+Math.PI/2);
    }
    if(pl&&soort>=3){
      /* het marktplein met kinderkopjes, de kerk eraan, en op het plein
         kraampjes met gekleurde luifels */
      const ph=pl.hoek??a, c=Math.cos(ph), s=Math.sin(ph), op=(du,dv)=>[(pl.x+du*c-dv*s)/K,(pl.y+du*s+dv*c)/K];
      const [mu0,mv0]=op(0,0);
      if(b.land(mu0,mv0)){
        const g=b.grond(mu0,mv0);
        b.blok(mu0,mv0,pl.b/K,pl.d/K,.25*M,"#9A9282",{r:ph,y:g-.15*M,mat:"kassei",var:.04});
      }
      if(plan.kerk){ const [ku,kv]=[plan.kerk[0]/K,plan.kerk[1]/K]; if(b.land(ku,kv))pleinGebouw(b,stijl,ku,kv,ph); }
      const luifel=["#B5523A","#D8C9A0","#4F6E8E","#C9A24A","#7A8A4E"];
      for(let i=0;i<(soort>=4?14:9);i++){
        const [mu,mv]=op((b.r(200+i)-.5)*(pl.b-10*METER),(b.r(220+i)-.5)*(pl.d-10*METER));
        if(!b.land(mu,mv))continue;
        const g=b.grond(mu,mv);
        b.blok(mu,mv,3*M,2.2*M,1.1*M,"#7A6248",{r:ph,y:g-.005,mat:"hout"});
        b.lessenaar(mu,mv,g+2.3*M,3.6*M,2.8*M,.5*M,luifel[i%5],{r:ph,mat:"vlak"});
      }
    }
    /* buiten een gehucht of dorp graast een kudde op het land */
    if(soort<=2&&st.huis!=="plat"&&b.r(zaad%53+400)<.7){
      const ka=b.r(zaad%53+401)*Math.PI*2, kd=Math.max(.06,plan.straal||.1)/K*1.15;
      kudde(b,Math.cos(ka)*kd,Math.sin(ka)*kd,(14+b.r(zaad%53+402)*14)*M,(9+b.r(zaad%53+403)*8)*M,6+Math.floor(b.r(zaad%53+404)*14),st.huis==="lang"||b.r(zaad%53+405)<.6?"schaap":"koe",ka,zaad%89);
    }
    if(plan.muur&&o.muur!==false)stadsmuur(b,st,plan.muur,o.muur);
    if(o.straten)for(const w of plan.straten)b.weg(w.pts.map(([x,y])=>[x/K,y/K]),w.breed/K,w.soort);
  }
  /* Een naamloze nederzetting (zie nederzettingen() en dorpPlan() in
     3d-grond.js): een boerderij, een gehucht, een dorp met een brink of een
     marktstad met een muur. In de korenlanden soms een molen op het
     hoogste punt in de buurt. */
  function gehucht(plek,stijl){
    const [x,y,soort,zaad,a]=plek;
    const b=rond(x,y,0,zaad%997);
    const st=STIJLEN[stijl]||STIJLEN.araluen;
    if(soort===0)boerderij(b,stijl,zaad%89);
    else bouwPlan(b,dorpPlan(soort,zaad,a),stijl,soort,a,zaad);
    if(soort>0&&(st.huis==="zadel"||st.huis==="steil")&&b.r(9)<(soort>=2?.5:.25)){
      /* de molen: buiten het dorp, op de hoogste plek van een paar kandidaten */
      let best=null; const ver=(soort>=3?.3:soort===2?.18:.1)/K;
      for(let i=0;i<6;i++){ const t=b.r(20+i)*Math.PI*2, d=ver+b.r(30+i)*.12, u=Math.cos(t)*d, v=Math.sin(t)*d; if(!b.land(u,v))continue; const g=b.grond(u,v); if(!best||g>best[2])best=[u,v,g]; }
      if(best)molen(b,best[0],best[1],b.r(40)*Math.PI*2);
    }
  }
  /* De muur om een marktstad: in het zuiden en westen van steen, met torens
     om de zoveel meter en een poort met twee torens waar een hoofdstraat de
     stad in gaat; in het hoge noorden en op de steppe een palissade van
     palen. In stukken van een meter of acht, zodat hij het land volgt. */
  function stadsmuur(b,st,muur,soort){
    const steen=soort?soort==="steen":st.huis!=="lang"&&st.huis!=="plag"&&st.huis!=="joert"&&st.huis!=="japans";
    const kleur=st.steen[0], P=muur.punten, n=P.length;
    const poortBij=(x,y)=>muur.poorten.some(([px,py])=>Math.hypot(px-x,py-y)<9*METER);
    for(let i=0;i<(muur.open?n-1:n);i++){
      const [x0,y0]=P[i], [x1,y1]=P[(i+1)%n], L=Math.hypot(x1-x0,y1-y0), k=Math.max(1,Math.round(L/(8*METER))), r=Math.atan2(y1-y0,x1-x0);
      for(let j=0;j<k;j++){
        const mx=x0+(x1-x0)*(j+.5)/k, my=y0+(y1-y0)*(j+.5)/k; if(poortBij(mx,my))continue;
        const u=mx/K, v=my/K; if(!b.land(u,v))continue;
        const g=b.grond(u,v), l=L/k/K+.3*M;
        if(steen)b.blok(u,v,l,2.4*M,8*M,kleur,{r,y:g-1.5*M,mat:st.steenMat,var:.06});
        else b.stuk("vast",S.blok,u,g-1*M,v,l,4.2*M,.7*M,r,"#5E4A36",{mat:"hout",var:.15});
      }
      /* een toren op elke tweede hoek */
      if(steen&&i%2===0&&!poortBij(x0,y0)&&b.land(x0/K,y0/K))
        b.toren(x0/K,y0/K,3.4*M,11*M,kleur,{dak:"kegel",dakKleur:st.torendak[0],dakH:5*M,mat:st.steenMat,krans:false,plint:false});
      /* bij een palissade houten wachttorens: op de hoeken van een open muur
         (een haven), anders op elke vierde hoek */
      else if(!steen&&(muur.open?i>0:i%4===0)&&!poortBij(x0,y0)&&b.land(x0/K,y0/K)){
        const u=x0/K, v=y0/K, g=b.grond(u,v);
        for(const [du,dv] of [[-1.6,-1.6],[1.6,-1.6],[1.6,1.6],[-1.6,1.6]])b.stuk("vast",S.blok,u+du*M,g-1*M,v+dv*M,.5*M,10*M,.5*M,0,"#5E4A36",{mat:"hout"});
        b.blok(u,v,4.4*M,4.4*M,1.6*M,"#6B5640",{y:g+7.5*M,mat:"hout"});
        b.kegel(u,v,g+9.1*M,3.4*M,2.4*M,"#5A4A38",{vier:true,mat:"hout"});
      }
    }
    for(const [px,py,h] of muur.poorten){
      const c=Math.cos(h+Math.PI/2), s=Math.sin(h+Math.PI/2);
      for(const z of [-1,1]){
        const u=(px+c*z*6.5*METER)/K, v=(py+s*z*6.5*METER)/K; if(!b.land(u,v))continue;
        if(steen)b.toren(u,v,3.8*M,13*M,kleur,{vierkant:true,r:h,dak:"kegel",dakKleur:st.torendak[0],dakH:5.5*M,mat:st.steenMat,krans:false,plint:false});
        else b.stuk("vast",S.blok,u,b.grond(u,v)-1*M,v,3*M,7*M,3*M,h,"#5E4A36",{mat:"hout",var:.1});
      }
    }
  }

  return {opLand,hNorm,rond,huis,dorp,pleinGebouw,stadsmuur,bouwPlan,schip,vloot,steiger,kade,zeeRichting,waterlijn,molen,boerderij,gehucht,kudde,bakken,lampjes,rook,bomen,wegen,S,rivierOp:omg.rivierOp};
}

/* ======================= generieke modellen per soort ======================= */

/* Een kasteel in de stijl van zijn land. Maten in meters (o.breed, o.diep,
   o.muurH…), zoals een echte burcht: een ringmuur van een meter of tien
   hoog met een weergang en kantelen, torens op de hoeken, een poortgebouw,
   een donjon, en binnen de muren een grote zaal, een kapel en schuren tegen
   de muur. De poort kijkt naar lokaal +v. */
function kasteel(B,b,stijl,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  const steen=o.steen||st.steen[Math.floor(b.r(1)*st.steen.length)];
  const dak=o.dak||st.torendak[Math.floor(b.r(2)*st.torendak.length)];
  const sm=o.steenMat||st.steenMat, dm=o.dakMat||st.torendakMat;
  const f=(o.maat||1)*M;
  const hw=(o.breed||72)/2*f, hd=(o.diep||(o.breed||72)*.86)/2*f;
  const mh=(o.muurH||10)*f, dik=3*f, tr=(o.torenR||5)*f;
  const soort=o.soort||st.kasteel;
  const kant=o.kantelen??st.kantelen;
  const hoeken=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  const basis=b.voet(0,0,hw,hd);
  const muurO={kantelen:kant,y:basis-.02,top:basis+mh,mat:sm};
  let hdPoort=null;   /* waar de weg begint, als de poort niet op de zuidmuur zit */
  /* een voet tot onder de grond, zodat het kasteel nergens zweeft */
  const voet=(rad)=>{ if(rad)b.stuk("vast",B.S.cilDicht,0,basis-.4,0,rad,.4-.35*M,rad,0,steen,{mat:sm}); else b.stuk("vast",B.S.blok,0,basis-.4,0,hw*2+dik,.4-.35*M,hd*2+dik,0,steen,{mat:sm}); };
  /* het binnenplein: aangestampte aarde */
  const plein=(rx,rz)=>b.blok(0,0,rx,rz,.7*M,"#9A8E74",{y:basis-.3*M,mat:"aarde",var:0});
  /* een grote zaal of een gebouw tegen de muur */
  const zaal=(u,v,L,D,h,r,muur,dk,dmat,mat)=>{
    const top=b.blok(u,v,L,D,h,muur,{r,y:basis-.01,mat,verd:4.5*f,vloer:basis});
    b.zadel(u,v,top-.2*f,L+.8*f,D+1.2*f,D*.75,dk,{r,mat:dmat,gevel:{kleur:muur,mat,verd:4.5*f}});
    return top+D*.75;
  };
  const schuur=(u,v,L,D,h,r,dk)=>{
    const top=b.blok(u,v,L,D,h,"#9C8266",{r,y:basis-.01,mat:"hout",verd:-1});
    b.lessenaar(u,v,top-.2*f,L+.6*f,D+.8*f,h*.4,dk,{r,mat:"schindel",gevel:{kleur:"#9C8266",mat:"hout"}});
  };
  /* een donjon: hoog en vierkant, met een borstwering en hoektorentjes */
  const donjon=(u,v,w,d,h,o2={})=>{
    const top=b.blok(u,v,w,d,h,steen,{y:basis-.01,mat:sm,verd:5*f,vloer:basis});
    const hw2=w/2, hd2=d/2;
    for(const [u0,v0,u1,v1,nu,nv] of [[-hw2,-hd2,hw2,-hd2,0,-1],[hw2,-hd2,hw2,hd2,1,0],[hw2,hd2,-hw2,hd2,0,1],[-hw2,hd2,-hw2,-hd2,-1,0]])
      b.kantelen(u+u0,v+v0,u+u1,v+v1,top,1.2*f,steen,{buiten:[nu,nv],mat:sm,kantelen:kant});
    if(o2.hoekTorens!==false)for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]])
      b.toren(u+a*w/2,v+c*d/2,2.2*f,h+3*f,steen,{y:basis-.01,dak:o2.dak||"kegel",dakKleur:dak,dakMat:dm,dakH:5*f,mat:sm,plint:false,krans:false});
    if(o2.dakOok)b.pir(u,v,top,w*.9,d*.9,o2.dakOok*f,dak,{mat:dm});
    return top;
  };
  switch(soort){
    case "gallica": {   /* een château: ronde torens met hoge puntige leien spitsen, een woonvleugel met een steil dak */
      voet(); plein(hw*2,hd*2);
      b.ring(hoeken,mh,dik,steen,{...muurO,gat:[2,12*f]});
      for(const [u,v] of hoeken)b.toren(u,v,tr,mh+7*f,steen,{dak:"kegel",dakKleur:dak,dakMat:dm,dakH:tr*3.2,y:basis-.02,mat:sm,ramen:4.5*f});
      const top=zaal(-hw*.1,-hd*.35,hw*1.3,12*f,13*f,0,steen,dak,dm,sm);
      b.toren(hw*.45,-hd*.35,3.4*f,24*f,steen,{dak:"kegel",dakKleur:dak,dakMat:dm,dakH:11*f,vlag:o.vlag||st.vlag,y:basis,mat:sm,ramen:5*f,plint:false});
      b.toren(-hw*.72,-hd*.35+6*f,2.4*f,19*f,steen,{dak:"kegel",dakKleur:dak,dakMat:dm,dakH:8*f,y:basis,mat:sm,plint:false});
      b.poort(0,hd,Math.PI/2,14*f,mh+3*f,steen,dak,{mat:sm});
      schuur(hw*.55,hd*.55,16*f,6*f,4.5*f,Math.PI,"#6A5444");
      b.top=Math.max(b.top,top);
      break;
    }
    case "hibernia": {  /* een ringfort (dun) met een woontoren en een slanke ronde toren */
      const n=18, rr=Math.max(hw,hd)*1.05, pts=[];
      for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; pts.push([Math.cos(a)*rr,Math.sin(a)*rr]); }
      voet(rr+dik); plein(rr*1.4,rr*1.4);
      b.ring(pts,mh*.7,dik,steen,{kantelen:"blok",open:[Math.round(n/4)],mat:sm});
      donjon(-6*f,-5*f,14*f,12*f,19*f,{hoekTorens:false,dakOok:5});
      b.toren(10*f,6*f,2.2*f,26*f,steen,{dak:"kegel",dakKleur:dak,dakMat:dm,dakH:6*f,y:basis,mat:sm,plint:false,krans:false});
      b.vlag(-6*f,-5*f,basis+24*f,5*f,o.vlag||st.vlag);
      for(let i=0;i<3;i++)B.huis(b,(i-1)*13*f+4*f,rr*.55,stijl,{r:0,nr:i+60,maat:.85,aanbouw:false});
      break;
    }
    case "teutlandt": { /* een burcht met vierkante torens en rode piramidedaken, een hoge bergfried */
      voet(); plein(hw*2,hd*2);
      b.ring(hoeken,mh,dik,steen,{...muurO,gat:[2,12*f]});
      for(const [u,v] of hoeken)b.toren(u,v,tr,mh+6*f,steen,{vierkant:true,dak:"kegel",dakKleur:dak,dakMat:dm,dakH:tr*2.6,y:basis-.02,mat:sm,ramen:4.5*f});
      donjon(-hw*.25,-hd*.3,13*f,13*f,30*f,{hoekTorens:false,dakOok:9});
      zaal(hw*.35,-hd*.4,26*f,10*f,9*f,0,st.muur[0],dak,dm,"vakwerk");
      b.poort(0,hd,Math.PI/2,13*f,mh+3*f,steen,dak,{mat:sm});
      break;
    }
    case "toscana": {   /* rocca: vierkante torens, zwaluwstaartkantelen, een hoge campanile */
      voet(); plein(hw*2,hd*2);
      b.ring(hoeken,mh,dik,steen,{...muurO,gat:[2,12*f]});
      for(const [u,v] of hoeken)b.toren(u,v,tr,mh+5*f,steen,{vierkant:true,dak:"plat",y:basis-.02,mat:sm,kantelen:kant});
      const top=b.blok(-hw*.3,-hd*.3,24*f,16*f,13*f,st.muur[0],{y:basis,mat:"pleister",verd:4.5*f,vloer:basis});
      b.schild(-hw*.3,-hd*.3,top-.2*f,25*f,17*f,3.5*f,st.dak[0],{mat:"pannen"});
      b.toren(hw*.4,-hd*.45,3.4*f,34*f,steen,{vierkant:true,dak:"plat",vlag:o.vlag||st.vlag,y:basis,mat:sm,kantelen:kant,plint:false});
      b.poort(0,hd,Math.PI/2,13*f,mh+3*f,steen,null,{mat:sm,kantelen:kant});
      break;
    }
    case "arrida": {    /* kasba: dikke leemmuren, taps toelopende torens, driehoekige kantelen */
      voet(); plein(hw*2,hd*2);
      b.ring(hoeken,mh*1.15,dik*1.4,steen,{kantelen:"driehoek",y:basis-.02,top:basis+mh*1.15,mat:"leem",gat:[2,12*f]});
      for(const [u,v] of hoeken){
        b.stuk("vast",B.S.afgeknot4,u,basis-.02,v,tr*2.6,mh*1.15+6*f,tr*2.6,0,steen,{mat:"leem"});
        b.kantelen(u-tr,v+tr,u+tr,v+tr,basis-.02+mh*1.15+6*f,1*f,steen,{kantelen:"driehoek",buiten:[0,1],mat:"leem"});
        b.kantelen(u-tr,v-tr,u+tr,v-tr,basis-.02+mh*1.15+6*f,1*f,steen,{kantelen:"driehoek",buiten:[0,-1],mat:"leem"});
      }
      const top=b.blok(-hw*.2,-hd*.25,26*f,20*f,11*f,st.muur[4]||steen,{y:basis,mat:"leem",verd:4*f,vloer:basis});
      b.koepel(-hw*.2,-hd*.25,top,7*f,6.5*f,st.torendak[1]||st.torendak[0],{mat:"pleister"});
      b.toren(hw*.45,hd*.2,1.6*f,30*f,st.muur[2],{dak:"koepel",dakKleur:st.torendak[0],dakMat:"pleister",y:basis,mat:"leem",plint:false,krans:true});
      b.poort(0,hd,Math.PI/2,14*f,mh*1.15+3*f,steen,null,{mat:"leem",kantelen:"driehoek"});
      break;
    }
    case "nihon": {     /* een Japanse burcht: schuine stenen voet, witte muren, een getrapte toren */
      voet();
      b.ring(hoeken,mh*.6,dik*.8,"#E6E1D6",{kantelen:null,y:basis-.02,top:basis+mh*.6,mat:"pleister"});
      for(let i=0;i<4;i++){ const [u0,v0]=hoeken[i],[u1,v1]=hoeken[(i+1)%4]; b.stuk("vast",B.S.zadel,(u0+u1)/2,basis+mh*.6-.1*f,(v0+v1)/2,Math.hypot(u1-u0,v1-v0),1.4*f,dik*1.6,Math.atan2(v1-v0,u1-u0),"#45494C",{mat:"lei"}); }
      b.stuk("vast",B.S.afgeknot4,0,basis-.02,-4*f,34*f,8*f,30*f,0,"#979287",{mat:"breuk"});
      let y=basis+8*f;
      for(let i=0;i<5;i++){
        const s=1-i*.16;
        b.blok(0,-4*f,22*s*f,19*s*f,5.4*f,"#ECE8DE",{y,mat:"pleister",verd:2.7*f,vloer:y});
        b.pagode(0,-4*f,y+5*f,30*s*f,27*s*f,4.4*f,"#45494C",{mat:"lei"});
        y+=6.6*f;
      }
      b.stuk("vast",B.S.blok,0,y-2*f,-4*f,.5*f,4*f,6*f,0,"#C9A94A");   /* de gouden vissen op de nok */
      b.lamp(0,y-6*f,-4*f);
      for(const [u,v] of [[-hw,-hd],[hw,hd]])b.toren(u,v,4*f,mh*.6+5*f,"#ECE8DE",{vierkant:true,dak:"pagode",dakKleur:"#45494C",dakMat:"lei",lagen:1,y:basis,mat:"pleister",plint:false,krans:false});
      b.top=Math.max(b.top,y);
      break;
    }
    case "skandia": {   /* een houten hal achter een palissade van puntige palen */
      const pts=[]; for(let i=0;i<20;i++){ const a=i/20*Math.PI*2; pts.push([Math.cos(a)*hw,Math.sin(a)*hd*.85]); }
      for(let i=0;i<pts.length;i++){ const [u0,v0]=pts[i],[u1,v1]=pts[(i+1)%pts.length];
        for(let k=0;k<6;k++){ const t=k/6, u=u0+(u1-u0)*t, v=v0+(v1-v0)*t; const top=b.cil(u,v,.35*f,5*f+b.r(i*7+k)*f,"#6B5038",{zes:true,mat:"hout"}); b.kegel(u,v,top,.36*f,.9*f,"#5A4430",{zes:true}); } }
      B.huis(b,0,0,"skandia",{maat:2,r:0,nr:3,aanbouw:false});
      break;
    }
    case "broch": {     /* een broch: een ronde, taps toelopende toren van droge steen */
      b.stuk("vast",B.S.afgeknot,0,basis-.02,0,8*f,13*f,8*f,0,steen,{mat:"breuk"});
      b.cil(0,0,6.8*f,1*f,"#5E5A52",{y:basis+12.6*f,mat:"breuk"});
      for(let i=0;i<5;i++){ const a=i/5*Math.PI*2+.4; B.huis(b,Math.cos(a)*24*f,Math.sin(a)*24*f,"picta",{r:a+Math.PI/2,nr:i,aanbouw:false}); }
      b.straal=30*f;
      return;
    }
    default: {          /* Araluen: ringmuur met torens, een donjon, de grote zaal */
      /* Zodat niet elk leen hetzelfde kasteel heeft: een keuze uit
         plattegronden (o.plan), torens (o.torenVorm, o.torenDak), de
         donjon (o.donjon) en een voorburcht voor de poort (o.voorburcht).
         Zonder keuze: vierkant, ronde torens met een platte top en kantelen
         (zoals de Engelse burchten waar Araluen op lijkt), vierkante donjon.
         De poort zit altijd midden in de zijde tussen punt 2 en 3 (het
         zuiden van het model), zodat de weg er recht uit loopt. */
      const plan=o.plan||"vierkant", tv=o.torenVorm||"rond", td=o.torenDak||"plat", dj=o.donjon||"vierkant";
      let pts;
      if(plan==="lang")pts=[[-hw*1.3,-hd*.62],[hw*1.3,-hd*.62],[hw*1.3,hd*.62],[-hw*1.3,hd*.62]];
      else if(plan==="veelhoek")pts=[[-hw*.85,-hd*.95],[hw*.95,-hd*.6],[hw*.75,hd],[-hw*.8,hd],[-hw*1.05,hd*.05]];
      else if(plan==="rond"){ const n=10, rr=Math.max(hw,hd)*.95; pts=[]; for(let i=0;i<n;i++){ const a=Math.PI/2+(i-2.5)*Math.PI*2/n; pts.push([Math.cos(a)*rr,Math.sin(a)*rr]); } }
      else pts=hoeken;
      const gu=(pts[2][0]+pts[3][0])/2, gv=(pts[2][1]+pts[3][1])/2;
      voet(plan==="rond"?Math.max(hw,hd)+dik:0); plein(hw*(plan==="lang"?2.5:2),hd*(plan==="lang"?1.3:2));
      b.ring(pts,mh,dik,steen,{...muurO,gat:[2,12*f]});
      const kleinT=plan==="rond"?tr*.75:tr;
      for(const [u,v] of pts)b.toren(u,v,kleinT,mh+6*f,steen,{vierkant:tv==="vierkant",dak:td,dakKleur:dak,dakMat:dm,dakH:kleinT*(tv==="vierkant"?2:2.3),y:basis-.02,mat:sm,ramen:4.5*f,kantelen:td==="plat"?kant:undefined});
      /* torens halverwege de lange muren */
      if(plan==="vierkant"&&hw>30*f)for(const [u,v] of [[0,-hd],[-hw,0],[hw,0]])b.toren(u,v,tr*.8,mh+3*f,steen,{vierkant:tv==="vierkant",dak:"plat",y:basis-.02,mat:sm});
      if(plan==="lang")for(const u of [-hw*.45,hw*.45])b.toren(u,-hd*.62,tr*.8,mh+3*f,steen,{vierkant:tv==="vierkant",dak:"plat",y:basis-.02,mat:sm});
      const dH=(o.donjonH||24)*f;
      let top, du=-hw*.3, dv=-hd*.28;
      if(plan==="lang"){ du=-hw*.75; dv=-hd*.05; }
      if(plan==="rond"){ du=0; dv=-hd*.15; }
      if(dj==="rond"){
        /* een ronde donjon: een zware toren met een borstwering */
        top=b.toren(du,dv,9.5*f,dH+4*f,steen,{dak:td==="kegel"?"kegel":"plat",dakKleur:dak,dakMat:dm,dakH:9*f,y:basis-.01,mat:sm,ramen:5*f,kantelen:kant,vlag:o.vlag||st.vlag});
      }else if(dj==="zaal"){
        /* geen donjon maar een grote zaal, met een slanke toren ernaast */
        top=zaal(du+4*f,dv,26*f,13*f,12*f,0,steen,dak,dm,sm);
        b.toren(du-11*f,dv+5*f,3.4*f,dH+6*f,steen,{vierkant:tv==="vierkant",dak:"kegel",dakKleur:dak,dakMat:dm,dakH:8*f,vlag:o.vlag||st.vlag,y:basis,mat:sm,plint:false,ramen:5*f});
      }else{
        top=donjon(du,dv,20*f,17*f,dH,{dakOok:4});
        b.toren(du+7*f,dv+6*f,3*f,dH+9*f,steen,{dak:"kegel",dakKleur:dak,dakMat:dm,dakH:7*f,vlag:o.vlag||st.vlag,y:basis,mat:sm,plint:false,ramen:5*f});
      }
      if(dj!=="zaal"){
        if(plan==="lang")zaal(hw*.35,-hd*.05,40*f,11*f,9*f,0,steen,dak,dm,sm);
        else if(plan!=="rond")zaal(hw*.5,-hd*.1,hd*1.05,11*f,9*f,Math.PI/2,steen,dak,dm,sm);
      }
      schuur(plan==="lang"?hw*.9:-hw*.55,plan==="lang"?hd*.3:hd*.6,18*f,5.5*f,4*f,Math.PI,"#6A5444");
      b.poort(gu,gv,Math.PI/2,14*f,mh+3*f,steen,dak,{mat:sm});
      /* een voorburcht: een lagere tweede ring voor de poort, met een
         eigen poortje */
      if(o.voorburcht){
        const bu=hw*.6, bv=gv+28*f, vp=[[bu,gv],[bu,bv],[-bu,bv],[-bu,gv]];
        b.ring(vp,mh*.65,dik*.8,steen,{...muurO,top:basis+mh*.65,open:[3],gat:[1,10*f]});
        for(const [u,v] of [vp[1],vp[2]])b.toren(u,v,tr*.7,mh*.65+4*f,steen,{vierkant:tv==="vierkant",dak:"plat",y:basis-.02,mat:sm,kantelen:kant});
        b.poort(0,bv,Math.PI/2,10*f,mh*.65+2*f,steen,null,{mat:sm,kantelen:kant});
        schuur(-bu*.45,gv+12*f,16*f,5*f,3.5*f,0,"#6A5444");
      }
      b.top=Math.max(b.top,top);
      hdPoort=gv+(o.voorburcht?28*f:0);
    }
  }
  /* de weg van de poort naar buiten */
  const hp=hdPoort??hd;
  b.weg([[0,hp+4*f],[0,hp+40*f],[o.wegNaar?o.wegNaar[0]:(b.r(7)-.5)*hw,o.wegNaar?o.wegNaar[1]:hp+90*f]],4.5*M,0);
  b.lamp(0,basis+mh+2*f,hp+3*f); b.lamp(-hw*.3,basis+18*f,-hd*.28);
  b.straal=Math.max(hw,hd)*1.35;
}

/* Een stad of dorp met een naam op de kaart: uitgezet zoals de naamloze
   (zie dorpPlan), maar met een vast zaad uit de naam en met de straten
   erbij. o.soort: 2 dorp, 3 marktstad, 4 grote stad (anders naar o.aantal). */
function stad(B,b,stijl,o={}){
  const soort=o.soort||((o.aantal||22)>=60?4:(o.aantal||22)>=28?3:(o.aantal||22)>=10?2:1);
  const zaad=o.zaad??(Math.abs(Math.round(b.cx*131+b.cy*71))%100000);
  const a=o.richting??b.r(1)*Math.PI*2;
  const plan=dorpPlan(soort,zaad,a,o.vrij);
  B.bouwPlan(b,plan,stijl,soort,a,zaad,{straten:true,muur:o.muur});
  b.straal=Math.max(b.straal,plan.straal/K*.8);
  return plan;
}

/* Een haven: de stad langs de echte waterlijn. Eerst de kust zelf: vanaf
   de plaats naar zee tot het water, en twee keer een stuk ernaast, voor de
   richting van de kust. Langs die lijn ligt de kade met de pakhuizen, het
   land in de straten (havenPlan in 3d-grond.js); vanaf de kade steken de
   steigers het water in, met de schepen eraan afgemeerd, en wat verder
   liggen er een paar voor anker. o: huizen (of aantal), muur ("steen" of
   "palissade"), steigers, schepen, schip (soort), vloot (opties). */
function haven(B,b,stijl,p,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  const a=B.zeeRichting(b.cx,b.cy,2.2)??B.zeeRichting(b.cx,b.cy,5);
  if(a==null){ stad(B,b,stijl,o); return; }
  const huizen=o.huizen||Math.round(Math.min(300,Math.max(25,(o.aantal||24)*4)));
  const lengte=o.lengte||Math.round(150+huizen*1.1), diepte=o.diepte||Math.round(80+huizen*.45);
  /* een punt op de waterlijn: vanaf (x, y) wat landinwaarts, dan richting zee */
  const opKust=(x,y,dx,dy)=>{
    let t=-.6; while(t>-1.5&&B.hNorm(x+dx*t,y+dy*t)<0)t-=.02;
    while(t<4&&B.hNorm(x+dx*t,y+dy*t)>=0)t+=.004;
    return [x+dx*t,y+dy*t];
  };
  const zx=Math.cos(a), zy=Math.sin(a);
  const C=opKust(b.cx,b.cy,zx,zy);
  const s=lengte*.4*METER;
  const P1=opKust(C[0]-zy*s,C[1]+zx*s,zx,zy), P2=opKust(C[0]+zy*s,C[1]-zx*s,zx,zy);
  let tx=P1[0]-P2[0], ty=P1[1]-P2[1]; const tl=Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
  /* landinwaarts is links van de kustrichting */
  if(-ty*zx+tx*zy>0){ tx=-tx; ty=-ty; }
  const nx=-ty, ny=tx, hoek=Math.atan2(ty,tx);
  /* hoe ver de waterlijn landinwaarts ligt, per tien meter langs de kust */
  const vcache=new Map();
  const kust=u=>{
    const k=Math.round(u/10), f=u/10-k;
    const lees=k=>{
      if(vcache.has(k))return vcache.get(k);
      const qx=C[0]+tx*k*10*METER, qy=C[1]+ty*k*10*METER;
      let v=200; while(v>-200&&B.hNorm(qx+nx*v*METER,qy+ny*v*METER)<0)v-=3;
      while(v>-200&&B.hNorm(qx+nx*v*METER,qy+ny*v*METER)>=0)v-=3;
      vcache.set(k,v+1.5); return v+1.5;
    };
    return f>=0?lees(k)+(lees(k+1)-lees(k))*f:lees(k)+(lees(k)-lees(k-1))*f;
  };
  const zaad=Math.abs(Math.round(b.cx*131+b.cy*71))%100000;
  const ns=o.steigers??(huizen>150?4:huizen>60?3:2);
  const plan=havenPlan(zaad,kust,{huizen,lengte,diepte,steigers:ns,muur:o.muur,vrij:o.vrij},hoek);
  const c=B.rond(C[0],C[1],0,zaad%997);
  B.bouwPlan(c,plan,stijl,huizen>150?4:3,hoek,zaad,{straten:true,muur:o.muur});
  /* de kade: een stenen rand langs de waterlijn, met bolders */
  const kp=plan.kade, kk=o.kade||"#8E887C";
  for(let i=1;i<kp.length;i++){
    const [x0,y0]=kp[i-1], [x1,y1]=kp[i], u=(x0+x1)/2/K, v=(y0+y1)/2/K, l=Math.hypot(x1-x0,y1-y0)/K+.3*M;
    const g=Math.max(.03,c.grond(u-nx*4*M,v-ny*4*M));
    c.blok(u,v,l,5*M,g+.15,kk,{r:Math.atan2(y1-y0,x1-x0),y:-.15,mat:"steen",var:.05});
    if(i%2)c.cil(u,v,.35*M,.8*M,"#3E3830",{y:g});
  }
  /* de steigers met schepen eraan, en verderop wat schepen voor anker */
  const soorten=Array.isArray(o.schip)?o.schip:[o.schip||st.schip];
  let k=0;
  for(const [x,y,h] of plan.steigers){
    const lang=(38+c.r(300+k)*30)*M;
    const [ex,ey]=B.steiger(c,C[0]+x,C[1]+y,h,lang);
    /* aan weerskanten van de steiger een schip, langszij */
    for(const z of [-1,1]){
      if(c.r(320+k*3+(z>0?1:0))<.3)continue;
      const f=.45+c.r(340+k)*.3, px=C[0]+x+(ex-C[0]-x)*f+Math.cos(h+Math.PI/2)*z*9*METER, py=C[1]+y+(ey-C[1]-y)*f+Math.sin(h+Math.PI/2)*z*9*METER;
      if(B.hNorm(px,py)<-.003)B.schip(soorten[(k+(z>0?1:0))%soorten.length],px,py,h,zaad+k*7+(z>0?3:0),o.vloot||{});
    }
    k++;
  }
  const anker=Math.max(0,(o.schepen??3)-ns);
  if(anker)B.vloot(C[0],C[1],a,soorten.length>1?soorten:soorten[0],anker,zaad%999,{richting:hoek,van:.9,tot:1.2,...(o.vloot||{})});
  b.top=Math.max(b.top,c.top); b.straal=Math.max(b.straal,plan.straal/K*.8);
  /* het midden van de stad: niet de plek op de kaart (die ligt vaak wat
     landinwaarts), maar halverwege de huizen, vanaf de waterlijn gemeten.
     Daar komen in 3D het naambordje en de ring van de gekozen plaats. */
  b.midden=[C[0]+nx*(kust(0)+diepte*.5)*METER,C[1]+ny*(kust(0)+diepte*.5)*METER];
  /* een plek in het plan (u langs de kust, v landinwaarts vanaf de
     waterlijn, in meters) in de maat van c */
  const lokaal=(u,v)=>{ const vv=v+kust(u); return [(tx*u+nx*vv)*METER/K,(ty*u+ny*vv)*METER/K]; };
  return {C,a,hoek,c,lokaal,lengte,diepte,zee:[-nx,-ny]};
}

function ruine(B,b,stijl,o={}){
  const steen=o.steen||"#8F8A7A", f=M, hw=(o.breed||64)*f/2;
  const basis=b.voet(0,0,hw*.6,hw*.6);
  /* afgebrokkelde muren: stukken van ongelijke hoogte, met gaten */
  const hoeken=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
  for(let i=0;i<4;i++){
    const [u0,v0]=hoeken[i], [u1,v1]=hoeken[(i+1)%4];
    for(let k=0;k<6;k++){
      if(b.r(i*9+k)<.3)continue;
      const t0=k/6, t1=(k+1)/6-.02;
      b.muur(u0+(u1-u0)*t0,v0+(v1-v0)*t0,u0+(u1-u0)*t1,v0+(v1-v0)*t1,(2+b.r(i*5+k)*7)*f,2.6*f,steen,{kantelen:null,mat:"breuk",var:.15});
    }
  }
  /* de stomp van de donjon, en half ingestorte torens */
  b.blok(-hw*.3,-hw*.3,18*f,15*f,(6+b.r(30)*7)*f,steen,{y:basis-.02,mat:"breuk"});
  b.cil(hw,-hw,5*f,15*f,steen,{mat:"breuk",open:true});
  b.cil(-hw,hw,4.5*f,7*f,steen,{mat:"breuk"});
  b.cil(hw,hw,4.5*f,3.5*f,steen,{mat:"breuk"});
  /* puin */
  for(let i=0;i<22;i++){ const u=(b.r(40+i)-.5)*hw*2.6, v=(b.r(60+i)-.5)*hw*2.6; b.rots(u,v,(1.2+b.r(80+i)*1.8)*f,o.puin||"#86806F"); }
  b.straal=hw*1.4;
}

function slagveld(B,b,stijl,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  /* een gedenksteen, de tenten van het kamp, vlaggen */
  const g=b.voet(0,0,2*M,2*M);
  b.blok(0,0,2.4*M,1.6*M,6*M,"#A7A190",{y:g-.02,mat:"steen"});
  b.pir(0,0,g+5.9*M,2.4*M,1.6*M,1.4*M,"#A7A190",{mat:"steen"});
  for(let i=0;i<(o.tenten??8);i++){ const a=b.r(i+20)*Math.PI*2, d=.12+b.r(i+25)*.25; b.tent(Math.cos(a)*d,Math.sin(a)*d,2.4*M,3.4*M,["#E2D8BE","#D9CFB4","#CDBF9F"][i%3],{vlag:i%3?null:o.vlag||st.vlag}); }
  for(let i=0;i<5;i++){ const a=b.r(i)*Math.PI*2, d=.06+b.r(i+5)*.18; b.vlag(Math.cos(a)*d,Math.sin(a)*d,b.grond(Math.cos(a)*d,Math.sin(a)*d),8*M,(o.vlaggen||["#8E2B2B","#2B4C7E","#C9A94A"])[i%3]); }
  b.straal=.45;
}

/* ======================= de plaatsen zelf =======================
   Per plaats: wat de boeken zeggen, en hoe dat hier gebouwd wordt. info
   zegt wat de grond eronder moet doen (3d-grond.js): hoe breed hij vlak
   wordt (vlak: [binnen, buiten, kracht]), hoe groot de open plek in het bos
   eromheen is (open), en of er een klif, kloof of meer ligt. */
/* Een leen van Araluen: het kasteel van de baron, en het dorp van het leen
   ernaast (o.dorp: waar, in modelmaat). Op een heuvel als o.heuvel. De
   vorm van het kasteel (plan, torens, donjon, voorburcht, dak) verschilt
   per leen; zie kasteel(). */
function leen(o){
  return {info:{vlak:[.45,1,1],open:1.1,...(o.heuvel?{heuvel:o.heuvel}:{})},bouw(B,b,p){
    kasteel(B,b,"araluen",{breed:o.breed,steen:o.steen,plan:o.plan,torenVorm:o.torenVorm,torenDak:o.torenDak,donjon:o.donjon,voorburcht:o.voorburcht,dak:o.dak});
    if(o.dorp){ const d=B.rond(...b.naast(o.dorp[0],o.dorp[1]),0,(o.breed*7)|0); stad(B,d,"araluen",{soort:2,zaad:o.breed*13}); }
  }};
}
/* een dorp of stadje van de kaart, in zijn eigen maat: 1 gehucht, 2 dorp, 3 marktstad */
function dorpje(soort,zaad,stijl){
  return {info:{vlak:[.3,.7,.6],open:soort>=3?1:.7},bouw(B,b,p,st){ stad(B,b,stijl||st,{soort,zaad}); }};
}
export const BOUWERS={
  /* Kasteel Redmont — "het rode kasteel van baron Arald": rode zandsteen,
     op de heuvel boven Wensley, met een Krijgsschool op het binnenplein. Even
     buiten de muren, aan de rand van het bos, de hut van de Grijze Jager. */
  redmont:{info:{vlak:[.45,1,1],open:1.1,heuvel:{r:.9,hoogte:.008}},
  /* driehoekig, met de poort naar het westen */
  draai:()=>Math.PI/2,
  bouw(B,b,p,stijl,POS){
    /* Kasteel Redmont: een driehoek van drie muren met drie ronde torens op
       de hoeken, boven op een heuvel. Gebouwd van ijzersteen, dat bij
       zonsopgang en -ondergang rood gloeit (vandaar de naam). Binnen de
       muren het plein en de donjon, met de vertrekken van baron Arald en zijn
       officieren; drie slaapzalen en een klein paradeplein. */
    const rood="#8C6452", dak="#66686B", f=M, R=66*f, mh=13*f, dik=4*f;
    const hoek=[Math.PI/6,Math.PI*5/6,-Math.PI/2], pts=hoek.map(a=>[Math.cos(a)*R,Math.sin(a)*R]);
    const basis=b.voet(0,0,R*.75,R*.75);
    b.stuk("vast",B.S.cilDicht,0,basis-.4,0,R*.62,.4-.35*M,R*.62,0,rood,{mat:"steen"});
    b.cil(0,0,R*.48,.7*M,"#9A8E74",{y:basis-.3*M,mat:"aarde"});
    b.ring(pts,mh,dik,rood,{kantelen:"blok",y:basis-.02,top:basis+mh,mat:"steen",gat:[0,13*f]});
    for(const [u,v] of pts){ b.stuk("vast",B.S.cilDicht,u,basis-.4,v,10*f,.4-.35*M,10*f,0,rood,{mat:"steen"}); b.toren(u,v,9*f,mh+13*f,rood,{dak:"kegel",dakKleur:dak,dakMat:"lei",dakH:13*f,y:basis-.02,mat:"steen",ramen:4.5*f}); }
    b.poort(0,R/2,Math.PI/2,15*f,mh+4*f,rood,dak,{mat:"steen"});
    /* de donjon: zwaar en vierkant, met torentjes op de hoeken */
    const dw=26*f, dd=23*f, dh=34*f, dv=-8*f;
    const dtop=b.blok(0,dv,dw,dd,dh,rood,{y:basis-.01,mat:"steen",verd:5*f,vloer:basis});
    for(const [u0,v0,u1,v1,nu,nv] of [[-dw/2,dv-dd/2,dw/2,dv-dd/2,0,-1],[dw/2,dv-dd/2,dw/2,dv+dd/2,1,0],[dw/2,dv+dd/2,-dw/2,dv+dd/2,0,1],[-dw/2,dv+dd/2,-dw/2,dv-dd/2,-1,0]])
      b.kantelen(u0,v0,u1,v1,dtop,1.2*f,rood,{buiten:[nu,nv],mat:"steen",kantelen:"blok"});
    for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]])b.toren(a*dw/2,dv+c*dd/2,2.6*f,dh+4*f,rood,{y:basis-.01,dak:"plat",mat:"steen",plint:false});
    b.toren(dw/2-4*f,dv-dd/2+4*f,3*f,dh+12*f,rood,{dak:"kegel",dakKleur:dak,dakMat:"lei",dakH:7*f,vlag:"#8E2B2B",y:basis,mat:"steen",plint:false,ramen:5*f});
    b.top=Math.max(b.top,dtop+12*f);
    /* de slaapzalen: langs de twee muren zonder poort, en een achter de donjon */
    for(const [i0,i1] of [[1,2],[2,0]]){
      const [u0,v0]=pts[i0],[u1,v1]=pts[i1], mu=(u0+u1)/2, mv=(v0+v1)/2, l=Math.hypot(u1-u0,v1-v0), r=Math.atan2(v1-v0,u1-u0);
      const nu=-mu/Math.hypot(mu,mv), nv=-mv/Math.hypot(mu,mv), cu=mu+nu*(dik/2+5.5*f), cv=mv+nv*(dik/2+5.5*f);
      const t=b.blok(cu,cv,l*.42,9*f,7*f,rood,{r,y:basis-.01,mat:"steen",verd:3.5*f,vloer:basis});
      b.zadel(cu,cv,t-.2*f,l*.42+.8*f,10*f,5*f,dak,{r,mat:"lei",gevel:{kleur:rood,mat:"steen"}});
    }
    { const t=b.blok(0,-R*.62,30*f,8*f,7*f,rood,{y:basis-.01,mat:"steen",verd:3.5*f,vloer:basis});
      b.zadel(0,-R*.62,t-.2*f,30.8*f,9*f,4.5*f,dak,{mat:"lei",gevel:{kleur:rood,mat:"steen"}}); }
    /* het paradeplein voor de poort, binnen de muren */
    b.blok(0,R*.25,22*f,10*f,.3*M,"#B7AD94",{y:basis-.2*M,mat:"kassei",var:0});
    b.weg([[0,R/2+4*f],[0,R/2+50*f],[(b.r(7)-.5)*30*f,R/2+120*f]],4.5*M,0);
    b.lamp(0,basis+mh+2*f,R/2+3*f); b.lamp(0,dtop+2*f,dv);
    b.straal=R*1.4;
    /* de oefenplaats van de Krijgsschool: een omheind veld met staken */
    const c=B.rond(...b.naast(-.42,-.1),0,3), g=c.grond(0,0);
    c.blok(0,0,30*M,18*M,.2*M,"#A2946E",{y:g-.1*M,mat:"aarde",var:0});
    for(let i=0;i<8;i++){ const u=(i-3.5)*4*M; c.cil(u,9*M,.18*M,1.6*M,"#6B5138",{zes:true}); c.cil(u,-9*M,.18*M,1.6*M,"#6B5138",{zes:true}); }
    for(let i=0;i<4;i++)c.cil((i-1.5)*6*M,0,.3*M,2*M,"#5E4A38",{zes:true});
    /* de hut van Halt, aan de bosrand richting het Westwoud */
    const h=B.rond(...b.naast(-.55,+.45),-.4,4), hg=h.kruin(0,0,4*M,3*M);
    const top=h.blok(0,0,8*M,5.5*M,3*M,"#7A5E44",{mat:"hout",vloer:hg});
    h.zadel(0,0,top-.2*M,9*M,6.6*M,3.4*M,"#7E6E4E",{mat:"riet",gevel:{kleur:"#7A5E44",mat:"hout"}});
    h.blok(3*M,0,1*M,1*M,6.6*M,"#857B6C",{mat:"breuk",y:hg-.005});
    h.blok(-5.2*M,1*M,2.4*M,1.6*M,1*M,"#6B5138",{mat:"hout",r:.2});   /* houtstapel */
    h.lamp(0,top+.01,0);
    b.weg([[0,.3],[0,.95]],4.5*M,0);
  }},
  /* Wensley — het dorp onder aan de heuvel: herberg, markt, akkers */
  wensley:{info:{vlak:[.3,.7,.5],open:1.2},bouw(B,b,p,stijl,POS){
    const naar=POS.redmont?Math.atan2(POS.redmont[1]-b.cy,POS.redmont[0]-b.cx)-b.rot:0;
    stad(B,b,"araluen",{soort:2,richting:naar+b.rot,zaad:401});
  }},
  /* Kasteel Araluen — de koninklijke burcht: slanke witte torens,
     uitgestrekte tuinen, de zetel van koning Duncan */
  /* Kasteel Araluen — de hoofdstad en de zetel van koning Duncan. Wat de
     boeken zeggen: enorme blokken honingkleurige hardsteen, zware torens en
     steunberen met een bijna levende gratie; het zwaarst verdedigde kasteel
     van het rijk, met massieve muren en hoge torens vanwaar verdedigers
     water, kokende olie, pijlen en stenen op aanvallers konden gooien, en
     smalle pijlspleten; een enorme ophaalbrug met een groot mechaniek en een
     valhek; de donjon midden op het plein; een hoge zuidtoren (waar Duncan
     en Cassandra opgesloten zaten); een troonzaal voor honderden hovelingen;
     en een dorp eromheen, waar de Semath doorheen stroomt. */
  "kasteel-araluen":{info:{vlak:[.9,1.8,1],open:3.2},bouw(B,b){
    const steen="#CDB27E", lei="#6C6E72", f=M, hw=80*f, hd=68*f, mh=18*f, dik=5*f;
    const basis=b.voet(0,0,hw+30*f,hd+30*f);
    /* de voet en het plein */
    b.stuk("vast",B.S.blok,0,basis-.4,0,hw*2+8*f,.4-.35*M,hd*2+8*f,0,steen,{mat:"steen"});
    b.blok(0,0,hw*2,hd*2,.7*M,"#9A9282",{y:basis-.3*M,mat:"kassei",var:0});
    /* de gracht: een band water rondom, op ~12 m van de muur */
    const gr=14*f, gw=12*f;
    for(const [u,v,L,W] of [[0,-(hd+gr),2*(hw+gr+gw/2),gw],[0,hd+gr,2*(hw+gr+gw/2),gw],[-(hw+gr),0,gw,2*(hd+gr-gw/2)],[hw+gr,0,gw,2*(hd+gr-gw/2)]]){
      /* het water net boven de grond (niet erop: dan flikkert het), met aan
         beide kanten een lage rand van breuksteen */
      b.stuk("plas",B.S.blok,u,basis+.35*f,v,L,.01*f,W,0,"#45656E",{var:0});
      const lang=L>W, rL=lang?L+2*f:1.2*f, rW=lang?1.2*f:W+2*f;
      for(const z of [-1,1])b.stuk("vast",B.S.blok,u+(lang?0:z*(W/2+.6*f)),basis-.3*f,v+(lang?z*(W/2+.6*f):0),lang?rL:1.2*f,1.1*f,lang?1.2*f:rW,0,"#7A7462",{mat:"breuk"});
    }
    /* de ringmuur: hoog en dik, met de poort op het zuiden */
    const hoeken=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
    b.ring(hoeken,mh,dik,steen,{y:basis-.02,top:basis+mh,mat:"steen",kantelen:"blok",gat:[2,16*f]});
    /* de uitkragende rand bovenop (vanwaar olie en stenen naar beneden gingen) */
    b.ring(hoeken,1.8*f,dik+2.2*f,steen,{y:basis+mh-2.6*f,top:basis+mh-.8*f,mat:"steen",kantelen:null,gat:[2,16*f]});
    /* steunberen: elke ~16 m een zware beer tegen de buitenkant van de muur */
    for(let i=0;i<4;i++){
      const [u0,v0]=hoeken[i],[u1,v1]=hoeken[(i+1)%4], L=Math.hypot(u1-u0,v1-v0), n=Math.floor(L/(16*f));
      const tu=(u1-u0)/L, tv=(v1-v0)/L, nu=tv, nv=-tu, r=Math.atan2(v1-v0,u1-u0);
      for(let k=1;k<n;k++){
        const t=k/n; if(i===2&&Math.abs(t-.5)<.14)continue;
        const u=u0+(u1-u0)*t+nu*(dik/2+1.4*f), v=v0+(v1-v0)*t+nv*(dik/2+1.4*f);
        b.stuk("vast",B.S.afgeknot4,u,basis-.02,v,3.4*f,mh*.78,2.8*f,-r,steen,{mat:"steen"});
      }
    }
    /* zware ronde hoektorens met een ingetogen spits, en halfronde
       tussentorens met kantelen */
    for(const [u,v] of hoeken)b.toren(u,v,9.5*f,mh+15*f,steen,{dak:"kegel",dakKleur:lei,dakMat:"lei",dakH:17*f,overstek:1.1,y:basis-.02,mat:"steen",ramen:5*f});
    for(const [u,v] of [[0,-hd],[-hw,0],[hw,0],[-hw*.5,-hd],[hw*.5,-hd],[-hw*.5,hd],[hw*.5,hd]])
      b.toren(u,v,6.5*f,mh+6*f,steen,{dak:"plat",y:basis-.02,mat:"steen",kantelen:"blok"});
    /* het poortgebouw met valhek, en de ophaalbrug over de gracht */
    b.poort(0,hd,Math.PI/2,20*f,mh+8*f,steen,lei,{mat:"steen"});
    b.blok(0,hd+gr,7*f,gw+6*f,.8*f,"#5E4A36",{y:basis-.1*f,mat:"hout",var:.05});
    for(const z of [-1,1])b.blok(z*3.4*f,hd+gr,.5*f,gw+6*f,1.2*f,"#4E3E2E",{y:basis+.6*f,mat:"hout"});
    /* de donjon midden op het plein: zwaar en vierkant, met hoektorens */
    const kw=34*f, kd=30*f, kh=38*f, kv=4*f;
    const ktop=b.blok(0,kv,kw,kd,kh,steen,{y:basis-.01,mat:"steen",verd:6*f,vloer:basis});
    for(const [u0,v0,u1,v1,nu,nv] of [[-kw/2,kv-kd/2,kw/2,kv-kd/2,0,-1],[kw/2,kv-kd/2,kw/2,kv+kd/2,1,0],[kw/2,kv+kd/2,-kw/2,kv+kd/2,0,1],[-kw/2,kv+kd/2,-kw/2,kv-kd/2,-1,0]])
      b.kantelen(u0,v0,u1,v1,ktop,1.4*f,steen,{buiten:[nu,nv],mat:"steen",kantelen:"blok"});
    for(const [a,c] of [[-1,-1],[1,-1],[-1,1]])
      b.toren(a*kw/2,kv+c*kd/2,4.2*f,kh+8*f,steen,{dak:"kegel",dakKleur:lei,dakMat:"lei",dakH:9*f,y:basis-.01,mat:"steen",plint:false,ramen:6*f});
    /* de zuidtoren: de hoogste van allemaal, met de koninklijke vlag */
    const zt=b.toren(kw/2,kv+kd/2,6*f,kh+30*f,steen,{dak:"kegel",dakKleur:lei,dakMat:"lei",dakH:14*f,y:basis-.01,mat:"steen",plint:false,ramen:6*f,vlag:"#2F5D3A"});
    /* de troonzaal: lang en hoog tegen de noordkant van de donjon */
    const zv=kv-kd/2-12*f;
    const ztop=b.blok(0,zv,52*f,20*f,16*f,steen,{y:basis-.01,mat:"steen",verd:8*f,vloer:basis});
    b.zadel(0,zv,ztop-.2*f,53*f,21*f,9*f,lei,{mat:"lei",gevel:{kleur:steen,mat:"steen",verd:8*f}});
    for(let k=-2;k<=2;k++)for(const z of [-1,1])b.stuk("vast",B.S.afgeknot4,k*11*f,basis-.02,zv+z*(10*f+1*f),2.2*f,13*f,2*f,0,steen,{mat:"steen"});
    /* langs de muren: barakken, stallen en het tuighuis */
    for(const [u,v,L,D,r] of [[-hw+7*f,-20*f,50*f,10*f,Math.PI/2],[hw-7*f,-20*f,50*f,10*f,Math.PI/2],[-hw*.55,hd-8*f,40*f,10*f,0],[hw*.55,hd-8*f,40*f,10*f,0],[0,-hd+7*f,60*f,10*f,0]]){
      const t=b.blok(u,v,L,D,8*f,steen,{r,y:basis-.01,mat:"steen",verd:4*f,vloer:basis});
      b.zadel(u,v,t-.2*f,L+.8*f,D+1.2*f,4.5*f,lei,{r,mat:"lei",gevel:{kleur:steen,mat:"steen"}});
    }
    b.lamp(0,basis+mh+2*f,hd+3*f); b.lamp(0,ktop+2*f,kv); b.lamp(kw/2,basis+kh+20*f,kv+kd/2);
    b.top=Math.max(b.top,zt||0,ktop+30*f);
    /* het plein is geen lege vlakte: een kapel met klokkentoren, de keuken
       naast de troonzaal, wachthuizen bij de poort, een put, de smidse en
       huizen van het personeel, en een paar bomen */
    { const kp=b.blok(-hw*.55,hd*.3,24*f,11*f,11*f,steen,{r:.0,y:basis-.01,mat:"steen",verd:6*f,vloer:basis});
      b.zadel(-hw*.55,hd*.3,kp-.2*f,25*f,12*f,6*f,lei,{mat:"lei",gevel:{kleur:steen,mat:"steen"}});
      b.toren(-hw*.55-12*f,hd*.3,3.4*f,24*f,steen,{vierkant:true,dak:"kegel",dakKleur:lei,dakMat:"lei",dakH:9*f,y:basis,mat:"steen",plint:false}); }
    { const kt=b.blok(31*f,zv,16*f,12*f,9*f,steen,{y:basis-.01,mat:"steen",verd:4.5*f,vloer:basis});
      b.zadel(31*f,zv,kt-.2*f,16.8*f,12.8*f,5*f,lei,{mat:"lei",gevel:{kleur:steen,mat:"steen"}});
      b.cil(36*f,zv-3*f,1*f,kt-basis+4*f,steen,{y:basis,mat:"breuk"}); }
    for(const z of [-1,1]){ const t=b.blok(z*16*f,hd-16*f,10*f,8*f,7*f,steen,{y:basis-.01,mat:"steen",verd:3.5*f,vloer:basis});
      b.zadel(z*16*f,hd-16*f,t-.2*f,10.8*f,8.8*f,4*f,lei,{mat:"lei",gevel:{kleur:steen,mat:"steen"}}); }
    { const u=-22*f,v=hd*.62-6*f; b.cil(u,v,2.2*f,1.2*f,steen,{y:basis,mat:"breuk"}); b.cil(u,v,1.6*f,.2*f,"#2E3A3E",{y:basis+1.1*f}); }
    { const t=b.blok(hw*.6,hd*.25,14*f,9*f,6*f,"#8A7458",{y:basis-.01,mat:"breuk",verd:-1,vloer:basis});
      b.lessenaar(hw*.6,hd*.25,t-.2*f,15*f,10*f,3*f,"#5E5650",{mat:"lei",gevel:{kleur:"#8A7458",mat:"breuk"}}); }
    for(const [u,v,r] of [[-hw+18*f,-hd*.35,.3],[-hw+34*f,-hd*.6,1.9],[hw-26*f,hd*.05,.8]])B.huis(b,u,v,"araluen",{r,nr:Math.round(u*97)&63,maat:.9,aanbouw:false});
    for(const [u,v] of [[-hw*.2,hd*.55],[hw*.25,hd*.6],[-hw*.7,-hd*.1],[hw*.72,-hd*.45]])b.boom(u,v,2,.55);
    /* het kasteelpark, achter het kasteel buiten de gracht: een boomgaard in
       onregelmatige rijen, een vijver met een vrije oever, en groepjes bomen
       op het gras, zoals een park dat in eeuwen gegroeid is */
    const pv=-(hd+gr+gw/2);
    for(let r=0;r<4;r++)for(let k=0;k<9;k++){
      const u=-hw*.85+k*20*f+(b.r(400+r*9+k)-.5)*6*f, v=pv-30*f-r*16*f+(b.r(440+r*9+k)-.5)*5*f;
      if(b.r(480+r*9+k)<.12||!b.land(u,v))continue;
      b.boom(u,v,3,.32+b.r(520+r*9+k)*.08);
    }
    { const u=hw*.55,v=pv-55*f, g=b.grond(u,v);
      for(let i=0;i<5;i++){ const a=i*1.3, d=(i%2?7:3)*f; b.plas(u+Math.cos(a)*d,v+Math.sin(a)*d*.7,(9+b.r(560+i)*5)*f,(6+b.r(570+i)*4)*f,g+.35*f,{r:a}); } }
    for(let i=0;i<14;i++){ const a=b.r(600+i)*Math.PI*2, d=(30+b.r(620+i)*50)*f, u=hw*.55+Math.cos(a)*d, v=pv-55*f+Math.sin(a)*d*.6;
      if(b.land(u,v))b.boom(u,v,2,.45+b.r(640+i)*.15); }
    /* de weg van de ophaalbrug naar het dorp */
    b.weg([[0,hd+gr+gw/2+2*f],[0,hd+.7]],6*M,0);
    b.straal=.95;
    /* het dorp van het kasteel, voor de poort */
    const d=B.rond(...b.naast(0,2.3),0,77);
    stad(B,d,"araluen",{soort:3,zaad:7712,richting:0});
  }},
  /* Kasteel Macindaw — een grensvesting tegen de Scotti: zwaar, grijs,
     vierkant, met een droge gracht. Hier speelde Will de jongleur. */
  /* groot, vierkant en van graniet, meer vesting dan kasteel; de
     ophaalbrug en de hoofdpoort op het zuiden */
  macindaw:{info:{vlak:[.45,1,1],open:1.0},draai:()=>0,bouw(B,b){
    const steen="#8A877E";
    kasteel(B,b,"araluen",{steen,breed:62,muurH:13,torenR:6,donjonH:30,torenDak:"plat",vlag:"#2F5D3A"});
    /* de droge gracht: een donkere strook om de muren */
    const g=b.grond(0,0), hw=31*M+12*M, hd=27*M+12*M;
    for(const [u,v,bx,bz] of [[0,-hd,hw*2+8*M,7*M],[0,hd,hw*2+8*M,7*M],[-hw,0,7*M,hd*2],[hw,0,7*M,hd*2]])
      b.blok(u,v,bx,bz,.3*M,"#55603E",{y:g-.25*M,var:0,mat:"plag"});
  }},
  /* Noordam (Norgate) — het leen aan de noordgrens */
  noordam:{info:{vlak:[.45,1,1],open:1.0},bouw(B,b){ kasteel(B,b,"araluen",{breed:74,steen:"#A49F93",torenVorm:"vierkant",donjon:"zaal"}); B.dorp(B.rond(...b.naast(+.62,+.36),.3,8),"araluen",{straal:.26,aantal:14,geenPlein:false,zaad:2}); }},
  /* Karwij (Caraway) — een leen met een eigen Krijgsschool */
  karwij:{info:{vlak:[.45,1,1],open:1.0},bouw(B,b){ kasteel(B,b,"araluen",{breed:76,steen:"#B8B1A2",plan:"veelhoek",voorburcht:true,torenDak:"plat"}); B.dorp(B.rond(...b.naast(-.64,+.3),-.3,9),"araluen",{straal:.26,aantal:13,zaad:3}); }},
  /* Gorlan — Morgaraths kasteel, sinds zijn nederlaag een ruïne die de boeren
     mijden; en het toernooiveld waar het allemaal begon */
  gorlan:{info:{vlak:[.45,1,.8],open:1.2},bouw(B,b){
    ruine(B,b,"araluen",{breed:74,steen:"#77736A",puin:"#6E6A60"});
    const c=B.rond(...b.naast(+.6,+.2),.2,5), g=c.grond(0,0);
    c.blok(0,0,60*M,26*M,.2*M,"#8E8A6A",{y:g-.1*M,var:0,mat:"aarde"});
    for(const z of [-1,1])c.blok(0,z*14*M,60*M,.5*M,1.4*M,"#5E4A38",{y:g,mat:"hout"});
  }},
  /* Zeeklif (Seacliff) — een klein eilandleen: Wills eerste standplaats,
     een burcht boven op het klif (zie het klif in 3d-grond.js) */
  zeeklif:{info:{klif:{r:3.2,hoogte:1.5},vlak:[.3,.7,.8],open:.8},bouw(B,b){
    kasteel(B,b,"araluen",{breed:50,muurH:8,torenR:4.4,donjonH:20,steen:"#ADA799"});
    B.dorp(B.rond(...b.naast(-.3,+.28),.5,11),"araluen",{straal:.16,aantal:7,geenPlein:true,zaad:4});
    const a=B.zeeRichting(b.cx,b.cy,2.6); if(a!=null){ B.steiger(b,b.cx,b.cy,a,.15); B.vloot(b.cx,b.cy,a,"boot",3,11,{van:.15,tot:.3,ruimte:.08}); }
  }},
  /* De Oostelijke en Zuidelijke kliffen — waar het gebergte van Morgarath
     steil in zee valt (zie het klif in 3d-grond.js) */
  oostkliffen:{info:{klif:{r:7,hoogte:2.2}},bouw(B,b){ b.straal=0; }},
  zuidkliffen:{info:{klif:{r:7,hoogte:2}},bouw(B,b){ b.straal=0; }},
  /* De Vlakte van Uthal — waar het leger van Araluen de Wargals opving */
  uthal:{info:{open:1.4},bouw(B,b){ slagveld(B,b,"araluen",{tenten:12,vlaggen:["#2F5D3A","#8E2B2B","#E2D8BE"]}); }},
  /* De Heckingse Heide — het slagveld van de eerste oorlog: grafheuvels en
     een gedenksteen, waar Wills vader Daniel viel */
  heckingse:{info:{open:1.2},bouw(B,b){
    const g=b.voet(0,0,2*M,2*M);
    b.blok(0,0,2.2*M,1.4*M,7*M,"#9A9585",{y:g-.02,mat:"steen"}); b.pir(0,0,g+6.9*M,2.2*M,1.4*M,1.2*M,"#9A9585",{mat:"steen"});
    for(let i=0;i<5;i++){ const a=i/5*Math.PI*2+b.r(i), d=.12+b.r(i+9)*.1; const u=Math.cos(a)*d, v=Math.sin(a)*d; b.bol(u,v,b.grond(u,v)-1.5*M,(5+b.r(i+3)*3)*M,"#7E8456",{h:2.4*M,mat:"plag"}); }
    b.straal=.3;
  }},
  /* Het Grimsdell Woud — mistig en verwrongen: dode, kromme bomen tussen het naaldbos */
  grimsdell:{wereld:true,info:{},bouw(B,b){ for(let i=0;i<14;i++){ const a=b.r(i)*Math.PI*2, d=1+b.r(i+20)*5; b.boom(Math.cos(a)*d,Math.sin(a)*d,5,.35); } b.straal=0; }},
  /* Het Open Veld van de Heler — Malcolms gehucht diep in Grimsdell, met het ven */
  healersclearing:{info:{vlak:[.2,.5,.5],open:.6},bouw(B,b){
    for(let i=0;i<7;i++){ const a=i/7*Math.PI*2+.3, d=.13+b.r(i)*.05; B.huis(b,Math.cos(a)*d,Math.sin(a)*d,"araluen",{r:a+Math.PI/2,maat:.8,nr:i,dak:"#7E6E4E",dakMat:"riet",aanbouw:false}); }
    B.huis(b,0,-.02,"araluen",{maat:1.2,nr:20,dak:"#74664A",dakMat:"riet"});
    b.plas(.09,.11,4*M,3*M,b.grond(.09,.11)+.002);
    b.straal=.25;
  }},
  /* De Grafheuvels — oeroude heuvels op een kale rug, waar het zou spoken */
  grafheuvels:{info:{open:.8},bouw(B,b){
    for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+b.r(i), d=.06+b.r(i+9)*.16; const u=Math.cos(a)*d, v=Math.sin(a)*d; b.bol(u,v,b.grond(u,v)-1.5*M,(5+b.r(i+3)*4)*M,"#8E9462",{h:2.6*M,mat:"plag"}); }
    for(let i=0;i<7;i++){ const a=i/7*Math.PI*2, u=Math.cos(a)*.24, v=Math.sin(a)*.24; b.blok(u,v,1.4*M,.9*M,(2.4+b.r(i+30)*1.6)*M,"#8A877F",{r:a,mat:"breuk"}); }
    b.straal=.3;
  }},
  /* Cresthaven — de baai waar de Reiger als plichtschip lag */
  cresthaven:{info:{vlak:[.3,.8,.6],open:1.2},bouw(B,b,p){
    haven(B,b,"araluen",p,{huizen:90,schepen:4,schip:["kogge","boot","reiger"]});
  }},
  /* Selsey — een vissersdorp aan de westkust, onder geen leen */
  selsey:{info:{vlak:[.3,.8,.6],open:1.1},bouw(B,b,p){ haven(B,b,"araluen",p,{huizen:26,lengte:150,diepte:70,steigers:2,schepen:4,schip:"boot"}); }},
  /* De Spleet — de kloof tussen Araluen en Morgaraths hoogvlakte, met de brug
     die Morgarath in het geheim liet bouwen en die Will en Arnaut in brand staken */
  spleet:{info:{kloof:{r:10,breed:.32}},bouw(B,b){
    /* de brug: dwars over de kloof (zie de kloof in 3d-grond.js), half
       verbrand — het weggebrande stuk in het midden, de rest geblakerd */
    const k=(B.kloven||[]).find(k=>k.x===b.cx&&k.y===b.cy); if(!k||!k.pts.length)return;
    /* de richting van de kloof: de lijn door zijn punten */
    let sx=0,sy=0,n=0; for(let i=0;i<k.pts.length;i+=2){ sx+=k.pts[i]; sy+=k.pts[i+1]; n++; }
    sx/=n; sy/=n; let xx=0,yy=0,xy=0;
    for(let i=0;i<k.pts.length;i+=2){ const dx=k.pts[i]-sx, dy=k.pts[i+1]-sy; xx+=dx*dx; yy+=dy*dy; xy+=dx*dy; }
    const langs=.5*Math.atan2(2*xy,xx-yy);
    /* het punt van de kloof dat het dichtst bij de plaats ligt */
    let bx=sx,by=sy,bd=1e9; for(let i=0;i<k.pts.length;i+=2){ const d=Math.hypot(k.pts[i]-b.cx,k.pts[i+1]-b.cy); if(d<bd){bd=d;bx=k.pts[i];by=k.pts[i+1];} }
    const c=B.rond(bx,by,langs+Math.PI/2,6), L=k.breed*1.6/K;
    const y=Math.max(c.grond(-L,0),c.grond(L,0))+.012;
    const n2=40;
    for(let i=0;i<n2;i++){
      const u=-L+(i+.5)*2*L/n2, t=i/n2;
      if(t>.5&&t<.66)continue;
      c.blok(u,0,2*L/n2*.85,4*M,.5*M,t>.36&&t<.8?"#2E2620":"#6B5138",{y,var:.2,mat:"hout"});
    }
    for(const s of [-1,1])for(let i=0;i<n2;i+=4){ const t=i/n2; if(t>.46&&t<.7)continue; c.cil(-L+(i+.5)*2*L/n2,s*2*M,.15*M,1.2*M,"#4E3A28",{y,zes:true}); }
    for(const u of [-L*.95,-L*.55,-L*.25,L*.25,L*.55,L*.95])c.cil(u,0,.4*M,y+.2*M-c.grond(u,0)+.02,"#4E3A28",{y:c.grond(u,0)-.02,zes:true});
    b.straal=.35;
  }},
  /* De Driestappas — drie steile treden in de rots: wie hem houdt, sluit het gebergte af */
  driestappas:{info:{},bouw(B,b){
    for(let i=0;i<3;i++){ const u=(i-1)*.1; b.blok(u,0,.09,.13,.03+i*.03,"#8A8579",{r:.1,var:.12,mat:"breuk"}); }
    for(let i=0;i<10;i++){ const u=(b.r(i)-.5)*.5, v=(b.r(i+9)-.5)*.36+(i%2?.14:-.14); b.rots(u,v,(3+b.r(i+20)*4)*M); }
    b.straal=.25;
  }},
  /* Morgaraths Hoogvlakte — het kale plateau waar de Wargals verzamelden */
  hoogvlakte:{info:{plateau:{r:4.2,hoogte:.13,dx:-1,dy:-3,bergen:{r:15,hoogte:.3}}},bouw(B,b){
    /* het kamp van de Wargals: groepjes tenten verspreid over het plateau */
    for(let i=0;i<60;i++){ const g=Math.floor(i/10), ga=b.r(g+90)*Math.PI*2, gd=(.2+b.r(g+95)*1.2)/K, a=b.r(i)*Math.PI*2, d=b.r(i+5)*.12/K;
      const u=Math.cos(ga)*gd+Math.cos(a)*d, v=Math.sin(ga)*gd+Math.sin(a)*d; b.tent(u,v,2.6*M,3*M,"#3E3830",{}); }
    b.vlag(0,0,b.grond(0,0),12*M,"#1E1E22"); b.vlag(.1,.05,b.grond(.1,.05),10*M,"#5A1E1E");
    b.straal=.45;
  }},
  /* Morgaraths Burcht — zijn hoofdkwartier op de hoogvlakte. De boeken
     zeggen er weinig over: een burcht bovenop het plateau, van waaruit hij
     de Wargals aanstuurde. Hier: grimmig en anders dan de leenkastelen, een
     onregelmatige vijfhoek van donkere breuksteen op een rotsbult, met platte
     vierkante torens, een hoge smalle donjon en een nog hogere uitkijktoren
     (hij overziet het plateau en de kliffen), barakken langs de muur en een
     zwarte banier. */
  "morgarath-burcht":{info:{vlak:[.5,1.1,1],open:.8,heuvel:{r:.6,hoogte:.006}},bouw(B,b){
    const steen="#3A3633", donker="#2A2725", f=M;
    const pts=[[-34,-30],[22,-38],[44,4],[16,36],[-38,22]].map(([u,v])=>[u*f,v*f]);
    const basis=b.voet(0,0,40*f,36*f);
    b.stuk("vast",B.S.blok,0,basis-.4,0,90*f,.4-.35*M,80*f,0,steen,{mat:"breuk"});
    b.blok(0,0,70*f,60*f,.7*M,"#5E5850",{y:basis-.3*M,mat:"aarde",var:0});
    /* de ringmuur, met de poort in de zijde naar het kamp (zuidoost) */
    b.ring(pts,14*f,3.4*f,steen,{kantelen:"blok",y:basis-.02,top:basis+14*f,mat:"breuk",gat:[3,12*f]});
    for(const [u,v] of pts)b.toren(u,v,5*f,20*f,steen,{vierkant:true,dak:"plat",y:basis-.02,mat:"breuk",kantelen:"blok",ramen:0});
    const [g0,g1]=[pts[3],pts[4]], gu=(g0[0]+g1[0])/2, gv=(g0[1]+g1[1])/2;
    b.poort(gu,gv,Math.atan2(gv,gu),14*f,18*f,steen,null,{mat:"breuk",kantelen:"blok"});
    /* de donjon: hoog, smal, zonder sier */
    const dtop=b.blok(-8*f,-10*f,18*f,16*f,40*f,steen,{y:basis-.01,mat:"breuk",verd:5*f,vloer:basis});
    for(const [u0,v0,u1,v1,nu,nv] of [[-17,-18,1,-18,0,-1],[1,-18,1,-2,1,0],[1,-2,-17,-2,0,1],[-17,-2,-17,-18,-1,0]])
      b.kantelen(u0*f,v0*f,u1*f,v1*f,dtop,1.4*f,steen,{buiten:[nu,nv],mat:"breuk",kantelen:"blok"});
    b.toren(4*f,-16*f,3.6*f,54*f,donker,{vierkant:true,dak:"plat",y:basis,mat:"breuk",kantelen:"blok",plint:false,ramen:7*f});
    b.vlag(4*f,-16*f,basis+54*f,9*f,"#141414");
    /* barakken tegen de muur */
    for(const [u,v,L,r] of [[18*f,-14*f,30*f,1.0],[-24*f,4*f,26*f,1.9],[10*f,16*f,24*f,-.6]]){
      const top=b.blok(u,v,L,8*f,5*f,donker,{r,y:basis-.01,mat:"breuk",verd:-1});
      b.zadel(u,v,top-.2*f,L+.6*f,8.8*f,3*f,"#3E3A38",{r,mat:"lei"});
    }
    b.top=Math.max(b.top,basis+54*f);
    b.straal=Math.hypot(44,38)*f*1.2;
  }},
  /* De Veenlanden — drassig laagland: plassen en riet */
  veenlanden:{wereld:true,info:{},bouw(B,b){
    for(let i=0;i<9;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*4, u=Math.cos(a)*d, v=Math.sin(a)*d; if(b.land(u,v))b.plas(u,v,.1+b.r(i+9)*.15,.07+b.r(i+11)*.1,b.grond(u,v)+.006,{r:a,kleur:"#5E7E78"}); }
    b.straal=0;
  }},
  /* De Vlakte der Eenzamen — leeg en moerassig: een paar plassen en een dode boom */
  eenzamen:{wereld:true,info:{},bouw(B,b){
    for(let i=0;i<5;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*3, u=Math.cos(a)*d, v=Math.sin(a)*d; if(b.land(u,v))b.plas(u,v,.08+b.r(i+9)*.1,.06+b.r(i+11)*.06,b.grond(u,v)+.006,{r:a,kleur:"#62807A"}); }
    b.boom(.3,.2,5,.32); b.boom(-1.2,.8,5,.3);
    b.straal=0;
  }},

  /* ---- Hibernia ---- */
  /* Dun Kilty — de hoofdstad van Clonmel, van koning Ferris: een ringfort
     (dun) met een woontoren en een slanke ronde toren */
  dunkilty:{info:{vlak:[.4,.9,1],open:1.0},bouw(B,b){
    kasteel(B,b,"hibernia",{breed:70});
    B.dorp(B.rond(...b.naast(+.55,-.3),.4,12),"hibernia",{straal:.26,aantal:14,zaad:6});
  }},
  /* Craikennis — een dorp in Clonmel, verdedigd door Halt, Will en Arnaut */
  craikennis:{info:{vlak:[.3,.7,.6],open:1.0},bouw(B,b){
    stad(B,b,"hibernia",{soort:2,zaad:77});
    /* het lage stenen muurtje waarachter het dorp zich verdedigde */
    const pts=[]; for(let i=0;i<24;i++){ const a=i/24*Math.PI*2; pts.push([Math.cos(a)*1.05,Math.sin(a)*1.05]); }
    b.ring(pts,1.5*M,1*M,"#9A988F",{kantelen:null,open:[3,11],mat:"breuk"});
  }},
  /* Mountshannon — het dorp dat níet betaalde: niets heel gelaten */
  mountshannon:{info:{vlak:[.25,.6,.5],open:.9},bouw(B,b){
    let i=0;
    for(let k=0;k<30&&i<11;k++){
      const a=b.r(k)*Math.PI*2, d=.04+b.r(k+40)*.2, u=Math.cos(a)*d, v=Math.sin(a)*d;
      if(!b.land(u,v))continue;
      /* zwartgeblakerde muren zonder dak */
      const r=b.r(k+80)*Math.PI, bx=10*M, bz=6.5*M, h=(1.5+b.r(k+5)*2.5)*M;
      for(const [du,dv,lu,lv] of [[0,-bz/2,bx,.7*M],[0,bz/2,bx,.7*M],[-bx/2,0,.7*M,bz],[bx/2,0,.7*M,bz]]){
        if(b.r(k*4+du*999+dv*777)<.25)continue;
        b.blok(u+du*Math.cos(r)-dv*Math.sin(r),v+du*Math.sin(r)+dv*Math.cos(r),lu,lv,h,"#4A4642",{r,var:.25,mat:"breuk"});
      }
      b.rots(u,v,2*M,"#2E2A26",{plat:.4}); i++;
    }
    b.straal=.28;
  }},
  /* Port Cael — een smokkelaarshaven van Black O'Malley */
  portcael:{info:{vlak:[.3,.8,.6],open:1.0},bouw(B,b,p){ haven(B,b,"hibernia",p,{huizen:70,schepen:3,schip:["kogge","boot"],vloot:{zeil:"#3A3A3A"}}); }},
  /* De Mull van Linkeith — de landtong waar Tennyson aan land werd gezet:
     een strand, een broch op de kaap en het smokkelschip voor de kust */
  mulllinkeith:{info:{vlak:[.3,.7,.6],open:.8},bouw(B,b,p){
    const a=B.zeeRichting(b.cx,b.cy,2.5);
    kasteel(B,b,"picta",{});
    if(a!=null)B.vloot(b.cx,b.cy,a,"kogge",1,21,{van:.5,tot:.5,zeil:"#3A3A3A"});
  }},

  /* ---- de lenen, dorpen en de abdij van de kaart in de boeken ----
     Een leenkasteel met het dorp van het leen ernaast; de dorpen in hun
     eigen maat (gehucht, dorp of stadje). */
  hoogklif:leen({plan:"veelhoek",torenDak:"plat",breed:70,steen:"#8E8B83",heuvel:{r:.7,hoogte:.01},dorp:[-.7,.3]}),
  keramon:leen({plan:"lang",torenVorm:"vierkant",donjon:"rond",dak:"#7A3A2E",breed:66,steen:"#9A948A",heuvel:{r:.6,hoogte:.007},dorp:[.6,.35]}),
  wetborg:leen({voorburcht:true,breed:64,steen:"#A49E92",dorp:[.6,-.3]}),
  dacton:leen({plan:"rond",donjon:"rond",torenDak:"plat",breed:62,steen:"#8F8C84",dorp:[.6,.3]}),
  whitby:leen({plan:"lang",torenDak:"plat",donjon:"zaal",breed:72,steen:"#A8A193",dorp:[-.55,.4]}),
  kolwei:leen({torenVorm:"vierkant",torenDak:"plat",donjon:"rond",breed:68,steen:"#9E978B",dorp:[.6,.35]}),
  kolendal:leen({plan:"veelhoek",torenDak:"kegel",donjon:"zaal",dak:"#6E4A3A",breed:66,steen:"#8E887E",heuvel:{r:.7,hoogte:.008},dorp:[-.6,.35]}),
  aspienne:leen({breed:70,steen:"#B3AA98",dorp:[.6,-.35]}),
  treileth:leen({plan:"lang",torenDak:"kegel",voorburcht:true,breed:76,steen:"#9C978D",dorp:[-.6,.35]}),
  martenzij:leen({plan:"rond",donjon:"zaal",torenVorm:"vierkant",dak:"#7A3A2E",breed:64,steen:"#958E80",dorp:[.6,.3]}),
  woolsey:dorpje(2,501), claradon:dorpje(2,502), silvoorde:dorpje(2,503), pendelstad:dorpje(3,504),
  scanlon:dorpje(2,505), wilgendal:dorpje(2,506), ambelton:dorpje(1,507), dantwerpen:dorpje(2,508),
  esselden:dorpje(1,509), hambley:dorpje(2,510), klaterkreek:dorpje(1,511),
  pordelath:dorpje(2,512,"hibernia"), gwyntoleth:dorpje(2,513,"hibernia"),
  /* Abdij Wolden: een grote kloosterkerk, een kruisgang rond een binnenhof,
     de gebouwen van de monniken en een ommuurde moestuin */
  "abdij-wolden":{info:{vlak:[.3,.7,.8],open:.6},bouw(B,b){
    const steen="#B7AE9C", dak="#5E636A", g=b.voet(0,0,30*M,24*M);
    const top=b.blok(0,-10*M,40*M,12*M,13*M,steen,{y:g-.02,mat:"steen",verd:6*M,vloer:g});
    b.zadel(0,-10*M,top-.2*M,41*M,13.5*M,8*M,dak,{mat:"lei",gevel:{kleur:steen,mat:"steen"}});
    b.toren(-24*M,-10*M,3.6*M,28*M,steen,{vierkant:true,dak:"kegel",dakKleur:dak,dakMat:"lei",dakH:12*M,mat:"steen",plint:false,krans:false});
    /* de kruisgang: vier lage vleugels om een vierkante hof */
    for(const [u,v,l,d,r] of [[0,8*M,30*M,7*M,0],[0,26*M,30*M,7*M,0],[-15*M,17*M,7*M,25*M,0],[15*M,17*M,7*M,25*M,0]]){
      const t=b.blok(u,v,l,d,6*M,steen,{r,y:g-.02,mat:"steen",verd:3*M,vloer:g});
      b.zadel(u,v,t-.2*M,l+.6*M,d+1*M,3*M,"#8C5E46",{r:l>d?0:Math.PI/2,mat:"pannen",gevel:{kleur:steen,mat:"steen"}});
    }
    b.blok(0,17*M,22*M,10*M,.3*M,"#6E8048",{y:g-.2*M,mat:"plag",var:.05});
    /* de moestuin achter een lage muur */
    const pts=[[22*M,0],[48*M,0],[48*M,26*M],[22*M,26*M]];
    b.ring(pts,2*M,.8*M,steen,{kantelen:null,mat:"breuk",open:[3]});
    for(let i=0;i<5;i++)b.blok(35*M,(3+i*5)*M,22*M,2.6*M,.3*M,i%2?"#5E6B38":"#6E5A40",{y:g-.2*M,mat:"aarde",var:.1});
    b.lamp(0,top+2*M,-10*M); b.straal=.5;
  }},

  /* ---- Skandia ---- */
  /* Hallasholm — de hoofdstad aan de Stormwitte Zee: een houten Grote Zaal,
     een haven vol wolfschepen en een strand waar de Broederbandtraining
     begint */
  hallasholm:{info:{open:1.8},bouw(B,b,p){
    /* Hallasholm volgens de boeken: een grote haven achter een havendam,
       pakhuizen voor de buit van de rooftochten, een houten palissade met
       kleine wachttorens, huisjes dicht op elkaar, in het midden de Common
       Greens (waar elke burger een paar schapen mag houden), en de Grote
       Zaal van de Oberjarl achter een eigen palissade. */
    const H=haven(B,b,"skandia",p,{huizen:150,lengte:360,diepte:190,steigers:3,schepen:5,schip:"wolf",muur:"palissade",
      vrij:[[20,105,36],[-95,70,34]],vloot:{ruimte:.24}});
    if(!H)return;
    const c=H.c, r=H.hoek, cr=Math.cos(r), sr=Math.sin(r);
    /* de Common Greens: een grasveld met schapen */
    { const [u,v]=H.lokaal(20,105), g=c.grond(u,v);
      c.cil(u,v,30*M,.3*M,"#7E9A56",{y:g-.2*M,mat:"plag",var:.05});
      for(let i=0;i<16;i++){ const a=c.r(500+i)*Math.PI*2, d=Math.sqrt(c.r(520+i))*24*M, su=u+Math.cos(a)*d, sv=v+Math.sin(a)*d, sg=c.grond(su,sv), sa=c.r(540+i)*6.28;
        c.blok(su,sv,1.3*M,.7*M,.8*M,"#E8E2D2",{r:sa,y:sg+.3*M,var:.06}); c.blok(su+Math.cos(sa)*.8*M,sv+Math.sin(sa)*.8*M,.4*M,.35*M,.4*M,"#3A3430",{r:sa,y:sg+.7*M}); } }
    /* de Grote Zaal: lang, hoog, van hout, met gekruiste drakenkoppen op de
       nokken en een trap ervoor; eromheen een eigen palissade */
    { const [u,v]=H.lokaal(-95,70), g=c.kruin(u,v,22*M,8*M);
      c.blok(u,v,48*M,18*M,1.4*M,"#8C8478",{r,y:c.voet(u,v,24*M,9*M)-.02,mat:"breuk"});
      const zt=c.blok(u,v,44*M,14*M,7*M,"#8E7256",{r,y:g+1.2*M,mat:"hout",verd:-1});
      c.zadel(u,v,zt-.3*M,46*M,18*M,12*M,"#5A4834",{r,mat:"schindel",gevel:{kleur:"#8E7256",mat:"hout",verd:-1}});
      for(const z of [-23,23])for(const rz of [.55,-.55])c.stuk("vast",B.S.blok,u+cr*z*M,zt+11*M,v+sr*z*M,.5*M,5*M,1.8*M,r,"#4A3828",{rz,mat:"hout"});
      c.blok(u+sr*10*M,v-cr*10*M,8*M,3.5*M,1.4*M,"#8C8478",{r,y:g-.01,mat:"breuk"});
      c.lamp(u,zt+6*M,v); c.vlag(u+cr*25*M,v+sr*25*M,g,14*M,"#8E2B2B");
      const n=44, R=32*M;
      for(let i=0;i<n;i++){ if(i===Math.round(n*.75))continue; const a=i/n*Math.PI*2, pu=u+Math.cos(a)*R*1.25, pv=v+Math.sin(a)*R*.9; if(!c.land(pu,pv))continue;
        const top=c.cil(pu,pv,.45*M,4.5*M+c.r(560+i)*M,"#6B5038",{zes:true,mat:"hout"}); c.kegel(pu,pv,top,.46*M,.9*M,"#5A4430",{zes:true}); }
      b.top=Math.max(b.top,c.top); }
    /* de havendam: een stenen dam die vanaf de kust in een boog om de haven
       heen loopt */
    { let [u,v]=H.lokaal(H.lengte/2-10,-3); const [zx,zy]=H.zee; let h=Math.atan2(zy,zx);
      for(let i=0;i<22;i++){
        const du=Math.cos(h)*9*M, dv=Math.sin(h)*9*M, mu=u+du/2, mv=v+dv/2;
        c.blok(mu,mv,9.6*M,7*M,.18+1.4*M,"#8A857A",{r:h,y:-.18,mat:"breuk",var:.08});
        u+=du; v+=dv; if(i>6)h-=.12*(Math.sign(Math.sin(r-h))||1);
      }
      c.toren(u,v,2.2*M,7*M,"#8A857A",{dak:"kegel",dakKleur:"#5A4834",dakMat:"schindel",dakH:3*M,mat:"breuk",y:1.4*M-.02,plint:false,krans:false}); }
  }},

  /* De jachthut in het hoogland — waar Will en Evanlyn de winter doorkwamen */
  berghut:{info:{vlak:[.08,.2,.6],open:.15},bouw(B,b){
    const g=b.kruin(0,0,4*M,3*M);
    const top=b.blok(0,0,8*M,5.5*M,2.8*M,"#5E4630",{mat:"hout",vloer:g});
    b.zadel(0,0,top-.2*M,9*M,6.6*M,3.2*M,"#4A3A2A",{mat:"schindel",gevel:{kleur:"#5E4630",mat:"hout"}});
    b.blok(3*M,0,1*M,1*M,6.4*M,"#7E786C",{mat:"breuk",y:g-.005});
    b.blok(-5.4*M,1*M,2.4*M,1.6*M,1*M,"#6B5138",{r:.3,mat:"hout"});   /* houtstapel */
    b.lamp(0,top+.01,0);
    b.straal=.08;
  }},
  /* De bergpas boven Hallasholm — waar Skandiërs en Araluanen samen de
     Temujai tegenhielden: een wal dwars door de pas, puntpalen, vlaggen */
  pas:{info:{open:.8},bouw(B,b){
    b.muur(-.3,0,.3,0,3*M,3*M,"#7E786C",{kantelen:null,mat:"breuk"});
    for(let i=0;i<30;i++){ const u=-.34+i*.023, v=-.04-b.r(i)*.02; b.stuk("vast",B.S.kegel6,u,b.grond(u,v)-.005,v,.3*M,4*M,.3*M,0,"#5E4A38",{rx:-.5}); }
    for(let i=0;i<3;i++)b.vlag(-.15+i*.15,.02,b.grond(-.15+i*.15,.02),9*M,"#8E2B2B");
    for(let i=0;i<8;i++){ const a=b.r(i+30)*Math.PI, u=Math.cos(a)*.28, v=-.3-Math.sin(a)*.14; b.tent(u,v,2*M,2.6*M,"#B8A888",{}); }
    b.straal=.35;
  }},
  /* Limmat — een welvarende handelsstad die leeft van haar smaragdmijn;
     Zavac en de Raaf vielen haar aan */
  limmat:{info:{vlak:[.4,.9,.7],open:1.2},bouw(B,b,p){
    /* een havenstadje van zo'n vijfhonderd zielen: een palissade met twee
       grote houten wachttorens, en een zware houten giek (een drijvende
       versperring van boomstammen) dwars over de havenmond */
    const H=haven(B,b,"teutlandt",p,{huizen:90,lengte:240,diepte:120,steigers:2,schepen:3,schip:["kogge","wolf"],muur:"palissade"});
    if(H){
      const c=H.c, [u0,v0]=H.lokaal(H.lengte/2+6,-2), [zx,zy]=H.zee;
      let u=u0, v=v0, h=Math.atan2(zy,zx)-.5;
      for(let i=0;i<16;i++){
        const du=Math.cos(h)*8*M, dv=Math.sin(h)*8*M;
        if(c.diep(u+du/2,v+dv/2)<-.002)c.blok(u+du/2,v+dv/2,8.4*M,1*M,.8*M,"#4E3A28",{y:-.5*M,mat:"hout",r:h});
        u+=du; v+=dv; h+=.06;
      }
    }
    /* de mijn: een donkere ingang in de heuvel, met een houten bok erboven */
    const m=B.rond(...b.naast(+.8,-.4),.5,13), g=m.grond(0,0);
    m.blok(0,0,4*M,2.6*M,3*M,"#1E1A16",{y:g-.01});
    for(const u of [-2.5,2.5])m.cil(u*M,2.6*M,.35*M,9*M,"#5E4A38",{zes:true,mat:"hout"});
    m.blok(0,2.6*M,6*M,.8*M,.8*M,"#5E4A38",{y:g+8.4*M,mat:"hout"});
  }},
  /* Skorghijl — een kaal, mistig rotseiland met een beschutte kraterhaven */
  skorghijl:{wereld:true,info:{},bouw(B,b){ B.vloot(b.cx,b.cy,0,"wolf",3,61,{van:6,tot:16,spreid:6.3}); b.straal=0; }},

  /* ---- Gallica ---- */
  /* La Rivage — de havenstad waar Halt en Arnaut aan land gingen */
  larivage:{info:{vlak:[.4,.9,.7],open:1.1},bouw(B,b,p){ haven(B,b,"gallica",p,{huizen:160,schepen:6,schip:"kogge",muur:"steen"}); }},
  /* Les Sourges — een rivierstadje met een houten brug en een veerpont */
  lessourges:{info:{vlak:[.35,.8,.6],open:1.1},bouw(B,b){
    stad(B,b,"gallica",{soort:3,zaad:88});
    brugOver(B,b,"#6B5138");
  }},
  /* Château Montsombre — het zwarte kasteel van Deparnieux, die zijn
     gevangenen in kooien langs de weg liet sterven */
  /* het zwarte kasteel van Deparnieux: gedrongen en zwaar, dikke muren en
     een zware toren op elke hoek, op een plateau midden in het bos, met
     een smalle kronkelweg omhoog */
  montsombre:{info:{vlak:[.5,1.2,1],open:.9,heuvel:{r:.8,hoogte:.012}},bouw(B,b){
    const zwart="#3E3B38", dak="#28282C";
    kasteel(B,b,"araluen",{steen:zwart,dak,breed:70,muurH:13,torenR:8,donjonH:22,torenDak:"plat",vlag:"#1E1E22"});
    /* de kooien: palen met een kooi eraan, langs de weg naar de poort */
    for(let i=0;i<9;i++){
      const v=.3+i*.06, u=(i%2?.035:-.035);
      const g=b.grond(u,v);
      b.cil(u,v,.25*M,7*M,"#3E2E20",{zes:true});
      b.blok(u+(i%2?1.4*M:-1.4*M),v,1.6*M,1.6*M,2*M,"#2A2A2A",{y:g+3.6*M,var:0});
    }
    b.lamp(0,b.top-.03,0);
  }},
  /* Château La Lumière — de hoofdstad van koning Philippe: ondanks de naam
     een zwaar bewapende vesting, met de stad eromheen */
  lalumiere:{info:{vlak:[.6,1.4,1],open:1.6},bouw(B,b){
    kasteel(B,b,"gallica",{breed:84,muurH:13,steen:"#E0D6C2",vlag:"#2B4C7E"});
    /* een tweede, lagere ringmuur met torens */
    const hw=.38, pts=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
    b.ring(pts,8*M,2.6*M,"#D8CDB6",{gat:[2,20*M]});
    for(const [u,v] of pts)b.toren(u,v,4*M,12*M,"#D8CDB6",{dak:"kegel",dakKleur:"#4E5660",dakMat:"lei",dakH:10*M});
    B.dorp(B.rond(...b.naast(+.75,+.4),.4,14),"gallica",{straal:.34,aantal:30,stad:.5,verdiepingen:2,zaad:7});
  }},
  /* Château des Falaises — het kustbolwerk van baron Joubert */
  falaises:{info:{vlak:[.5,1.1,1],open:1.2},bouw(B,b){ kasteel(B,b,"gallica",{breed:76,muurH:13,steen:"#CAC1AD",vlag:"#5A1E1E"}); }},

  /* ---- Arrida ---- */
  /* Tabork — havenstad aan de Arridische kust */
  tabork:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){ const H=haven(B,b,"arrida",p,{huizen:120,schepen:3}); if(H)palmen(B,H.c,10,.5); }},
  /* Socorro — de havenstad van de slavenmarkt */
  socorro:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){
    /* een ommuurde havenstad; op de markt een verhoogd podium (de slavenmarkt) */
    const H=haven(B,b,"arrida",p,{huizen:170,schepen:4,muur:"steen",vrij:[[60,70,14]]});
    if(!H)return;
    const [u,v]=H.lokaal(60,70), c=H.c, g=c.grond(u,v); c.blok(u,v,10*M,7*M,1.2*M,"#B89A6A",{y:g-.01,mat:"leem"});
    palmen(B,c,8,.5);
  }},
  /* Al Shabah — de stad van wakir Selethen: ommuurd, met een fort */
  alshabah:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){ woestijnstad(B,b,{straal:.36,aantal:36,kasba:true}); }},
  /* Mararoc — de hoofdstad van Arrida, waar de emir zetelt */
  mararoc:{info:{vlak:[.6,1.3,.8],open:1},bouw(B,b){
    woestijnstad(B,b,{straal:.5,aantal:56});
    /* het paleis van de emir: koepels en minaretten */
    const g=b.voet(0,-.06,20*M,15*M);
    const top=b.blok(0,-.06,40*M,30*M,12*M,"#ECE6D8",{y:g-.02,mat:"pleister",verd:4*M,vloer:g});
    b.koepel(0,-.06,top,11*M,12*M,"#4A8A82",{mat:"pleister"});
    for(const u of [-14,14])b.koepel(u*M,-.06,top,4.4*M,5*M,"#4A8A82",{mat:"pleister"});
    for(const [u,v] of [[-22,-21],[22,-21],[-22,9],[22,9]])b.toren(u*M,v*M-.06,1.6*M,34*M,"#ECE6D8",{dak:"koepel",dakKleur:"#4A8A82",dakMat:"pleister",y:g,mat:"pleister",plint:false});
    b.lamp(0,top+.02,-.06);
  }},
  /* Maashava — de ommuurde stad van de Tualaghi, de blauwgesluierde rovers */
  maashava:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){ woestijnstad(B,b,{straal:.36,aantal:38,kasba:true,muur:"#B4936C",hoog:10}); }},
  /* Schorpioenberg — het rotsheiligdom van de Schorpioensekte */
  schorpioenberg:{info:{},bouw(B,b){
    for(let i=0;i<18;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*.3, u=Math.cos(a)*d, v=Math.sin(a)*d; b.rots(u,v,(6+b.r(i+9)*8)*M,"#9A7E5E",{plat:1.1}); }
    /* de gevel van de tempel, in de rots uitgehouwen */
    const g=b.grond(0,.32);
    b.blok(0,.32,16*M,3*M,11*M,"#B8996E",{y:g-.02,mat:"steen"});
    for(let i=0;i<6;i++)b.cil(-6*M+i*2.4*M,.32+2*M,.6*M,8*M,"#C9AA7E",{zes:true,y:g,mat:"marmer"});
    b.blok(0,.32+1.8*M,2.6*M,.6*M,4.6*M,"#1E1814",{y:g,var:0});
    b.pir(0,.32,g+10.8*M,17*M,3.4*M,3*M,"#B8996E",{mat:"steen"});
    b.straal=.35;
  }},
  /* Het gebied van de Bedullin — nomaden met zwarte tenten en snelle paarden */
  bedullin:{info:{},bouw(B,b){
    for(let i=0;i<12;i++){ const a=i/12*Math.PI*2+b.r(i), d=.12+b.r(i+5)*.2, u=Math.cos(a)*d, v=Math.sin(a)*d; b.tent(u,v,3*M,2.4*M,"#2E2824",{nok:true,r:a}); }
    b.cil(0,0,1.4*M,1*M,"#9A8A6A",{mat:"leem"});
    palmen(B,b,7,.35);
    b.straal=.4;
  }},

  /* ---- Nihon-Ja ---- */
  /* Ito — de hoofdstad met het winterpaleis van keizer Shigeru */
  ito:{info:{vlak:[.8,1.8,1],open:1.6},bouw(B,b){
    kasteel(B,b,"nihon-ja",{breed:90});
    /* de gracht rondom */
    const hw=58*M, hd=50*M, g=b.grond(0,0);
    for(const [u,v,bx,bz] of [[0,-hd,hw*2+10*M,7*M],[0,hd,hw*2+10*M,7*M],[-hw,0,7*M,hd*2],[hw,0,7*M,hd*2]]){
      const n=Math.max(1,Math.round(Math.max(bx,bz)/.1));
      for(let i=0;i<n;i++){ const t=(i+.5)/n-.5, uu=u+(bx>bz?t*bx:0), vv=v+(bz>bx?t*bz:0); b.plas(uu,vv,bx>bz?bx/n/2+.002:bx/2,bz>bx?bz/n/2+.002:bz/2,b.grond(uu,vv)+.003); }
    }
    B.dorp(B.rond(...b.naast(+.8,+.4),.2,17),"nihon-ja",{straal:.36,aantal:30,zaad:8});
  }},
  /* Iwanai — de haven waar het gezelschap op zoek naar Arnaut aan land ging */
  iwanai:{info:{vlak:[.4,.9,.7],open:1.1},bouw(B,b,p){ const H=haven(B,b,"nihon-ja",p,{huizen:100,schepen:4,vrij:[[0,95,8]]}); if(H)torii(B,H.c,...H.lokaal(0,95)); }},
  /* Ran-Koshi — een vergeten vesting in een bergdal, met een smalle toegang
     tussen steile rotswanden */
  rankoshi:{info:{vlak:[.4,.9,.8],open:1},bouw(B,b){
    /* een hoge houten palissade dwars door het dal, met een poorttoren */
    for(let i=0;i<60;i++){ const u=-.32+i*.0108; const top=b.cil(u,.18,.5*M,7*M,"#5E4A38",{zes:true,mat:"hout"}); b.kegel(u,.18,top,.5*M,1*M,"#4E3A28",{zes:true}); }
    b.toren(0,.18,4*M,11*M,"#6B5642",{vierkant:true,dak:"pagode",dakKleur:"#45494C",dakMat:"lei",lagen:1,mat:"hout",plint:false,krans:false});
    for(let i=0;i<6;i++){ const u=-.2+i*.08; B.huis(b,u,-.03,"nihon-ja",{nr:i,r:0,maat:1.05}); }
    const g=b.kruin(0,-.15,11*M,7*M);
    const top=b.blok(0,-.15,22*M,14*M,6*M,"#E8E3D6",{mat:"papier",vloer:g});
    b.pagode(0,-.15,top-.3*M,30*M,20*M,6*M,"#45494C",{mat:"lei"});
    b.straal=.35;
  }},
  /* Het Zomerpaleis — hout en papier, licht en open, met schuifwanden en tuinen */
  zomerpaleis:{info:{vlak:[.5,1.1,1],open:1.3},bouw(B,b){
    const g=b.voet(0,0,22*M,14*M);
    for(const [u,v,bx,bz] of [[0,0,36,20],[-30,12,18,14],[30,12,18,14]]){
      b.blok(u*M,v*M,bx*M,bz*M,1.2*M,"#979287",{y:g-.01,mat:"breuk"});
      b.blok(u*M,v*M,bx*.9*M,bz*.85*M,4*M,"#EEEAE0",{y:g+1.1*M,mat:"papier",vloer:g+1.1*M});
      b.pagode(u*M,v*M,g+4.8*M,bx*1.3*M,bz*1.45*M,6*M,"#4E4A44",{mat:"lei"});
      b.lamp(u*M,g+6*M,v*M);
    }
    /* de tuin met een vijver en een brugje */
    b.plas(0,.22,18*M,10*M,b.grond(0,.22)+.002);
    b.blok(0,.22,2.6*M,22*M,.8*M,"#A0302A",{y:b.grond(0,.22)+.004,mat:"hout"});
    for(let i=0;i<8;i++){ const a=b.r(i)*Math.PI*2; b.boom(Math.cos(a)*.32,Math.sin(a)*.22+.12,6,.45); }
    b.straal=.36;
  }},
  /* Kawagishi — een vissersdorp waar de boten op het strand liggen en het hout
     uit het bergland wordt verscheept */
  kawagishi:{info:{vlak:[.35,.8,.6],open:1},bouw(B,b,p){
    const H=haven(B,b,"nihon-ja",p,{huizen:50,schepen:4,schip:"boot",vrij:[[70,30,12]]});
    if(H){ const [u,v]=H.lokaal(70,30); for(let i=0;i<6;i++)H.c.blok(u+i*1.6*M,v,1.4*M,10*M,1.4*M,"#8A6E50",{r:.1,mat:"hout"}); }   /* stapels stammen */   /* stapels stammen */
  }},
  /* Mizu Umi Bakudai — het uitgestrekte bergmeer (zie het meer in 3d-grond.js) */
  "mizu-umi-bakudai":{info:{meer:{r:4.2,diepte:.035}},bouw(B,b){
    /* een paar Kikori-hutten aan de oever */
    for(let i=0;i<40;i++){
      const a=i/40*Math.PI*2, [x,y]=b.w(Math.cos(a)*4.6/K,Math.sin(a)*4.6/K);
      if(B.opLand(x,y)&&b.r(i)<.15){
        const c=B.rond(x,y,a+Math.PI/2,i); B.huis(c,0,0,"nihon-ja",{nr:i,maat:.8});
      }
    }
    b.straal=0;
  }},

  /* ---- Toscana ---- */
  /* Raguza — een wetteloze havenstad, bestuurd door piratenkapiteins; schepen
     betalen tien procent tol */
  raguza:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){
    haven(B,b,"toscana",p,{huizen:200,schepen:7,steigers:4,schip:["galei","kogge"],vloot:{zeil:"#3A3530"},muur:"steen"});
    const a=B.zeeRichting(b.cx,b.cy,2.2);
    if(a!=null){ const t=B.waterlijn(b.cx,b.cy,a), c=B.rond(b.cx+Math.cos(a)*t,b.cy+Math.sin(a)*t,a,4); c.toren(-.03,.28,3.6*M,20*M,"#D2C4A6",{vierkant:true,dak:"plat",kantelen:"zwaluw"}); }
  }},
  /* Krall — een nederzetting aan de bovenloop van de Dan */
  krall:{info:{vlak:[.3,.8,.6],open:1},bouw(B,b,p){ haven(B,b,"toscana",p,{huizen:35,lengte:170,diepte:80,steigers:2,schepen:2,schip:"boot"}); }},
  /* Bayrath — een grote stad, bijna een metropool, aan de Dan; de corrupte
     Gatmeister liet de Reigers gevangenzetten */
  bayrath:{info:{vlak:[.7,1.5,.8],open:1.4},bouw(B,b){
    /* een grote stad, bijna een metropool, met een ringmuur */
    const plan=stad(B,b,"toscana",{soort:4,zaad:4100,richting:0,vrij:[[0,42,20]]});
    /* het stadhuis van de Gatmeister, met een belforttoren, aan het
       marktplein tegenover de kerk */
    const hu=plan.plein.x/K, hv=(plan.plein.y+plan.plein.d/2+12*METER)/K;
    const g=b.voet(hu,hv,10*M,7*M);
    const top=b.blok(hu,hv,22*M,14*M,12*M,"#E3D8BE",{y:g-.02,mat:"pleister",verd:4.5*M,vloer:g});
    b.schild(hu,hv,top-.2*M,23*M,15*M,3.5*M,"#A85E40",{mat:"pannen"});
    b.toren(hu+14*M,hv,2.8*M,34*M,"#E3D8BE",{vierkant:true,dak:"kegel",dakKleur:"#A85E40",dakMat:"pannen",dakH:5*M,vlag:"#C9A94A",mat:"pleister",plint:false,krans:true,kantelenOok:false});
  }},
  /* Byzantos — een jonge stadstaat aan de Gouden Reikwijdte, aan drie kanten
     door water beschermd en met dikke muren */
  byzantos:{info:{vlak:[.6,1.3,.8],open:1.2},bouw(B,b,p){
    /* aan drie kanten water, aan de landkant een dikke muur; in het midden
       de grote koepelkerk van de keizerin */
    const H=haven(B,b,"helleno",p,{huizen:260,schepen:6,steigers:4,schip:"galei",muur:"steen",vrij:[[0,110,28]]});
    if(!H)return;
    const c=H.c, [u,v]=H.lokaal(0,110);
    const g=c.voet(u,v,14*M,14*M);
    const top=c.blok(u,v,30*M,30*M,14*M,"#E8E1D2",{y:g-.02,mat:"marmer",verd:5*M,vloer:g});
    c.koepel(u,v,top,13*M,12*M,"#B09A76",{mat:"lei"});
    for(const [du,dv] of [[-11,-11],[11,-11],[-11,11],[11,11]])c.koepel(u+du*M,v+dv*M,top,4.4*M,4.4*M,"#B09A76",{mat:"lei"});
    c.lamp(u,top+.03,v);
  }},
  /* Sorato — een vallei in het noorden van Toscana, waar Will en Maddie de
     Temujai in een hinderlaag lieten lopen */
  sorato:{info:{vlak:[.3,.8,.6],open:1},bouw(B,b){
    stad(B,b,"toscana",{soort:2,zaad:61});
    b.toren(.14,-.14,3*M,20*M,"#D2C4A6",{vierkant:true,dak:"plat",vlag:"#8E2B2B",kantelen:"zwaluw"});
    for(let i=0;i<20;i++){ const u=-.34+i*.034; b.stuk("vast",B.S.kegel6,u,b.grond(u,.34)-.005,.34,.3*M,4*M,.3*M,0,"#5E4A38",{rx:.5}); }
  }},
  /* Genovesa — een Toscaanse stadstaat, berucht om zijn huurmoordenaars: een
     stad van hoge woontorens */
  genovesa:{info:{vlak:[.5,1.1,.8],open:1.1},bouw(B,b,p){
    /* een stad van hoge woontorens tussen de huizen */
    const vrij=[]; for(let i=0;i<12;i++)vrij.push([(((i*37)%23)/23-.5)*260,40+((i*53)%29)/29*120,7]);
    const H=haven(B,b,"toscana",p,{huizen:190,schepen:4,schip:"galei",muur:"steen",vrij});
    if(!H)return;
    vrij.forEach(([u,v],i)=>{ const [lu,lv]=H.lokaal(u,v); if(H.c.land(lu,lv))H.c.toren(lu,lv,2.4*M,(20+H.c.r(i+20)*16)*M,"#D4BF97",{vierkant:true,dak:"plat",mat:"pleister",plint:false,ramen:3.6*M}); });
  }},
  /* Palladio — een grote kuststad in het zuiden van Toscana */
  palladio:{info:{vlak:[.55,1.2,.7],open:1.1},bouw(B,b,p){
    /* een grote kuststad; boven de huizen een koepelkerk met een klokkentoren */
    const H=haven(B,b,"toscana",p,{huizen:220,schepen:5,steigers:4,schip:["galei","kogge"],muur:"steen",vrij:[[-40,120,18]]});
    if(!H)return;
    const c=H.c, [u,v]=H.lokaal(-40,120), g=c.voet(u,v,7*M,7*M);
    const top=c.blok(u,v,16*M,12*M,10*M,"#E8DBC0",{y:g-.02,mat:"pleister",verd:5*M,vloer:g}); c.koepel(u,v,top,5.4*M,6*M,"#A85E40",{mat:"pannen"});
    c.toren(u+10*M,v,2.2*M,26*M,"#E8DBC0",{vierkant:true,dak:"kegel",dakKleur:"#A85E40",dakMat:"pannen",dakH:4*M,mat:"pleister",plint:false});
  }},
  /* Rovo — de hoofdstad van het oude Rovo-rijk (keizer Coltonus de Grote):
     een tempel met losse zuilen, een half ingestort amfitheater, een stuk
     aquaduct */
  rovo:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){
    const marmer="#D6D0C0", g=b.voet(0,0,.12,.12);
    /* de tempel */
    b.blok(-.18,0,30*M,18*M,2*M,marmer,{y:g-.02,mat:"marmer"});
    for(let i=0;i<8;i++)for(const z of [-1,1]){ if(b.r(i*3+z)<.25)continue; b.cil(-.18-12*M+i*3.4*M,z*7.5*M,.9*M,(10+(b.r(i+z*7)<.3?-5:0))*M,marmer,{y:g+1.8*M,mat:"marmer"}); }
    b.blok(-.18-6*M,0,16*M,17*M,1.6*M,marmer,{y:g+11.6*M,mat:"marmer"});
    /* het amfitheater: een ovale ring van bogen, aan één kant ingestort */
    const n=28;
    for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2, u=.15+Math.cos(a)*.16, v=Math.sin(a)*.12;
      const h=(a>2.2&&a<3.6)?(2+b.r(i)*3)*M:11*M;
      b.blok(u,v,6*M,3*M,h,"#CFC6B0",{r:a+Math.PI/2,var:.12,mat:"steen"});
    }
    /* het aquaduct */
    for(let i=0;i<10;i++){ const u=-.36+i*.044; b.blok(u,-.27,2*M,2*M,11*M,marmer,{mat:"steen"}); }
    b.blok(-.16,-.27,.42,2.4*M,1.6*M,marmer,{y:b.grond(-.16,-.27)+11*M,mat:"steen"});
    for(let i=0;i<14;i++){ const u=(b.r(i+40)-.5)*.6, v=(b.r(i+60)-.5)*.5; b.rots(u,v,1.5*M,"#C9C2B0"); }
    for(let i=0;i<7;i++)b.boom(-.4+i*.13,.3,7,.5);
    b.straal=.45;
  }},
  /* Santorillos — een vulkaaneiland met een bijna onneembare vesting op de
     rand van een uitgedoofde krater; de schuilplaats van de kaper Myrgos */
  santorina:{info:{vlak:[.35,.8,.7],open:1},bouw(B,b){
    kasteel(B,b,"helleno",{breed:56,muurH:12,steen:"#E0DBCE",soort:"toscana",kantelen:"blok",vlag:"#1E1E22",steenMat:"steen"});
    B.dorp(B.rond(...b.naast(-.4,+.26),0,27),"helleno",{straal:.24,aantal:16,geenPlein:true,zaad:9});
    B.vloot(b.cx,b.cy,0,"galei",1,77,{spreid:6.3,van:.7,tot:.8,zeil:"#2A2A2A"});
  }},

  /* ---- Indus ---- */
  /* Indus — het meest oostelijke land van de Silasische Raad */
  "indus-haven":{info:{vlak:[.5,1.1,.7],open:1.1},bouw(B,b,p){
    const H=haven(B,b,"indus",p,{huizen:150,schepen:4,vrij:[[30,90,16]]});
    if(!H)return;
    const c=H.c, [u,v]=H.lokaal(30,90), g=c.voet(u,v,8*M,8*M);
    const top=c.blok(u,v,18*M,18*M,8*M,"#E4D6C4",{y:g-.02,mat:"leem",vloer:g}); c.ui(u,v,top,6*M,11*M,"#E8E0D2",{mat:"pleister"});
    for(const [du,dv] of [[-7,-7],[7,-7],[-7,7],[7,7]])c.ui(u+du*M,v+dv*M,top,2*M,4*M,"#E8E0D2",{mat:"pleister"});
    palmen(B,c,10,.45);
  }}
};

/* ---- kleine onderdelen die meer dan eens terugkomen ---- */
function palmen(B,b,n,R){ for(let i=0;i<n;i++){ const a=b.r(i+70)*Math.PI*2, d=R*(.6+b.r(i+80)*.6); b.boom(Math.cos(a)*d,Math.sin(a)*d,4,.55); } }
function torii(B,b,u,v){
  const g=b.grond(u,v);
  for(const z of [-2.6,2.6])b.cil(u+z*M,v,.4*M,5*M,"#B8302A",{zes:true,y:g});
  b.blok(u,v,7.6*M,.8*M,.6*M,"#2A2A2A",{y:g+5*M}); b.blok(u,v,6.4*M,.6*M,.5*M,"#B8302A",{y:g+4*M});
}
/* een woestijnstad: lemen huizen met platte daken binnen een muur met
   driehoekige kantelen, palmen, en een kasba als dat er is */
function woestijnstad(B,b,o){
  B.dorp(b,"arrida",{straal:o.straal,aantal:o.aantal,stad:.4,verdiepingen:2});
  const R=o.straal+.08, pts=[]; for(let i=0;i<16;i++){ const a=i/16*Math.PI*2; pts.push([Math.cos(a)*R,Math.sin(a)*R]); }
  const muur=o.muur||"#C3AA7E", hoog=(o.hoog||8)*M;
  b.ring(pts,hoog,2.6*M,muur,{kantelen:"driehoek",open:[0],mat:"leem"});
  for(const [u,v] of pts.filter((_,i)=>i%3===0)){ b.stuk("vast",B.S.afgeknot4,u,b.voet(u,v,3*M,3*M)-.01,v,7*M,hoog+5*M+.01,7*M,0,muur,{mat:"leem"}); }
  if(o.kasba){ const c=B.rond(b.cx+R*.45,b.cy-R*.4,0,33); kasteel(B,c,"arrida",{breed:46,muurH:9,steen:muur}); b.top=Math.max(b.top,c.top); }
  palmen(B,b,14,R*1.2);
  b.straal=R+.06;
}
/* bij de rivier? (dan geen huis) */
function rivierBij(B,b,u,v){ const [x,y]=b.w(u,v); return B.rivierOp?B.rivierOp(x,y)>40:false; }
/* een brug over de rivier die het dichtst bij het midden langs loopt */
function brugOver(B,b,kleur){
  if(!B.rivierOp)return;
  let best=null;
  for(let i=0;i<30;i++){ const a=i/30*Math.PI*2; for(let d=.03;d<.6;d+=.03){ const [x,y]=b.w(Math.cos(a)*d,Math.sin(a)*d); if(B.rivierOp(x,y)>100){ if(!best||d<best.d)best={a,d,x,y}; break; } } }
  if(!best)return;
  /* de richting van de rivier: waar het water verder loopt */
  let ra=0, rb=-1;
  for(let i=0;i<16;i++){ const a=i/16*Math.PI; const w=B.rivierOp(best.x+Math.cos(a)*.25,best.y+Math.sin(a)*.25)+B.rivierOp(best.x-Math.cos(a)*.25,best.y-Math.sin(a)*.25); if(w>rb){rb=w;ra=a;} }
  const c=B.rond(best.x,best.y,ra+Math.PI/2,37), g=c.grond(0,0)+.015;
  c.blok(0,0,.3,4*M,.8*M,kleur,{y:g,mat:"hout"});
  for(const u of [-.1,0,.1])c.cil(u,0,.6*M,.03,"#4E3A28",{y:g-.025});
  /* de veerpont, een eindje stroomafwaarts */
  const [fx,fy]=[best.x+Math.cos(ra)*.3,best.y+Math.sin(ra)*.3];
  const f=B.rond(fx,fy,ra,38); f.blok(0,0,6*M,3.6*M,.6*M,"#7A5E44",{y:f.grond(0,0)+.004,mat:"hout"});
}

/* ======================= de standaard per soort ======================= */
export const SOORTEN={
  kasteel:{info:{vlak:[.45,1,1],open:1.1},bouw(B,b,p,stijl){ kasteel(B,b,stijl,{}); }},
  stad:{info:{vlak:[.45,1,.8],open:1.2},bouw(B,b,p,stijl){ if(stijl==="arrida")woestijnstad(B,b,{straal:.36,aantal:32}); else stad(B,b,stijl,{straal:.38,aantal:30}); }},
  haven:{info:{vlak:[.45,1,.7],open:1.1},bouw(B,b,p,stijl){ haven(B,b,stijl,p,{straal:.34,aantal:24}); }},
  ruine:{info:{vlak:[.4,.9,.8],open:.9},bouw(B,b,p,stijl){ ruine(B,b,stijl,{}); }},
  slagveld:{info:{open:1.2},bouw(B,b,p,stijl){ slagveld(B,b,stijl,{}); }}
};
export const stijlVan=gebied=>STIJL_VAN[gebied]||"araluen";
/* wat de grond moet doen rond deze plaats (voor 3d-grond.js) */
/* hoe groot de lage vlakte aan het water onder een havenstad is (in
   kaarteenheden); de rest krijgt HAVENVLAK */
const HAVENVLAK=.6, HAVENMAAT={hallasholm:.8,selsey:.4,krall:.42,limmat:.5,kawagishi:.45,portcael:.5,cresthaven:.52,raguza:.7,byzantos:.75,palladio:.7,larivage:.7};
export function modelInfo(p){
  const i=(BOUWERS[p.id]||SOORTEN[p.soort]||{}).info||{};
  /* een havenstad ligt aan het water: de rekenploeg maakt daar het land laag
     en vlak (zie haven() hieronder en afwerking() in 3d-grond.js) */
  const isHaven=(p.soort==="haven"&&p.id!=="mulllinkeith")||p.id==="genovesa";
  if(isHaven)return {...i,vlak:null,open:i.open?Math.max(.36,i.open*K*1.6):0,haven:{r:HAVENMAAT[p.id]||HAVENVLAK}};
  /* vlak en open plek horen bij het gebouw, en dat is met K verkleind; klif,
     kloof en meer zijn landschap en blijven zoals ze zijn */
  return {...i,vlak:i.vlak?[i.vlak[0]*K,i.vlak[1]*K*1.4,i.vlak[2]]:null,open:i.open?Math.max(.36,i.open*K*1.6):0};
}

/* ======================= de naamloze nederzettingen =======================
   Per tegel rond de camera (zie 3d.js): de huizen van alle plekken in de
   tegel, samen in één vorm. plekken: [x, y, soort, toeval, richting, gebied]
   per plek, gebiedStijl: gebied-nummer → bouwstijl. */
export function bouwGehuchten(omg,plekken,gebiedStijl){
  const B=maakBouwer(omg);
  for(const p of plekken){
    try{ B.gehucht(p,gebiedStijl(p[5])); }catch(e){ console.warn("gehucht",e); }
  }
  return {vast:B.bakken.vast.geo(),doek:B.bakken.doek.geo(),wiek:B.bakken.wiek.geo(),vlag:B.bakken.vlag.geo(),rook:new Float32Array(B.rook)};
}
/* De bomen bij een nederzetting: een boomgaard bij een boerderij, wat
   bomen rond een gehucht of dorp (niet op de straat). Los van de huizen
   uitgerekend, zodat ze ook van verder weg al kunnen staan dan de huizen. */
export function gehuchtBomen(plek,stijl,opLand,hash2,uit){
  const [x,y,soort,zaad,a]=plek;
  const st=STIJLEN[stijl]||STIJLEN.araluen, M=M_*K;
  const r=i=>hash2((zaad*7+i*131)|0,(zaad%977+i*17)|0);
  const soortBoom=st.huis==="plat"?4:stijl==="toscana"||stijl==="helleno"?7:st.huis==="japans"?6:2;
  if(soort===0){
    /* een boomgaard in rijen naast het erf */
    if(st.huis==="joert")return;
    const t=r(1)*Math.PI*2, c=Math.cos(t), s=Math.sin(t), ox=x-s*24*M-c*14*M, oy=y+c*24*M-s*14*M;
    for(let i=0;i<4;i++)for(let k=0;k<3;k++){
      if(r(10+i*3+k)<.2)continue;
      const px=ox+c*i*7*M-s*k*7*M, py=oy+s*i*7*M+c*k*7*M;
      if(opLand(px,py))uit.push(px,py,soortBoom,(.34+r(30+i)*.08)*K);
    }
    return;
  }
  /* in de achtertuinen (in een stad alleen in de voorsteden en achter de
     lage huizen), en een paar op de brink */
  const plan=dorpPlan(soort,zaad,a), kans=soort===3?.12:.45;
  plan.huizen.forEach((h,i)=>{
    if(r(40+i)>kans||(soort===3&&h.lagen>1))return;
    const af=(9+r(60+i)*7)*M, dw=(r(80+i)-.5)*8*M;
    const px=x+h.x+h.ax*af-h.ay*dw, py=y+h.y+h.ay*af+h.ax*dw;
    if(opLand(px,py))uit.push(px,py,soortBoom,(.38+r(90+i)*.12)*K);
  });
  if(soort===2&&plan.plein)for(let i=0;i<3;i++){
    const t=r(120+i)*Math.PI*2, d=plan.plein.r*(.55+r(130+i)*.3), px=x+Math.cos(t)*d, py=y+Math.sin(t)*d;
    if(opLand(px,py))uit.push(px,py,soortBoom,(.5+r(140+i)*.12)*K);
  }
}

/* ======================= alles bouwen =======================
   omg: X, Z, yOp, hNorm, opLand, hash2, rivierOp, en de plaatsen. Geeft de
   vormen terug (stevig, doek, schepen, water), de lampjes, de losse bomen,
   de straten en wegen die bij de plaatsen horen, en per plaats de hoogte van
   zijn top (voor het naambordje) en zijn straal. */
export function bouwModellen(omg){
  const B=maakBouwer(omg);
  B.kloven=omg.kloven;
  const boven={}, plekken=[], midden={};
  for(const p of omg.PLAATSEN){
    const pos=omg.POS[p.id]; if(!pos)continue;
    const def=BOUWERS[p.id]||SOORTEN[p.soort];
    let [cx,cy]=pos;
    /* Een stad of kasteel aan een rivier staat op de oever, niet in het
       water: ligt het midden te dicht bij de rivier, dan schuift het
       loodrecht van de rivier af, naar de kant waar het op de kaart al lag. */
    if(omg.rivierBij&&/^(stad|kasteel)$/.test(p.soort)){
      const r=omg.rivierBij(cx,cy);
      if(r){ const nodig=r.h+(p.soort==="stad"?.45:.14)+.03; if(r.d<nodig){ cx+=r.nx*(nodig-r.d); cy+=r.ny*(nodig-r.d); } }
    }
    const rot=def&&def.draai?def.draai(omg.POS):omg.hash2((cx*131)|0,(cy*71)|0)*Math.PI*2;
    const b=B.rond(cx,cy,rot,p.id.length*13,def&&def.wereld?{schaal:1}:{});
    b.top=b.my(Math.max(omg.yOp(cx,cy),0)+.04);
    if(def){
      try{ def.bouw(B,b,p,stijlVan(p.gebied),omg.POS); }
      catch(e){ console.warn("3D-model van",p.id,e); }
    }else b.straal=0;
    boven[p.id]=b.wy(b.top)+.03;
    /* waar het model echt staat (een haven ligt aan de waterlijn) */
    const [mx,my]=b.midden||[cx,cy]; midden[p.id]=[mx,my];
    if(b.straal)plekken.push([mx,my,b.straal*b.k,p.id]);
  }
  return {vast:B.bakken.vast.geo(),doek:B.bakken.doek.geo(),schepen:B.bakken.schip.geo(),plas:B.bakken.plas.geo(),
    vlag:B.bakken.vlag.geo(),lampjes:new Float32Array(B.lampjes),rook:new Float32Array(B.rook),bomen:B.bomen,wegen:B.wegen,boven,plekken,midden};
}
