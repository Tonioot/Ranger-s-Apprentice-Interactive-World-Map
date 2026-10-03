/* ==========================================================================
   3d.js — de kaart als landschap

   Dit bestand wordt pas geladen als iemand op de knop 3D drukt; wie alleen de
   platte kaart gebruikt, haalt het nooit op. index.html geeft bij het starten
   alles mee wat hier nodig is (zie drieContext() daar): de landvormen, de
   plaatsen, de rekenregels van het reliëf en een paar handvatten om terug te
   praten — kies() opent het gewone zijpaneel, zetZicht() zet de platte kaart
   na afloop op dezelfde plek.

   Waar het op stoelt
     reliëf    Dezelfde rekensom als bouwGrond() in index.html: dezelfde ruis,
               hetzelfde terrein per gebied, dezelfde bergketen. De ruisfuncties
               zelf komen uit index.html mee, dus die staan maar op één plek.
     kleur     Dezelfde begroeiingskleuren en dezelfde CSS-variabelen als de
               kaart (licht én donker). Het verschil: hier wordt geen schaduw in
               het plaatje gebakken, die komt van een echte zon.
     maat      Bomen en huizen zijn klein gehouden ten opzichte van het land.
               Een boom zo groot als een graafschap maakt van een wereld een
               speelgoedmodel; pas als het land groter is dan wat erop staat
               voelt het als landschap. Hetzelfde doet de nevel: hoe verder weg,
               hoe blauwer en vager, zoals echte verte eruitziet.

   Coördinaten: kaartmaat (world.svg) x,y wordt hier wereld X = x - W/2,
   Z = y - H/2; Y is de hoogte. Eén kaarteenheid is één wereldeenheid.
   ========================================================================== */
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {CSS2DRenderer,CSS2DObject} from "three/addons/renderers/CSS2DRenderer.js";
import {mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";
import {Line2} from "three/addons/lines/Line2.js";
import {LineMaterial} from "three/addons/lines/LineMaterial.js";
import {LineGeometry} from "three/addons/lines/LineGeometry.js";

/* ---- maten ----
   SCHAAL is de hoogte van de hoogste top (reliëf 1) in kaarteenheden. Dat is
   ver boven de echte verhouding — echte bergen zijn op deze schaal nauwelijks
   een rimpel — maar precies genoeg om een gebergte als gebergte te lezen. */
const SCHAAL=30, ZEEDIEPTE=7;
const LAND0=.05, ZEE0=.05;        /* land net boven, zeebodem net onder de waterlijn */
const FOV=42;
const WOLKHOOGTE=58;

/* ---- thema's ----
   Licht: een late middag, de zon laag uit het noordwesten — dezelfde kant als
   het licht op de platte kaart, zodat een berg in 3D dezelfde kant op schaduwt.
   Donker: dezelfde richting, maar dan de maan, met sterren en verlichte dorpen. */
const THEMA={
  licht:{
    zon:[-.56,.40,-.72], zonKleur:"#FFE2BE", zonSterkte:3.2,
    hemelLicht:"#C9DCEA", grondLicht:"#80765E", hemiSterkte:1.0,
    zenit:"#4A82C0", nevel:"#CCD8DF", gloed:"#FFC88A",
    nevelDicht:.0026, nevelVal:.030,
    ondiep:"#4FA3A3", diep:"#123F55", schuim:"#F4F0E4",
    belichting:1.0, sterren:0, lichtjes:0,
    wolkLicht:"#FFFFFF", wolkDonker:"#A9B4C2", wolkDekking:.9, wolkSchaduw:.42,
    rivier:"#5C8F9C", zand:"#DCCDA2", bodemOndiep:"#C9BE98", bodemDiep:"#4E747E",
    akkers:["#D6C47A","#A6B567","#93805A","#C3C98B","#B9A86C"]
  },
  donker:{
    zon:[-.44,.62,-.65], zonKleur:"#B4C8EC", zonSterkte:2.0,
    hemelLicht:"#3A5078", grondLicht:"#10141A", hemiSterkte:.95,
    zenit:"#03060D", nevel:"#152230", gloed:"#6A82AA",
    nevelDicht:.0034, nevelVal:.028,
    ondiep:"#1A454C", diep:"#02080D", schuim:"#7F909B",
    belichting:1.45, sterren:1, lichtjes:1,
    wolkLicht:"#5A6A80", wolkDonker:"#161E29", wolkDekking:.6, wolkSchaduw:.3,
    rivier:"#2E4F59", zand:"#4E4936", bodemOndiep:"#3B3A2D", bodemDiep:"#0A171C",
    akkers:["#5C5531","#3E4B2A","#3B3225","#4B5333","#504A2C"]
  }
};

/* ---- nevel en lucht, als shadercode ----
   De nevel van three.js is overal even dik. Echte verte niet: lucht is laag bij
   de grond het dikst, en wie hoog vliegt kijkt er grotendeels overheen. Deze
   nevel volgt dat (exponentieel met de hoogte), en kleurt warmer in de richting
   van de zon. Hij vervangt de standaardnevel van alle materialen hieronder.

   three.js past nevel toe ná de kleuromzetting naar het scherm; daarom gaat de
   nevelkleur hier eerst zelf door diezelfde omzetting, anders sluit de horizon
   niet aan op de lucht. */
const NEVEL_GLSL=`
uniform vec3 uZonRicht;
uniform vec3 uZonGloed;
uniform vec3 uNevelKleur;
uniform float uNevelDicht;
uniform float uNevelVal;
vec3 nevelKleurVoor(vec3 d){
  float zon=pow(max(dot(d,uZonRicht),0.0),6.0);
  return mix(uNevelKleur,uZonGloed,zon*.65);
}
vec3 naarScherm(vec3 c){
  #ifdef TONE_MAPPING
    c=toneMapping(c);
  #endif
  return linearToOutputTexel(vec4(c,1.0)).rgb;
}
float nevelHoeveel(vec3 wp){
  vec3 rd=wp-cameraPosition; float afst=length(rd); rd/=max(afst,1e-4);
  float k=uNevelVal*rd.y*afst;
  float f=abs(k)>1e-3?(1.0-exp(-k))/k:1.0-.5*k;
  float n=uNevelDicht*exp(-uNevelVal*max(cameraPosition.y,0.0))*afst*f;
  return 1.0-exp(-max(n,0.0));
}
vec3 nevel(vec3 schermKleur,vec3 wp){
  vec3 rd=normalize(wp-cameraPosition);
  return mix(schermKleur,naarScherm(nevelKleurVoor(rd)),nevelHoeveel(wp));
}`;
const LUCHT_GLSL=`
uniform vec3 uZenit;
vec3 luchtKleur(vec3 d){
  vec3 h=nevelKleurVoor(d);
  float y=max(d.y,0.0);
  vec3 c=mix(h,uZenit,pow(y,.5)*.95);
  float s=max(dot(d,uZonRicht),0.0);
  c+=uZonGloed*pow(s,48.0)*.6;
  return c;
}`;
/* Wolkschaduw: de plek op het wolkendek die tussen dit punt en de zon in ligt. */
const WOLK_GLSL=`
uniform sampler2D uWolkKaart;
uniform vec2 uWind;
uniform vec4 uWolkVak;
uniform float uWolkSterkte;
float wolkSchaduw(vec3 wp){
  if(uWolkSterkte<=0.0)return 1.0;
  vec2 q=wp.xz+uZonRicht.xz/max(uZonRicht.y,.2)*(${WOLKHOOGTE.toFixed(1)}-wp.y)-uWind;
  float c=texture2D(uWolkKaart,(q-uWolkVak.xy)/uWolkVak.zw).r;
  return 1.0-uWolkSterkte*c;
}`;
function installeerNevel(){
  if(THREE.ShaderChunk.__gjNevel)return;
  THREE.ShaderChunk.__gjNevel=true;
  THREE.ShaderChunk.fog_pars_vertex="#ifdef USE_FOG\nvarying vec3 vNevelW;\n#endif";
  THREE.ShaderChunk.fog_vertex="#ifdef USE_FOG\nvNevelW=(inverse(viewMatrix)*mvPosition).xyz;\n#endif";
  THREE.ShaderChunk.fog_pars_fragment="#ifdef USE_FOG\nvarying vec3 vNevelW;\n"+NEVEL_GLSL+"\n#endif";
  THREE.ShaderChunk.fog_fragment="#ifdef USE_FOG\ngl_FragColor.rgb=nevel(gl_FragColor.rgb,vNevelW);\n#endif";
}

/* ---- kleine hulpjes ---- */
const klem=(v,a,b)=>v<a?a:v>b?b:v;
const glad=t=>t*t*(3-2*t);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDonker=()=>+css("--donker")>0;
const rgb=hex=>{ const s=hex.replace("#",""); const n=parseInt(s.length===3?s.replace(/./g,"$&$&"):s,16); return [n>>16&255,n>>8&255,n&255]; };
const mengIn=(k,doel,t)=>{ k[0]+=(doel[0]-k[0])*t; k[1]+=(doel[1]-k[1])*t; k[2]+=(doel[2]-k[2])*t; };
/* "var(--pers-3)" of "#abc" → een echte kleur */
function cssKleur(v){
  const m=/var\((--[^)]+)\)/.exec(v||"");
  return (m?css(m[1]):v)||"#888";
}

/* Exacte afstand (Felzenszwalb) tot het dichtstbijzijnde punt waar bron[p]==0,
   in kaarteenheden. Zelfde methode als in bouwGrond(). */
function afstandVeld(bron,RW,RH,res){
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

/* Ruis die naadloos herhaalt: nodig voor alles wat als tegel over een vlak
   loopt (de golven, het wolkendek). Het rooster wordt rondgeteld met periode P. */
function maakHerhaalRuis(hash2){
  const sm=t=>t*t*t*(t*(t*6-15)+10);
  const h=(x,y,P,z)=>hash2(((x%P)+P)%P+z*7919,((y%P)+P)%P-z*3571);
  const r=(x,y,P,z)=>{
    const x0=Math.floor(x), y0=Math.floor(y), fx=sm(x-x0), fy=sm(y-y0);
    const a=h(x0,y0,P,z), b=h(x0+1,y0,P,z), c=h(x0,y0+1,P,z), d=h(x0+1,y0+1,P,z);
    return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
  };
  /* u,v lopen van 0 tot 1 over de hele tegel */
  return (u,v,P0,lagen,zaad=0)=>{
    let som=0,gew=1,tot=0,P=P0;
    for(let i=0;i<lagen;i++){ som+=r(u*P,v*P,P,zaad+i)*gew; tot+=gew; gew*=.5; P*=2; }
    return som/tot;
  };
}

/* Een veelvlak uit punten en vlakken, met de normalen naar buiten gedraaid
   (vanuit het midden gezien). Zo hoeft niemand per driehoek na te denken over
   de draairichting. Zonder index, zodat alles straks samengevoegd kan worden. */
function veelvlak(punten,vlakken){
  const m=[0,0,0]; for(const p of punten){m[0]+=p[0];m[1]+=p[1];m[2]+=p[2];}
  m[0]/=punten.length; m[1]/=punten.length; m[2]/=punten.length;
  const pos=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3(),mid=new THREE.Vector3();
  for(const v of vlakken)for(let i=1;i<v.length-1;i++){
    a.fromArray(punten[v[0]]); b.fromArray(punten[v[i]]); c.fromArray(punten[v[i+1]]);
    n.subVectors(b,a).cross(c.clone().sub(a));
    mid.copy(a).add(b).add(c).multiplyScalar(1/3).sub(new THREE.Vector3(...m));
    if(n.dot(mid)<0)pos.push(...a.toArray(),...c.toArray(),...b.toArray());
    else pos.push(...a.toArray(),...b.toArray(),...c.toArray());
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  return g;
}

/* ========================================================================== */
export async function maak3D(ctx){
  installeerNevel();
  const {W,H}=ctx, T=ctx.terrein;
  const houder=ctx.houder;
  const X=wx=>wx-W/2, Z=wy=>wy-H/2;
  const naarKaart=v=>[v.x+W/2,v.z+H/2];
  const minderBeweging=()=>matchMedia("(prefers-reduced-motion:reduce)").matches;

  /* ---- renderer ---- */
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
  if(!renderer.capabilities.isWebGL2)throw new Error("WebGL2 is nodig voor de 3D-weergave");
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  houder.appendChild(renderer.domElement);
  const labelRenderer=new CSS2DRenderer();
  labelRenderer.domElement.className="l3laag";
  houder.appendChild(labelRenderer.domElement);

  /* Hoe fijn het raster is: op een flinke computer drie punten per eenheid, op
     een telefoon twee. Het raster wordt een plaatje, en dat moet in één
     textuur passen. */
  const maxTex=renderer.capabilities.maxTextureSize;
  const klein=innerWidth<900||(navigator.hardwareConcurrency||4)<4;
  const RES=(!klein&&maxTex>=W*3)?3:2;
  const RW=Math.round(W*RES), RH=Math.round(H*RES), N=RW*RH;

  const scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0xffffff,0.001);   /* alleen om USE_FOG aan te zetten; de echte nevel staat hierboven */
  const camera=new THREE.PerspectiveCamera(FOV,1,.05,9000);
  const wereld=new THREE.Group();                 /* alles wat met het land mee omhoog komt */
  scene.add(wereld);

  const GEDEELD={
    uZonRicht:{value:new THREE.Vector3(0,1,0)}, uZonGloed:{value:new THREE.Color()},
    uNevelKleur:{value:new THREE.Color()}, uNevelDicht:{value:.003}, uNevelVal:{value:.03},
    uZenit:{value:new THREE.Color()}, uTijd:{value:0},
    uWolkKaart:{value:null}, uWind:{value:new THREE.Vector2()}, uWolkVak:{value:new THREE.Vector4(-W,-H,2*W,2*H)},
    uWolkSterkte:{value:0}
  };
  const metNevel=sh=>Object.assign(sh.uniforms,GEDEELD);

  /* ---- licht ---- */
  const zon=new THREE.DirectionalLight(0xffffff,3);
  zon.castShadow=true;
  zon.shadow.mapSize.set(klein?2048:4096,klein?2048:4096);
  zon.shadow.camera.near=1; zon.shadow.camera.far=4000;
  scene.add(zon,zon.target);
  const hemi=new THREE.HemisphereLight(0xffffff,0x444444,1);
  scene.add(hemi);

  /* ---- lucht ----
   Een koepel om de camera heen. Zelfde kleurfunctie als de nevel en de
   weerspiegeling in het water, zodat horizon, verte en zee op elkaar aansluiten. */
  const luchtMat=new THREE.ShaderMaterial({
    uniforms:{...GEDEELD,uZonKleur:{value:new THREE.Color()},uZonSchijf:{value:1}},
    vertexShader:`varying vec3 vRicht;
      void main(){ vRicht=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:NEVEL_GLSL+LUCHT_GLSL+`
      uniform vec3 uZonKleur; uniform float uZonSchijf; varying vec3 vRicht;
      void main(){
        vec3 d=normalize(vRicht);
        vec3 c=luchtKleur(d);
        float s=dot(d,uZonRicht);
        c+=uZonKleur*smoothstep(.99955,.99985,s)*uZonSchijf*14.0;
        gl_FragColor=vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side:THREE.BackSide, depthWrite:false
  });
  const lucht=new THREE.Mesh(new THREE.SphereGeometry(4200,48,24),luchtMat);
  lucht.frustumCulled=false; lucht.renderOrder=-10;
  scene.add(lucht);
  const sterren=(()=>{
    const n=2600, p=new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const u=T.hash2(i,17), v=T.hash2(i,91);
      const th=u*Math.PI*2, y=.04+v*.96, r=Math.sqrt(1-y*y);
      p[i*3]=Math.cos(th)*r*3900; p[i*3+1]=y*3900; p[i*3+2]=Math.sin(th)*r*3900;
    }
    const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(p,3));
    const m=new THREE.PointsMaterial({color:0xE8EEFF,size:1.6,sizeAttenuation:false,transparent:true,opacity:.85,depthWrite:false,fog:false});
    const s=new THREE.Points(g,m); s.frustumCulled=false; s.renderOrder=-9; return s;
  })();
  scene.add(sterren);

  /* ---- golven: een naadloze tegel met normalen ---- */
  const herhaal=maakHerhaalRuis(T.hash2);
  const golfTex=(()=>{
    const S=256, hgt=new Float32Array(S*S), d=new Uint8Array(S*S*4);
    for(let y=0;y<S;y++)for(let x=0;x<S;x++)hgt[y*S+x]=herhaal(x/S,y/S,6,5,3);
    for(let y=0;y<S;y++)for(let x=0;x<S;x++){
      const l=hgt[y*S+(x+S-1)%S], r=hgt[y*S+(x+1)%S], o=hgt[((y+S-1)%S)*S+x], b=hgt[((y+1)%S)*S+x];
      const nx=(l-r)*7, ny=(o-b)*7, len=Math.hypot(nx,ny,1);
      const q=(y*S+x)*4;
      d[q]=(nx/len*.5+.5)*255; d[q+1]=(ny/len*.5+.5)*255; d[q+2]=(1/len*.5+.5)*255; d[q+3]=255;
    }
    const t=new THREE.DataTexture(d,S,S,THREE.RGBAFormat);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.generateMipmaps=true;
    t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
    return t;
  })();

  /* ---- korrel voor de grond van dichtbij: ook een naadloze tegel ---- */
  const detailTex=(()=>{
    const S=256, d=new Uint8Array(S*S*4);
    for(let y=0;y<S;y++)for(let x=0;x<S;x++){
      const v=herhaal(x/S,y/S,16,4,21)*.7+herhaal(x/S,y/S,48,2,23)*.3;
      const q=(y*S+x)*4, c=klem((v-.5)*2.2+.5,0,1)*255;
      d[q]=d[q+1]=d[q+2]=c; d[q+3]=255;
    }
    const t=new THREE.DataTexture(d,S,S,THREE.RGBAFormat);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.generateMipmaps=true;
    t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
    return t;
  })();

  /* ---- besturing ----
   Als op een kaart: slepen schuift, rechts slepen (of twee vingers) draait en
   kantelt, scrollen zoomt naar de muis toe. */
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
  controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};
  controls.screenSpacePanning=false;
  controls.enableDamping=true; controls.dampingFactor=.09;
  controls.zoomToCursor=true;
  controls.minDistance=1.2; controls.maxDistance=1500;
  controls.maxPolarAngle=Math.PI*.49;
  controls.zoomSpeed=1.1; controls.rotateSpeed=.6;
  controls.keyPanSpeed=25;
  controls.listenToKeyEvents(window);
  controls.enabled=false;

  /* ===================== de gegevens: hoogte en kleur ===================== */
  let D=null;                   /* alles wat uit world.svg en data.json volgt */

  async function bouwGegevens(){
    const adem=ctx.adem;
    const ids=Object.keys(ctx.GEO.vormen);
    /* --- welk gebied ligt waar --- */
    const cv=document.createElement("canvas"); cv.width=RW; cv.height=RH;
    const c2=cv.getContext("2d",{willReadFrequently:true});
    c2.setTransform(RES,0,0,RES,0,0);
    ids.forEach((id,i)=>{ c2.fillStyle=`rgb(${i+1},0,0)`; for(const d of ctx.GEO.vormen[id])c2.fill(new Path2D(d)); });
    const rd=c2.getImageData(0,0,RW,RH).data;
    const reg=new Uint8Array(N), land=new Uint8Array(N), zee=new Uint8Array(N);
    for(let p=0,q=0;p<N;p++,q+=4){ reg[p]=rd[q]; if(rd[q+3]>120)land[p]=1; else zee[p]=1; }
    cv.width=cv.height=1;
    await adem();

    /* --- de rivieren, zoals de kaart ze getekend heeft --- */
    const rivier=new Uint8Array(N);
    {
      const rc=document.createElement("canvas"); rc.width=RW; rc.height=RH;
      const r2=rc.getContext("2d",{willReadFrequently:true});
      r2.setTransform(RES,0,0,RES,0,0);
      r2.strokeStyle="#fff"; r2.lineCap="round"; r2.lineJoin="round";
      for(const r of ctx.rivieren()){
        /* op de kaart is de dikte een lijndikte; in het landschap een rivier
           van een halve eenheid breed is al een flinke stroom */
        r2.lineWidth=(/\br3\b/.test(r.klasse)?2.1:/\br2\b/.test(r.klasse)?1.4:.85)*.42;
        r2.stroke(new Path2D(r.d));
      }
      const a=r2.getImageData(0,0,RW,RH).data;
      for(let p=0;p<N;p++)rivier[p]=land[p]?a[p*4+3]:0;
      rc.width=rc.height=1;
    }

    /* --- terreinvelden op een grof rooster, zacht over de grenzen heen ---
       Precies zoals in bouwGrond(); kleur komt later (die hangt van het thema af),
       hier alleen wat er groeit en hoe hoog en grillig het wordt. */
    const PW=W, PH=H, M=PW*PH;
    const pc=document.createElement("canvas"); pc.width=PW; pc.height=PH;
    const pctx=pc.getContext("2d",{willReadFrequently:true});
    ids.forEach((id,i)=>{ pctx.fillStyle=`rgb(${i+1},0,0)`; for(const d of ctx.GEO.vormen[id])pctx.fill(new Path2D(d)); });
    const pd=pctx.getImageData(0,0,PW,PH).data;
    const pReg=new Uint8Array(M); for(let p=0;p<M;p++)pReg[p]=pd[p*4+3]>120?pd[p*4]:0;
    const fAmp=new Float32Array(M), fRug=new Float32Array(M), fKoud=new Float32Array(M);
    const fKust=new Float32Array(M), fFijn=new Float32Array(M), fBos=new Float32Array(M), fLoof=new Float32Array(M);
    const mixA=new Uint8Array(M), mixB=new Uint8Array(M), mixF=new Float32Array(M);
    const SOORTEN=Object.keys(T.GROEI);
    fAmp.fill(.4); fRug.fill(.3); fLoof.fill(.5);
    const gras=SOORTEN.indexOf("grasland"); mixA.fill(gras); mixB.fill(gras);
    const info={};
    ids.forEach((id,i)=>{
      const tr=T.terreinVan(id);
      const meta=ctx.GEBIEDEN[id]||ctx.PLAATSEN.find(p=>p.vorm===id);
      const soorten=[].concat(tr.begroeiing||"grasland").map(s=>T.GROEI[s]?s:"grasland");
      info[i+1]={r:T.RELIEF[tr.relief]||T.RELIEF.heuvels,soorten,koud:tr.koud?1:0,tint:(meta&&meta.tint)||"a"};
    });
    const BOS={loofbos:[1,1],naaldbos:[1,0],jungle:[1,1],moeras:[.22,1]};
    for(let y=0;y<PH;y++)for(let x=0;x<PW;x++){
      const p=y*PW+x, g=info[pReg[p]]; if(!g)continue;
      fAmp[p]=g.r.amp; fRug[p]=g.r.rug; fKoud[p]=g.koud;
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
    T.veeg(fAmp,PW,PH,30); T.veeg(fRug,PW,PH,30); T.veeg(fKoud,PW,PH,30);
    T.veeg(fBos,PW,PH,6); T.veeg(fLoof,PW,PH,6);

    /* plaatsen en hun landschapsvlekken (het Grimsdell Woud enzovoort) */
    const POS={};
    for(const p of ctx.PLAATSEN){ if(p.wacht)continue; const r=ctx.plek(p); if(r)POS[p.id]=r; }
    const vlekken=[];
    for(const p of ctx.PLAATSEN){
      if(!T.GROEI[p.begroeiing]||!POS[p.id])continue;
      const [x,y]=POS[p.id];
      vlekken.push({x,y,r:p.straal||14,rr:(p.straal||14)*1.75,soort:p.begroeiing,gebied:p.gebied});
    }
    for(const v of vlekken){
      const ba=BOS[v.soort]||[0,.5];
      for(let y=Math.max(0,Math.floor(v.y-v.rr));y<=Math.min(PH-1,Math.ceil(v.y+v.rr));y++)
        for(let x=Math.max(0,Math.floor(v.x-v.rr));x<=Math.min(PW-1,Math.ceil(v.x+v.rr));x++){
          const p=y*PW+x; if(!pReg[p])continue;
          const golf=v.r*(.72+.56*T.ruis(x*.10+91,y*.10-53));
          const w=glad(klem(1-Math.hypot(x-v.x,y-v.y)/golf,0,1)); if(w<=0)continue;
          fBos[p]+=(ba[0]-fBos[p])*w; if(ba[0])fLoof[p]+=(ba[1]-fLoof[p])*w;
        }
    }
    await adem();

    /* --- afstand tot de kust, aan beide kanten --- */
    const kustAfst=afstandVeld(land,RW,RH,RES);
    const zeeAfst=afstandVeld(zee,RW,RH,RES);
    await adem();
    const dmax=new Float32Array(256);
    for(let p=0;p<N;p++)if(land[p]&&kustAfst[p]>dmax[reg[p]])dmax[reg[p]]=kustAfst[p];
    for(let p=0;p<M;p++){ const d=dmax[pd[p*4]]||30; fKust[p]=klem(d*.55,5,26); fFijn[p]=klem(48/Math.max(8,d),.75,2.6); }
    T.veeg(fKust,PW,PH,22); T.veeg(fFijn,PW,PH,22);
    pc.width=pc.height=1;

    /* De namen van de landen: op het punt dat het verst van de eigen grenzen
       ligt — gemeten tot zee én tot elk ander land, anders wint een gemengd
       randje op een landsgrens. */
    const pool={};
    {
      const binnen=new Uint8Array(N);
      for(let y=1;y<RH-1;y++)for(let x=1;x<RW-1;x++){
        const p=y*RW+x, r=reg[p];
        binnen[p]=land[p]&&land[p-1]&&land[p+1]&&land[p-RW]&&land[p+RW]
          &&reg[p-1]===r&&reg[p+1]===r&&reg[p-RW]===r&&reg[p+RW]===r?1:0;
      }
      const dg=afstandVeld(binnen,RW,RH,RES);
      for(let p=0;p<N;p++)if(binnen[p]){
        const r=reg[p], o=pool[r];
        if(!o||dg[p]>o.d)pool[r]={d:dg[p],x:(p%RW)/RES,y:Math.floor(p/RW)/RES};
      }
    }
    await adem();

    /* --- de hoogte --- */
    const lees=(f,wx,wy)=>{
      let ix=Math.floor(wx-.5), iy=Math.floor(wy-.5);
      if(ix<0)ix=0; else if(ix>PW-2)ix=PW-2;
      if(iy<0)iy=0; else if(iy>PH-2)iy=PH-2;
      let tx=wx-.5-ix, ty=wy-.5-iy; tx=klem(tx,0,1); ty=klem(ty,0,1);
      const a=iy*PW+ix;
      return f[a]*(1-tx)*(1-ty)+f[a+1]*tx*(1-ty)+f[a+PW]*(1-tx)*ty+f[a+PW+1]*tx*ty;
    };
    const keten=T.BERGKETENS||[];
    const ketenDoos=[1e9,1e9,-1e9,-1e9];
    for(const k of keten)for(const [x,y,r] of k.punten){
      ketenDoos[0]=Math.min(ketenDoos[0],x-r); ketenDoos[1]=Math.min(ketenDoos[1],y-r);
      ketenDoos[2]=Math.max(ketenDoos[2],x+r); ketenDoos[3]=Math.max(ketenDoos[3],y+r);
    }
    /* de keten doet verder dan zijn uitloop niets meer: dan hoeft hij ook niet gemeten */
    const totKeten=(wx,wy)=>(wx<ketenDoos[0]-90||wx>ketenDoos[2]+90||wy<ketenDoos[1]-90||wy>ketenDoos[3]+90)
      ?999:T.afstandTotKeten(wx,wy);
    const h=new Float32Array(N), kust=new Uint8Array(N);
    for(let y=0;y<RH;y++){
      for(let x=0;x<RW;x++){
        const p=y*RW+x, wx=x/RES, wy=y/RES;
        if(!land[p]){
          /* zeebodem: een flauwe plaat langs de kust, daarna dieper */
          const d=zeeAfst[p];
          h[p]=-(1-Math.exp(-d/13))*(.86+.28*T.ruis(wx*.05+7,wy*.05-3));
          continue;
        }
        const dk=kustAfst[p];
        const k=glad(Math.min(1,dk/lees(fKust,wx,wy)));
        kust[p]=Math.min(255,dk*RES*6);
        const n=T.landruis(wx,wy,lees(fFijn,wx,wy),.026,6,lees(fRug,wx,wy));
        const basis=k*lees(fAmp,wx,wy)*(.24+.76*n);
        const dK=totKeten(wx,wy);
        const kr=klem(1-dK/70,0,1), kT=kr*kr*kr*(10-15*kr+6*kr*kr);
        const kH=kT>0?kT*(.42+.55*T.fbm(wx*.048,wy*.048,4,.55)):0;
        /* Op de platte kaart mag de bergketen tot in zee doorlopen; in 3D wordt
           dat een muur. De laatste eenheden lopen daarom altijd af: klif, geen wand. */
        const afloop=glad(Math.min(1,dk/12));
        h[p]=Math.min(1,basis+(kH-basis)*kT)*afloop;
        /* een rivier slijt een smalle geul uit */
        if(rivier[p])h[p]=Math.max(0,h[p]-rivier[p]/255*.012);
      }
      if(y%256===0)await adem();
    }
    await adem();
    erodeer(h,land,rivier);
    /* Een kasteel staat niet scheef op een helling: de grond eronder is
       geëgaliseerd, en loopt daarbuiten zacht over in het land eromheen.
       Dorpen krijgen hetzelfde, iets minder streng. */
    for(const p of ctx.PLAATSEN){
      const pos=POS[p.id]; if(!pos)continue;
      const maat={kasteel:[.75,1.7,1],stad:[.7,1.7,.8],haven:[.7,1.6,.8],ruine:[.45,1.1,.8]}[p.soort];
      if(!maat)continue;
      const [R0,R1,kracht]=maat, [cx,cy]=pos;
      const x0=Math.max(0,Math.floor((cx-R1)*RES)), x1=Math.min(RW-1,Math.ceil((cx+R1)*RES));
      const y0=Math.max(0,Math.floor((cy-R1)*RES)), y1=Math.min(RH-1,Math.ceil((cy+R1)*RES));
      let s=0,n=0;
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const q=y*RW+x; if(land[q]&&Math.hypot(x/RES-cx,y/RES-cy)<R0){s+=h[q];n++;}
      }
      if(!n)continue;
      const doel=s/n;
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const q=y*RW+x; if(!land[q])continue;
        const d=Math.hypot(x/RES-cx,y/RES-cy); if(d>=R1)continue;
        const w=d<R0?1:1-glad((d-R0)/(R1-R0));
        h[q]+=(doel-h[q])*w*kracht;
      }
    }
    await adem();
    const grens=new Uint8Array(N);
    for(let y=1;y<RH-1;y++)for(let x=1;x<RW-1;x++){
      const p=y*RW+x; if(!land[p])continue; const r0=reg[p];
      if((land[p-1]&&reg[p-1]!==r0)||(land[p+1]&&reg[p+1]!==r0)||(land[p-RW]&&reg[p-RW]!==r0)||(land[p+RW]&&reg[p+RW]!==r0))grens[p]=1;
    }
    await adem();
    D={ids,reg,land,rivier,h,kust,grens,pReg,PW,PH,mixA,mixB,mixF,SOORTEN,fKoud,fBos,fLoof,
       fKust,fFijn,info,vlekken,POS,pool,lees,totKeten,sleutel:ctx.sleutel()};
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
  function erodeer(h,land,rivier){
    const EW=W, EH=H, E=new Float32Array(EW*EH);
    for(let y=0;y<EH;y++)for(let x=0;x<EW;x++){
      const p=Math.min(RH-1,Math.round((y+.5)*RES))*RW+Math.min(RW-1,Math.round((x+.5)*RES));
      E[y*EW+x]=land[p]?h[p]:-.05;
    }
    const voor=E.slice();
    /* de borstel waarmee een druppel uitslijt: een schijfje van straal 2 */
    const R=2, bo=[], bw=[];
    let som=0;
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
      const d=Math.hypot(dx,dy); if(d>R)continue;
      bo.push(dy*EW+dx); bw.push(R-d); som+=R-d;
    }
    for(let i=0;i<bw.length;i++)bw[i]/=som;
    const TRAAG=.05, DRAAG=4, MINDRAAG=.01, SLIJT=.3, LEG=.3, DAMP=.012, ZWAARTE=4, LEVEN=34;
    /* startplekken: alleen waar het land hoog genoeg is om te slijten */
    const starts=[];
    for(let y=R+1;y<EH-R-1;y++)for(let x=R+1;x<EW-R-1;x++)if(E[y*EW+x]>.1)starts.push(y*EW+x);
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
        if(px<R+1||py<R+1||px>=EW-R-2||py>=EH-R-2)break;
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

  /* hoogte op een willekeurige plek, uit het raster (0..1 land, -1..0 zee) */
  function hNorm(wx,wy){
    if(wx<0||wy<0||wx>W||wy>H)return -1;
    const fx=Math.min(RW-1.001,wx*RES), fy=Math.min(RH-1.001,wy*RES);
    const x0=fx|0, y0=fy|0, tx=fx-x0, ty=fy-y0, p=y0*RW+x0, h=D.h;
    return h[p]*(1-tx)*(1-ty)+h[p+1]*tx*(1-ty)+h[p+RW]*(1-tx)*ty+h[p+RW+1]*tx*ty;
  }
  /* Van reliëf naar hoogte. Niet recht evenredig: heuvelland blijft glooiend
     (Araluen is akkers en bossen, geen Alpen) terwijl een echt gebergte zijn
     volle hoogte krijgt. */
  const Yvan=h=>h>=0?LAND0+h*(.5+.5*h)*SCHAAL:-ZEE0+h*ZEEDIEPTE;
  const yOp=(wx,wy)=>Yvan(hNorm(wx,wy));
  /* ligt dit punt op het land? Langs de kust is het land zo laag dat de
     hoogte er niets over zegt; het raster van de landvormen wel */
  const opLand=(wx,wy)=>wx>0&&wy>0&&wx<W&&wy<H&&D.land[Math.floor(wy*RES)*RW+Math.floor(wx*RES)]===1;
  /* de grond onder een punt, met water als bodem — zo hoog als de camera minstens moet */
  const grondY=(wx,wy)=>Math.max(0,yOp(wx,wy))*wereld.scale.y;

  /* ---- de kleur van het land ----
     Zelfde opbouw als in bouwGrond(): begroeiing, de tint van het land, rots
     en sneeuw op de hoogte, de korrel van het bos. Daarbij wat de platte kaart
     niet nodig heeft: steile hellingen worden rots, in kommen en geulen valt
     wat minder licht, en rond dorpen en kastelen ligt een lappendeken van akkers. */
  function bouwKleur(){
    const donker=isDonker(), th=donker?THEMA.donker:THEMA.licht;
    const {PW,PH,pReg,info,lees,h,land,kust,grens,rivier,reg}=D;
    const M=PW*PH;
    const fR=new Float32Array(M), fG=new Float32Array(M), fB=new Float32Array(M);
    const fKorrel=new Float32Array(M), fVlek=new Float32Array(M);
    const kleurVan=s=>rgb(donker?T.GROEI[s].donker:T.GROEI[s].licht);
    const tonen={}; for(const k of "abcdef")tonen[k]=rgb(css("--tone-"+k)||"#888888");
    const TOON=.30;      /* zelfde als in bouwGrond() */
    const middel=kleurVan("grasland");
    fR.fill(middel[0]); fG.fill(middel[1]); fB.fill(middel[2]);
    fKorrel.fill(T.GROEI.grasland.korrel); fVlek.fill(T.GROEI.grasland.vlek);
    for(let p=0;p<M;p++){
      const g=info[pReg[p]]; if(!g)continue;
      const a=D.SOORTEN[D.mixA[p]], b=D.SOORTEN[D.mixB[p]], mf=D.mixF[p];
      const ka=kleurVan(a), kb=kleurVan(b), o=tonen[g.tint]||tonen.a;
      const k=[ka[0]+(kb[0]-ka[0])*mf,ka[1]+(kb[1]-ka[1])*mf,ka[2]+(kb[2]-ka[2])*mf];
      fR[p]=k[0]+(o[0]-k[0])*TOON; fG[p]=k[1]+(o[1]-k[1])*TOON; fB[p]=k[2]+(o[2]-k[2])*TOON;
      const ga=T.GROEI[a], gb=T.GROEI[b];
      fKorrel[p]=ga.korrel+(gb.korrel-ga.korrel)*mf; fVlek[p]=ga.vlek+(gb.vlek-ga.vlek)*mf;
    }
    for(const f of [fR,fG,fB,fKorrel,fVlek])T.veeg(f,PW,PH,22);
    for(const v of D.vlekken){
      const meta=ctx.GEBIEDEN[v.gebied], o=tonen[(meta&&meta.tint)||"a"]||tonen.a, kl=kleurVan(v.soort);
      const k=[kl[0]+(o[0]-kl[0])*TOON,kl[1]+(o[1]-kl[1])*TOON,kl[2]+(o[2]-kl[2])*TOON];
      const gr=T.GROEI[v.soort];
      for(let y=Math.max(0,Math.floor(v.y-v.rr));y<=Math.min(PH-1,Math.ceil(v.y+v.rr));y++)
        for(let x=Math.max(0,Math.floor(v.x-v.rr));x<=Math.min(PW-1,Math.ceil(v.x+v.rr));x++){
          const p=y*PW+x; if(!pReg[p])continue;
          const golf=v.r*(.72+.56*T.ruis(x*.10+91,y*.10-53));
          const w=glad(klem(1-Math.hypot(x-v.x,y-v.y)/golf,0,1)); if(w<=0)continue;
          fR[p]+=(k[0]-fR[p])*w; fG[p]+=(k[1]-fG[p])*w; fB[p]+=(k[2]-fB[p])*w;
          fKorrel[p]+=(gr.korrel-fKorrel[p])*w; fVlek[p]+=(gr.vlek-fVlek[p])*w;
        }
    }
    /* holtes en ruggen: verschil tussen de hoogte en een vervaagde hoogte */
    const holte=new Float32Array(N);
    {
      const b=h.slice(); T.veeg(b,RW,RH,Math.round(1.5*RES));
      for(let p=0;p<N;p++)holte[p]=(h[p]-b[p])*SCHAAL;
      b.set(h); T.veeg(b,RW,RH,Math.round(7*RES));
      for(let p=0;p<N;p++)holte[p]+=(h[p]-b[p])*SCHAAL*.3;
    }
    const ROTS=rgb(css("--rots")||"#9C9782"), SNEEUW=rgb(css("--sneeuw")||"#F1EFE4"), GRENS=rgb(css("--coast")||"#5A6356");
    const ZAND=rgb(th.zand), RIV=rgb(th.rivier), BO=rgb(th.bodemOndiep), BD=rgb(th.bodemDiep);
    const uit=new Uint8Array(N*4);
    const k=[0,0,0];
    for(let y=0;y<RH;y++){
      for(let x=0;x<RW;x++){
        const p=y*RW+x, q=p*4, wx=x/RES, wy=y/RES, hh=h[p];
        if(!land[p]){
          /* zeebodem: zand langs de kust, dieper donker en blauwig */
          const t=glad(klem(-hh/.55,0,1));
          const n=.92+.16*T.ruis(wx*.35,wy*.35);
          uit[q]=(BO[0]+(BD[0]-BO[0])*t)*n; uit[q+1]=(BO[1]+(BD[1]-BO[1])*t)*n; uit[q+2]=(BO[2]+(BD[2]-BO[2])*t)*n;
          uit[q+3]=255; continue;
        }
        k[0]=lees(fR,wx,wy); k[1]=lees(fG,wx,wy); k[2]=lees(fB,wx,wy);
        const xl=x>0?p-1:p, xr=x<RW-1?p+1:p, yo=y>0?p-RW:p, yb=y<RH-1?p+RW:p;
        const gx=(Yvan(h[xr])-Yvan(h[xl]))*RES*.5, gz=(Yvan(h[yb])-Yvan(h[yo]))*RES*.5;
        const helling=Math.sqrt(gx*gx+gz*gz);
        if(hh>.40)mengIn(k,ROTS,Math.min(1,(hh-.40)/.42));
        mengIn(k,ROTS,glad(klem((helling-1.0)/1.4,0,1))*.8);
        const kk=glad(klem(1-D.totKeten(wx,wy)/30,0,1));
        const koud=Math.max(lees(D.fKoud,wx,wy),kk), sg=.90-.48*koud;
        if(hh>sg)mengIn(k,SNEEUW,Math.min(1,(hh-sg)/.30)*(1-glad(klem((helling-1.6)/1.6,0,1))*.7));
        let m=1+(T.fbm(wx*.42,wy*.42,4,0)-.5)*lees(fKorrel,wx,wy)*1.25
               +(T.ruis(wx*.085+311,wy*.085-127)-.5)*lees(fVlek,wx,wy);
        /* Bos is van boven een donker dek van kruinen. De echte boompjes staan
           alleen dichtbij; verder weg moet het land zelf al als bos lezen. */
        const bos=lees(D.fBos,wx,wy)*(1-glad(klem((hh-.38)/.25,0,1)));
        if(bos>.02){ m*=1-.40*bos; k[1]+=(k[1]*.10)*bos; }
        m*=klem(1+holte[p]*.07,.68,1.14);
        if(kust[p]<30){ const t=1-kust[p]/30; mengIn(k,ZAND,t*t*.85); }
        if(grens[p]){ mengIn(k,GRENS,.22); }
        let r=k[0]*m, g=k[1]*m, b=k[2]*m, nat=0;
        if(rivier[p]){ const t=rivier[p]/255; r+=(RIV[0]-r)*t; g+=(RIV[1]-g)*t; b+=(RIV[2]-b)*t; nat=t*.9; }
        uit[q]=klem(r,0,255); uit[q+1]=klem(g,0,255); uit[q+2]=klem(b,0,255);
        uit[q+3]=255-nat*255;
      }
    }
    /* de akkers rond dorpen en kastelen */
    const akk=th.akkers.map(rgb);
    for(const p of ctx.PLAATSEN){
      if(!/^(stad|haven|kasteel)$/.test(p.soort)||!D.POS[p.id])continue;
      const [cx,cy]=D.POS[p.id], R=p.soort==="kasteel"?3.0:3.6;
      const hk=T.hash2(cx*13|0,cy*7|0), rot=hk*Math.PI, co=Math.cos(rot), si=Math.sin(rot);
      for(let y=Math.max(0,Math.floor((cy-R)*RES));y<=Math.min(RH-1,Math.ceil((cy+R)*RES));y++)
        for(let x=Math.max(0,Math.floor((cx-R)*RES));x<=Math.min(RW-1,Math.ceil((cx+R)*RES));x++){
          const pp=y*RW+x; if(!land[pp]||h[pp]>.33||rivier[pp])continue;
          const dx=x/RES-cx, dy=y/RES-cy, d=Math.hypot(dx,dy);
          if(d>R||d<.55)continue;
          const u=(dx*co+dy*si)/.46, v=(-dx*si+dy*co)/.32;
          const cu=Math.floor(u), cv=Math.floor(v), hc=T.hash2(cu+997*(hk*100|0),cv-311);
          if(hc<.18)continue;
          const kl=akk[Math.floor(hc*akk.length)%akk.length];
          let w=(1-glad(d/R))*.55;
          const fu=u-cu, fv=v-cv, rand=Math.min(fu,1-fu,fv,1-fv);
          const q=pp*4;
          uit[q]+=(kl[0]-uit[q])*w; uit[q+1]+=(kl[1]-uit[q+1])*w; uit[q+2]+=(kl[2]-uit[q+2])*w;
          if(rand<.07){ const z=1-.16*w*2; uit[q]*=z; uit[q+1]*=z; uit[q+2]*=z; }
        }
    }
    return uit;
  }

  /* object-ruimte-normalen uit het hoogteveld: daarmee is elk rasterpunt scherp
     belicht, ook waar het 3D-net grover is dan het plaatje */
  function bouwNormalen(){
    const uit=new Uint8Array(N*4), h=D.h, s=2/RES;
    for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){
      const p=y*RW+x;
      const l=Yvan(h[x>0?p-1:p]), r=Yvan(h[x<RW-1?p+1:p]), o=Yvan(h[y>0?p-RW:p]), b=Yvan(h[y<RH-1?p+RW:p]);
      const nx=-(r-l)/s, nz=-(b-o)/s, len=Math.hypot(nx,1,nz), q=p*4;
      uit[q]=(nx/len*.5+.5)*255; uit[q+1]=(1/len*.5+.5)*255; uit[q+2]=(nz/len*.5+.5)*255; uit[q+3]=255;
    }
    return uit;
  }
  /* de waterdiepte voor de zee-shader, op half raster */
  function bouwDiepte(){
    const w=RW>>1, hh=RH>>1, uit=new Uint16Array(w*hh);
    for(let y=0;y<hh;y++)for(let x=0;x<w;x++)
      uit[y*w+x]=THREE.DataUtils.toHalfFloat(yOp(x*2/RES,y*2/RES));
    const t=new THREE.DataTexture(uit,w,hh,THREE.RedFormat,THREE.HalfFloatType);
    t.minFilter=t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
    return t;
  }

  /* ======================= het land: stukken met detail =======================
     Het land is opgedeeld in vakken van 40 bij 40. Elk vak wordt fijner naarmate
     de camera dichterbij komt: van een punt per vier eenheden in de verte tot
     vier per eenheid vlakbij. Een rok langs de rand dekt de naad tussen twee
     vakken van verschillende fijnheid af. */
  const VAK=40, VNX=Math.ceil(W/VAK), VNY=Math.ceil(H/VAK);
  const STAP=[.25,.5,1,2,4];
  const GRENZEN=[30,80,200,520];
  const indexen={};
  function indexVoor(n){
    if(indexen[n])return indexen[n];
    const v=n+1, rok=v*v, idx=[];
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){ const a=j*v+i,b=a+v,c=a+1,d=b+1; idx.push(a,b,c,b,d,c); }
    const rand=(e,k)=>e===0?k:e===1?k*v+n:e===2?n*v+(n-k):(n-k)*v;
    for(let e=0;e<4;e++)for(let k=0;k<n;k++){
      const ea=rand(e,k), eb=rand(e,k+1), sa=rok+e*v+k, sb=sa+1;
      idx.push(ea,sa,eb, eb,sa,sb, ea,eb,sa, eb,sb,sa);
    }
    return indexen[n]=new THREE.BufferAttribute(new Uint32Array(idx),1);
  }
  function bouwVak(cx,cy,niv){
    const s=STAP[niv], n=Math.round(VAK/s), v=n+1, nv=v*v+4*v;
    const pos=new Float32Array(nv*3), nor=new Float32Array(nv*3), uv=new Float32Array(nv*2);
    const x0=cx*VAK, y0=cy*VAK;
    let i3=0,i2=0;
    for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
      const wx=x0+i*s, wy=y0+j*s, y=yOp(wx,wy);
      const nx=-(yOp(wx+s,wy)-yOp(wx-s,wy))/(2*s), nz=-(yOp(wx,wy+s)-yOp(wx,wy-s))/(2*s), l=Math.hypot(nx,1,nz);
      pos[i3]=X(wx); pos[i3+1]=y; pos[i3+2]=Z(wy);
      nor[i3]=nx/l; nor[i3+1]=1/l; nor[i3+2]=nz/l;
      uv[i2]=wx/W; uv[i2+1]=wy/H; i3+=3; i2+=2;
    }
    const rand=(e,k)=>e===0?k:e===1?k*v+n:e===2?n*v+(n-k):(n-k)*v;
    const zak=s*2.5+.6;
    for(let e=0;e<4;e++)for(let k=0;k<=n;k++){
      const b=rand(e,k);
      pos[i3]=pos[b*3]; pos[i3+1]=pos[b*3+1]-zak; pos[i3+2]=pos[b*3+2];
      nor[i3]=nor[b*3]; nor[i3+1]=nor[b*3+1]; nor[i3+2]=nor[b*3+2];
      uv[i2]=uv[b*2]; uv[i2+1]=uv[b*2+1]; i3+=3; i2+=2;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(pos,3));
    g.setAttribute("normal",new THREE.BufferAttribute(nor,3));
    g.setAttribute("uv",new THREE.BufferAttribute(uv,2));
    g.setIndex(indexVoor(n));
    g.computeBoundingSphere();
    return g;
  }
  let landMat=null, vakken=[], bouwRij=[], beeldNr=0;
  function maakLandMat(kleurTex,normTex){
    const m=new THREE.MeshStandardMaterial({map:kleurTex,normalMap:normTex,
      normalMapType:THREE.ObjectSpaceNormalMap,roughness:.93,metalness:0});
    m.onBeforeCompile=sh=>{
      metNevel(sh);
      sh.uniforms.uDetail={value:detailTex};
      sh.vertexShader=sh.vertexShader
        .replace("#include <common>","#include <common>\nvarying vec3 vWolkW;")
        .replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nvWolkW=(modelMatrix*vec4(transformed,1.0)).xyz;");
      sh.fragmentShader=sh.fragmentShader
        .replace("#include <fog_pars_fragment>","#include <fog_pars_fragment>\nvarying vec3 vWolkW;\nuniform sampler2D uDetail;\n"+WOLK_GLSL)
        /* Van dichtbij is het kleurplaatje te grof: dan een fijne korrel van
           gras, aarde en steen eroverheen, die in de verte weer wegvalt. */
        .replace("#include <map_fragment>",`#include <map_fragment>
          float dAfst=distance(vWolkW,cameraPosition);
          float korrel=texture2D(uDetail,vWolkW.xz*.83).r*.55+texture2D(uDetail,vWolkW.xz*3.1).r*.45;
          diffuseColor.rgb*=mix(1.0,.84+.32*korrel,1.0-smoothstep(6.0,55.0,dAfst));`)
        /* nat land (rivieren) glanst: de alfa van het kleurplaatje zegt hoe nat */
        .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
          float nat=1.0-texture2D(map,vMapUv).a;
          roughnessFactor=mix(roughnessFactor,.12,nat);`)
        .replace("#include <lights_fragment_end>",`#include <lights_fragment_end>
          float ws=wolkSchaduw(vWolkW);
          reflectedLight.directDiffuse*=ws; reflectedLight.directSpecular*=ws;`);
    };
    return m;
  }
  function maakVakken(){
    for(let cy=0;cy<VNY;cy++)for(let cx=0;cx<VNX;cx++){
      const g=bouwVak(cx,cy,4);
      g.computeBoundingBox();
      const mesh=new THREE.Mesh(g,landMat);
      mesh.castShadow=true; mesh.receiveShadow=true;
      wereld.add(mesh);
      vakken.push({cx,cy,mesh,geo:[null,null,null,null,g],gebruikt:[0,0,0,0,0],
        ymin:g.boundingBox.min.y,ymax:g.boundingBox.max.y,niv:4});
    }
  }
  const vb=new THREE.Box3(), vp=new THREE.Vector3();
  function werkVakkenBij(){
    beeldNr++;
    const cam=camera.position, sy=wereld.scale.y;
    bouwRij.length=0;
    for(const v of vakken){
      vb.min.set(X(v.cx*VAK),v.ymin*sy,Z(v.cy*VAK)); vb.max.set(X(v.cx*VAK+VAK),Math.max(v.ymax,0)*sy,Z(v.cy*VAK+VAK));
      const d=vb.distanceToPoint(cam);
      let wil=4; for(let i=0;i<4;i++)if(d<GRENZEN[i]){wil=i;break;}
      v.wil=wil; v.afst=d;
      if(!v.geo[wil])bouwRij.push(v);
      let toon=wil; while(!v.geo[toon])toon++;
      if(v.niv!==toon){ v.mesh.geometry=v.geo[toon]; v.niv=toon; }
      v.gebruikt[toon]=beeldNr;
    }
    /* de dichtstbijzijnde vakken eerst; een paar per beeldje, zodat het nooit hapert */
    bouwRij.sort((a,b)=>a.afst-b.afst);
    const t0=performance.now();
    for(const v of bouwRij){
      if(performance.now()-t0>7)break;
      v.geo[v.wil]=bouwVak(v.cx,v.cy,v.wil);
      v.mesh.geometry=v.geo[v.wil]; v.niv=v.wil; v.gebruikt[v.wil]=beeldNr;
    }
    /* fijne vakken die al een tijd niet gebruikt zijn: weg ermee */
    if(beeldNr%120===0)for(const v of vakken)for(let i=0;i<3;i++)
      if(v.geo[i]&&v.niv!==i&&beeldNr-v.gebruikt[i]>600){ v.geo[i].dispose(); v.geo[i]=null; }
  }

  /* ================================ water ================================ */
  let water=null, diepteTex=null;
  const waterMat=new THREE.ShaderMaterial({
    uniforms:{...GEDEELD,uDiepte:{value:null},uGolf:{value:golfTex},uKaart:{value:new THREE.Vector2(W,H)},
      uMaxDiep:{value:ZEEDIEPTE+ZEE0},uOndiep:{value:new THREE.Color()},uDiep:{value:new THREE.Color()},
      uSchuim:{value:new THREE.Color()},uZonKleur:{value:new THREE.Color()}},
    vertexShader:`varying vec3 vW;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader:NEVEL_GLSL+LUCHT_GLSL+WOLK_GLSL+`
      uniform float uTijd; uniform sampler2D uDiepte; uniform sampler2D uGolf; uniform vec2 uKaart; uniform float uMaxDiep;
      uniform vec3 uOndiep; uniform vec3 uDiep; uniform vec3 uSchuim; uniform vec3 uZonKleur;
      varying vec3 vW;
      void main(){
        vec2 k=(vW.xz+uKaart*.5)/uKaart;
        float bodem=-uMaxDiep;
        if(k.x>0.0&&k.y>0.0&&k.x<1.0&&k.y<1.0)bodem=texture2D(uDiepte,k).r;
        /* waar het plaatje land zegt, geen water — ook als het net daar net
           onder de waterlijn duikt; zo volgt de kust het plaatje, niet het net */
        float opLand=smoothstep(-.03,.05,bodem);
        if(opLand>=1.0)discard;
        float diepte=max(-bodem,0.0);
        vec3 V=cameraPosition-vW; float afst=length(V); V/=afst;
        vec2 p=vW.xz;
        vec3 g1=texture2D(uGolf,p*.071+uTijd*vec2(.011,.006)).xyz*2.0-1.0;
        vec3 g2=texture2D(uGolf,p*.19+uTijd*vec2(-.008,.014)).xyz*2.0-1.0;
        vec3 g3=texture2D(uGolf,p*.013+uTijd*vec2(.003,-.002)).xyz*2.0-1.0;
        float kalm=mix(.35,1.0,smoothstep(0.0,2.5,diepte));
        float vlak=mix(1.0,3.5,smoothstep(40.0,600.0,afst));
        vec3 n=normalize(vec3((g1.x+g2.x*.6+g3.x*.9)*kalm,2.4*vlak,(g1.y+g2.y*.6+g3.y*.9)*kalm));
        float ndv=max(dot(n,V),0.0);
        float fres=.02+.98*pow(1.0-ndv,5.0);
        vec3 R=reflect(-V,n); R.y=abs(R.y);
        vec3 spiegel=luchtKleur(R);
        float t=1.0-exp(-diepte*.42);
        float ws=wolkSchaduw(vW);
        vec3 licht=uZonKleur*max(uZonRicht.y,0.0)*.55*ws+uZenit*.35+uNevelKleur*.25;
        vec3 lichaam=mix(uOndiep,uDiep,t)*licht;
        vec3 Hh=normalize(uZonRicht+V);
        float ndh=max(dot(n,Hh),0.0);
        float glans=(pow(ndh,700.0)*9.0+pow(ndh,70.0)*.22)*ws;
        vec3 kleur=mix(lichaam,spiegel,fres)+uZonKleur*glans;
        /* schuim: een strook langs de kust, met golfjes die naar het strand rollen */
        float s=smoothstep(.32,0.0,diepte);
        float golfje=.5+.5*sin(diepte*34.0-uTijd*1.3+texture2D(uGolf,p*.45).r*7.0);
        float schuim=s*smoothstep(.55,1.0,golfje*s+texture2D(uGolf,p*1.1+uTijd*.02).g*.5);
        /* van ver wordt de schuimstreep een harde witte rand: dan zachter */
        schuim*=mix(1.0,.35,smoothstep(30.0,250.0,afst));
        kleur=mix(kleur,uSchuim*(licht*1.3+.12),clamp(schuim,0.0,1.0)*.65);
        float alfa=clamp(mix(.18,1.0,t)+fres*.55+schuim,0.0,1.0)*(1.0-opLand);
        gl_FragColor=vec4(kleur,alfa);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb=nevel(gl_FragColor.rgb,vW);
      }`,
    transparent:true, depthWrite:false
  });
  function maakWater(){
    water=new THREE.Mesh(new THREE.PlaneGeometry(W*12,H*12),waterMat);
    water.rotation.x=-Math.PI/2; water.renderOrder=1; water.frustumCulled=false;
    scene.add(water);
    /* de oceaanbodem buiten de kaart */
    const bodem=new THREE.Mesh(new THREE.PlaneGeometry(W*12,H*12),
      new THREE.MeshStandardMaterial({color:0x223844,roughness:1}));
    bodem.material.onBeforeCompile=metNevel;
    bodem.rotation.x=-Math.PI/2; bodem.position.y=-(ZEEDIEPTE+ZEE0)-.3;
    bodem.name="bodem";
    scene.add(bodem);
  }

  /* ================================ wolken ================================
     Een dek van losse wolkjes boven het land, met hun schaduw op de grond. Het
     dek is een naadloze tegel die met de wind meeschuift; dezelfde tegel
     bepaalt waar de wolkjes hangen en waar hun schaduw valt. */
  let wolken=null, wolkTex=null;
  function maakWolken(){
    /* Losse stapelwolken, geen deken: het dek is alleen dicht op een handvol
       plekken. Die plekken worden de wolken; hun schaduw volgt dezelfde kaart. */
    const S=256, d=new Uint8Array(S*S*4), dek=new Float32Array(S*S);
    for(let y=0;y<S;y++)for(let x=0;x<S;x++){
      const n=herhaal(x/S,y/S,3,4,11);
      dek[y*S+x]=glad(klem((n-.64)/.09,0,1));
    }
    for(let i=0;i<S*S;i++){ const v=dek[i]*255; d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=255; }
    wolkTex=new THREE.DataTexture(d,S,S,THREE.RGBAFormat);
    wolkTex.wrapS=wolkTex.wrapT=THREE.RepeatWrapping; wolkTex.magFilter=wolkTex.minFilter=THREE.LinearFilter;
    wolkTex.needsUpdate=true;
    GEDEELD.uWolkKaart.value=wolkTex;
    /* het plaatje van één bol wolk: dicht in het midden, rafelig naar de rand */
    const pc=document.createElement("canvas"); pc.width=pc.height=128;
    const c=pc.getContext("2d");
    for(let i=0;i<26;i++){
      const a=T.hash2(i,5)*Math.PI*2, r=Math.sqrt(T.hash2(i,9))*34, x=64+Math.cos(a)*r, y=64+Math.sin(a)*r*.8;
      const s=12+T.hash2(i,13)*20*(1-r/50);
      const g=c.createRadialGradient(x,y,0,x,y,s);
      g.addColorStop(0,"rgba(255,255,255,.5)"); g.addColorStop(.55,"rgba(255,255,255,.22)"); g.addColorStop(1,"rgba(255,255,255,0)");
      c.fillStyle=g; c.beginPath(); c.arc(x,y,s,0,7); c.fill();
    }
    const pufTex=new THREE.CanvasTexture(pc);
    /* Elke wolk is een tros bollen: een brede, vlakke onderkant en een bolle
       top. Een wolk staat waar het dek een top heeft. */
    const VAKW=uWolkVakArr(), posA=[], varA=[];
    for(let j=4;j<S-4;j+=4)for(let i=4;i<S-4;i+=4){
      const v=dek[j*S+i]; if(v<.6)continue;
      let top=true;
      for(let dy=-8;dy<=8&&top;dy+=4)for(let dx=-8;dx<=8;dx+=4){
        if(!dx&&!dy)continue;
        if(dek[((j+dy+S)%S)*S+(i+dx+S)%S]>v){top=false;break;}
      }
      if(!top)continue;
      const mx=VAKW[0]+i/S*VAKW[2], mz=VAKW[1]+j/S*VAKW[3];
      const breed=8+v*7, n=6+Math.floor(T.hash2(i,j)*4);
      for(let k=0;k<n;k++){
        const a=T.hash2(i*7+k,j*3)*Math.PI*2, r=Math.sqrt(T.hash2(j*5+k,i*11))*breed;
        const boven=1-r/breed;
        posA.push(mx+Math.cos(a)*r*1.3,WOLKHOOGTE+boven*boven*8+T.hash2(i+k,j)*2,mz+Math.sin(a)*r*.9,
          (17+T.hash2(k,i+j)*12)*(.75+boven*.6));
        varA.push(T.hash2(i+31*k,j+17));
      }
    }
    const g=new THREE.InstancedBufferGeometry();
    g.index=new THREE.PlaneGeometry(1,1).index;
    const pl=new THREE.PlaneGeometry(1,1);
    g.setAttribute("position",pl.getAttribute("position"));
    g.setAttribute("uv",pl.getAttribute("uv"));
    g.setAttribute("aPuf",new THREE.InstancedBufferAttribute(new Float32Array(posA),4));
    g.setAttribute("aVar",new THREE.InstancedBufferAttribute(new Float32Array(varA),1));
    g.instanceCount=varA.length;
    const m=new THREE.ShaderMaterial({
      uniforms:{...GEDEELD,uPuf:{value:pufTex},uWolkLicht:{value:new THREE.Color()},uWolkDonker:{value:new THREE.Color()},uDekking:{value:.9}},
      vertexShader:`attribute vec4 aPuf; attribute float aVar; uniform vec2 uWind; uniform vec4 uWolkVak;
        varying vec2 vUv; varying vec3 vW; varying float vVar; varying float vHoog;
        void main(){
          vec3 c=aPuf.xyz; c.xz+=uWind;
          vHoog=clamp((c.y-${WOLKHOOGTE.toFixed(1)})/9.0,0.0,1.0);
          c.xz=uWolkVak.xy+mod(c.xz-uWolkVak.xy,uWolkVak.zw);
          vec3 rechts=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          vec3 op=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
          vec3 w=c+(rechts*position.x+op*position.y*.6)*aPuf.w;
          vW=w; vUv=uv; vVar=aVar;
          gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);
        }`,
      fragmentShader:NEVEL_GLSL+`
        uniform sampler2D uPuf; uniform vec3 uWolkLicht; uniform vec3 uWolkDonker; uniform float uDekking;
        varying vec2 vUv; varying vec3 vW; varying float vVar; varying float vHoog;
        void main(){
          vec4 t=texture2D(uPuf,vUv);
          float afst=distance(vW,cameraPosition);
          float a=t.a*uDekking*smoothstep(8.0,45.0,afst);
          if(a<.004)discard;
          /* van boven beschenen: de top licht, de onderkant van de wolk grijzer */
          float licht=mix(.55,1.05,smoothstep(.1,.95,vUv.y))*mix(.78,1.06,vHoog)*(.94+.12*vVar);
          vec3 c=mix(uWolkDonker,uWolkLicht,clamp(licht,0.0,1.2));
          gl_FragColor=vec4(c,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb=nevel(gl_FragColor.rgb,vW);
        }`,
      transparent:true, depthWrite:false
    });
    wolken=new THREE.Mesh(g,m);
    wolken.frustumCulled=false; wolken.renderOrder=3;
    scene.add(wolken);
  }
  function uWolkVakArr(){ const v=GEDEELD.uWolkVak.value; return [v.x,v.y,v.z,v.w]; }

  /* ================================ bomen ================================
   Alleen in de buurt van waar je kijkt staan echte boompjes; verder weg is
   het bos de kleur en de korrel van het land, net als op de kaart. Aan de rand
   van het boomgebied krimpen ze weg, zodat er geen harde grens te zien is. */
  const BOOMVAK=10, BOOMVER=36, boomVakken=new Map();
  let bomen=null, boomStand={x:1e9,z:1e9,r:0,t:0};
  /* uOog: de camera. In de schaduwberekening is cameraPosition de zon, en de
     schaduw moet krimpen met de boom zoals de camera hem ziet. */
  const boomU={uBoomMidden:{value:new THREE.Vector2()},uBoomStraal:{value:30},uOog:{value:new THREE.Vector3()}};
  const gebouwPlekken=[];        /* [x,y,straal]: daar geen bomen */
  function maakBomen(){
    /* De vorm van een boom, met de kleur in de hoekpunten: de stam donker, de
       kruin onderin donkerder dan bovenin — daar valt minder licht. De kleur
       per boom komt er straks nog overheen. */
    const boom=(stam,kruin)=>{
      const delen=[stam,...kruin].map(g=>{ g=g.index?g.toNonIndexed():g; g.deleteAttribute("uv"); return g; });
      const ns=delen[0].getAttribute("position").count;
      const g=mergeGeometries(delen);
      const p=g.getAttribute("position"), c=new Float32Array(p.count*3);
      let y0=1e9,y1=-1e9; for(let i=ns;i<p.count;i++){ y0=Math.min(y0,p.getY(i)); y1=Math.max(y1,p.getY(i)); }
      for(let i=0;i<p.count;i++){
        if(i<ns){ c[i*3]=.30; c[i*3+1]=.23; c[i*3+2]=.17; continue; }
        const t=(p.getY(i)-y0)/(y1-y0), v=.55+.6*t;
        c[i*3]=v; c[i*3+1]=v; c[i*3+2]=v*.92;
      }
      g.setAttribute("color",new THREE.BufferAttribute(c,3));
      return g;
    };
    const naald=boom(new THREE.CylinderGeometry(.007,.01,.08,5).translate(0,.04,0),[
      new THREE.ConeGeometry(.068,.16,7).translate(0,.12,0),
      new THREE.ConeGeometry(.052,.13,7).translate(0,.2,0),
      new THREE.ConeGeometry(.032,.10,7).translate(0,.27,0)]);
    const loof=boom(new THREE.CylinderGeometry(.008,.011,.08,5).translate(0,.04,0),[
      new THREE.IcosahedronGeometry(.07,1).scale(1.1,.85,1).translate(0,.12,0),
      new THREE.IcosahedronGeometry(.055,1).translate(.045,.15,.02),
      new THREE.IcosahedronGeometry(.05,1).translate(-.04,.16,-.03),
      new THREE.IcosahedronGeometry(.045,1).translate(.005,.19,.035)]);
    const maakMat=()=>{
      const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:0});
      m.onBeforeCompile=sh=>{
        metNevel(sh); Object.assign(sh.uniforms,boomU);
        sh.vertexShader=sh.vertexShader
          .replace("#include <common>","#include <common>\nuniform vec2 uBoomMidden; uniform float uBoomStraal; varying vec3 vWolkW;")
          .replace("#include <begin_vertex>",`#include <begin_vertex>
            vec3 bp=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
            float bd=distance(bp.xz,uBoomMidden);
            transformed*=1.0-smoothstep(uBoomStraal*.7,uBoomStraal,bd);
            /* verder dan een paar dozijn eenheden is een boom kleiner dan een
               beeldpunt: dan ruis in plaats van bos. Daar doet de grond het werk. */
            transformed*=1.0-smoothstep(${BOOMVER*.55},${BOOMVER}.0,distance(bp,cameraPosition));`)
          .replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nvWolkW=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;");
        sh.fragmentShader=sh.fragmentShader
          .replace("#include <fog_pars_fragment>","#include <fog_pars_fragment>\nvarying vec3 vWolkW;\n"+WOLK_GLSL)
          .replace("#include <lights_fragment_end>",`#include <lights_fragment_end>
            float ws=wolkSchaduw(vWolkW); reflectedLight.directDiffuse*=ws; reflectedLight.directSpecular*=ws;`);
      };
      return m;
    };
    /* de schaduw moet net zo wegkrimpen als de boom zelf, anders werpen
       bomen buiten het boomgebied een schaduw zonder boom */
    const maakDiepte=()=>{
      const m=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      m.onBeforeCompile=sh=>{
        Object.assign(sh.uniforms,boomU);
        sh.vertexShader=sh.vertexShader
          .replace("#include <common>","#include <common>\nuniform vec2 uBoomMidden; uniform float uBoomStraal; uniform vec3 uOog;")
          .replace("#include <begin_vertex>",`#include <begin_vertex>
            vec3 bp=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
            transformed*=1.0-smoothstep(uBoomStraal*.7,uBoomStraal,distance(bp.xz,uBoomMidden));
            transformed*=1.0-smoothstep(${BOOMVER*.55},${BOOMVER}.0,distance(bp,uOog));`);
      };
      return m;
    };
    const MAX=90000;
    const a=new THREE.InstancedMesh(naald,maakMat(),MAX), b=new THREE.InstancedMesh(loof,maakMat(),MAX);
    a.customDepthMaterial=maakDiepte(); b.customDepthMaterial=maakDiepte();
    for(const m of [a,b]){ m.count=0; m.castShadow=true; m.receiveShadow=true; m.frustumCulled=false; wereld.add(m); }
    bomen={naald:a,loof:b,MAX};
  }
  function bomenIn(cx,cy){
    const sleutel=cx+","+cy; let v=boomVakken.get(sleutel); if(v)return v;
    const lijst=[], x0=cx*BOOMVAK, y0=cy*BOOMVAK, S=.16;
    const {land,h,rivier,fBos,fLoof,lees}=D;
    const dichtbij=gebouwPlekken.filter(([x,y,r])=>x>x0-r-1&&x<x0+BOOMVAK+r+1&&y>y0-r-1&&y<y0+BOOMVAK+r+1);
    for(let gy=0;gy<BOOMVAK;gy+=S)for(let gx=0;gx<BOOMVAK;gx+=S){
      const ix=Math.round((x0+gx)*61), iy=Math.round((y0+gy)*67);
      const x=x0+gx+T.hash2(ix,iy)*S, y=y0+gy+T.hash2(iy+7,ix+3)*S;
      if(x<1||y<1||x>=W-1||y>=H-1)continue;
      const p=Math.floor(y*RES)*RW+Math.floor(x*RES);
      if(!land[p]||rivier[p]>20)continue;
      const hh=h[p]; if(hh<.004||hh>.62)continue;
      const dicht=lees(fBos,x,y); if(dicht<.04)continue;
      /* open plekken in het bos, een rafelige bosrand, en hoger op de berg
         steeds ijler tot de boomgrens */
      const gx2=(Yvan(h[p+1])-Yvan(h[p-1]))*RES*.5, gz2=(Yvan(h[p+RW])-Yvan(h[p-RW]))*RES*.5;
      const steil=Math.sqrt(gx2*gx2+gz2*gz2);
      const kans=dicht*(.55+.9*(T.ruis(x*.31+17,y*.31-5)-.35))*(1-glad(klem((hh-.36)/.26,0,1)))*(1-glad(klem((steil-.9)/1.1,0,1)));
      if(T.hash2(ix*3+1,iy*5+2)>kans)continue;
      if(dichtbij.some(([bx,by,r])=>(bx-x)*(bx-x)+(by-y)*(by-y)<r*r))continue;
      const isLoof=lees(fLoof,x,y)>T.hash2(ix+11,iy+13)?1:0;
      lijst.push(x,y,yOp(x,y),.75+T.hash2(ix+5,iy+9)*.6,T.hash2(ix+21,iy+2)*6.283,isLoof,T.hash2(ix+31,iy+41));
    }
    v=new Float32Array(lijst);
    boomVakken.set(sleutel,v);
    if(boomVakken.size>900){ const eerste=boomVakken.keys().next().value; boomVakken.delete(eerste); }
    return v;
  }
  const bm=new THREE.Matrix4(), bq=new THREE.Quaternion(), bs=new THREE.Vector3(), bpv=new THREE.Vector3(), bas=new THREE.Vector3(0,1,0), bc=new THREE.Color();
  function werkBomenBij(nu,dwing){
    if(!bomen)return;
    const t=controls.target, afst=camera.position.distanceTo(t);
    const zicht=afst<140;
    bomen.naald.visible=bomen.loof.visible=zicht;
    if(!zicht)return;
    const r=klem(afst*1.15,14,42);
    boomU.uBoomMidden.value.set(t.x,t.z); boomU.uBoomStraal.value=r;
    boomU.uOog.value.copy(camera.position);
    const schaduw=afst<70;
    bomen.naald.castShadow=bomen.loof.castShadow=schaduw;
    const s=boomStand;
    if(!dwing&&(nu-s.t<180||(Math.hypot(t.x-s.x,t.z-s.z)<r*.12&&Math.abs(r-s.r)<r*.15)))return;
    s.x=t.x; s.z=t.z; s.r=r; s.t=nu;
    const [mx,my]=naarKaart(t);
    let nn=0,nl=0;
    const donker=isDonker();
    for(let cy=Math.floor((my-r)/BOOMVAK);cy<=Math.floor((my+r)/BOOMVAK);cy++)
      for(let cx=Math.floor((mx-r)/BOOMVAK);cx<=Math.floor((mx+r)/BOOMVAK);cx++){
        if(cx<0||cy<0||cx*BOOMVAK>W||cy*BOOMVAK>H)continue;
        const ddx=Math.max(0,Math.abs(mx-(cx+.5)*BOOMVAK)-BOOMVAK/2), ddy=Math.max(0,Math.abs(my-(cy+.5)*BOOMVAK)-BOOMVAK/2);
        if(ddx*ddx+ddy*ddy>r*r)continue;
        const v=bomenIn(cx,cy);
        for(let i=0;i<v.length;i+=7){
          const x=v[i], y=v[i+1];
          if((x-mx)*(x-mx)+(y-my)*(y-my)>r*r)continue;
          const isLoof=v[i+5], k=v[i+3], var_=v[i+6];
          bpv.set(X(x),v[i+2]-.01,Z(y)); bs.set(k*.85,k*.85*(.9+var_*.25),k*.85); bq.setFromAxisAngle(bas,v[i+4]);
          bm.compose(bpv,bq,bs);
          if(isLoof){
            if(nl>=bomen.MAX)continue;
            bc.setHSL(.20+var_*.08,donker?.22:.42,donker?.10+var_*.04:.25+var_*.09,THREE.SRGBColorSpace);
            bomen.loof.setMatrixAt(nl,bm); bomen.loof.setColorAt(nl,bc); nl++;
          }else{
            if(nn>=bomen.MAX)continue;
            bc.setHSL(.33+var_*.06,donker?.20:.32,donker?.08+var_*.03:.18+var_*.06,THREE.SRGBColorSpace);
            bomen.naald.setMatrixAt(nn,bm); bomen.naald.setColorAt(nn,bc); nn++;
          }
        }
      }
    bomen.naald.count=nn; bomen.loof.count=nl;
    for(const m of [bomen.naald,bomen.loof]){
      m.instanceMatrix.needsUpdate=true; if(m.instanceColor)m.instanceColor.needsUpdate=true;
    }
  }

  /* ================================ gebouwen ================================
   Alles wat gebouwd is wordt samengevoegd tot twee vormen (stevig en doek),
   met de kleur per stukje in de hoekpunten. Zo kost een hele wereld vol
   kastelen en dorpen maar een handvol tekenopdrachten. */
  let gebouwen=null, lichtjes=null, schepen=[];
  const plekBoven={};            /* plaats-id → hoogte van de top (voor het naambordje) */
  function maakGebouwen(){
    const vast=[], doek=[], lampjes=[];
    const BOX=new THREE.BoxGeometry(1,1,1).translate(0,.5,0).toNonIndexed();
    const CYL=new THREE.CylinderGeometry(1,1,1,10).translate(0,.5,0).toNonIndexed();
    const KEGEL=new THREE.ConeGeometry(1,1,10).translate(0,.5,0).toNonIndexed();
    const PIRAMIDE=new THREE.ConeGeometry(Math.SQRT1_2,1,4).rotateY(Math.PI/4).translate(0,.5,0).toNonIndexed();
    const GEVEL=veelvlak([[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5],[-.5,1,0],[.5,1,0]],
      [[0,1,5,4],[3,2,5,4],[0,3,4],[1,2,5],[0,1,2,3]]);
    const VLAK=new THREE.PlaneGeometry(1,1).translate(.5,0,0).toNonIndexed();
    for(const g of [BOX,CYL,KEGEL,PIRAMIDE,VLAK])g.deleteAttribute("uv");
    const m4=new THREE.Matrix4(), q=new THREE.Quaternion(), e=new THREE.Euler(), sv=new THREE.Vector3(), pv=new THREE.Vector3();
    const kl=new THREE.Color();
    /* een stukje neerzetten, in wereldcoördinaten (x,z op de kaart, y de hoogte) */
    function stuk(lijst,geo,x,y,z,sx,sy,sz,ry,kleur,rx=0,rz=0){
      const g=geo.clone();
      /* hoeken gaan in de draairichting van de kaart; three.js draait om Y de andere kant op */
      m4.compose(pv.set(x,y,z),q.setFromEuler(e.set(rx,-ry,rz)),sv.set(sx,sy,sz));
      g.applyMatrix4(m4);
      kl.set(kleur);
      const n=g.getAttribute("position").count, c=new Float32Array(n*3);
      for(let i=0;i<n;i++){ c[i*3]=kl.r; c[i*3+1]=kl.g; c[i*3+2]=kl.b; }
      g.setAttribute("color",new THREE.BufferAttribute(c,3));
      lijst.push(g);
    }
    const STEEN=["#D8D1BF","#CFC6B0","#DCD6C6","#C9C0A8"];
    const DAKEN=["#9C4A33","#8A3F2C","#6E5B4A","#5A6170","#A65C3B","#7B5A3A"];
    const TORENDAK=["#46586E","#3E4E63","#7A3328","#4B5563"];
    const MUREN=["#EAE2CF","#E2D6BC","#D9CDB1","#EFE8D8","#CDBF9F"];
    for(const p of ctx.PLAATSEN){
      const pos=D.POS[p.id]; if(!pos)continue;
      const [cx,cy]=pos;
      const r=i=>T.hash2((cx*131+i*17)|0,(cy*71+i*29)|0);
      const rot=r(0)*Math.PI*2, co=Math.cos(rot), si=Math.sin(rot);
      /* van een plek rond het midden (lokaal, gedraaid) naar de kaart */
      const w=(lx,lz)=>[cx+lx*co-lz*si, cy+lx*si+lz*co];
      const grond=(x,y)=>yOp(x,y);
      const laagste=(R)=>{ let m=grond(cx,cy); for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; m=Math.min(m,grond(cx+Math.cos(a)*R,cy+Math.sin(a)*R)); } return Math.max(m,.03); };
      const huis=(lx,lz,schaal,dakKleur,muurKleur,draai=0)=>{
        const [x,y]=w(lx,lz); if(!opLand(x,y))return;
        const g0=Math.max(grond(x,y),.05);
        const bw=(.07+r(lx*9+lz*7)*.05)*schaal, bd=(.055+r(lx*3+lz*11)*.03)*schaal, bh=(.05+r(lx*5+lz*13)*.035)*schaal;
        stuk(vast,BOX,X(x),g0-.03,Z(y),bw,bh+.03,bd,rot+draai,muurKleur);
        stuk(vast,GEVEL,X(x),g0+bh,Z(y),bw*1.08,bd*.75,bd*1.12,rot+draai,dakKleur);
        /* het licht net boven het dak: in het huis zou de muur het verbergen */
        if(r(lx*31+lz*17)<.7)lampjes.push(X(x),g0+bh+bd*.9,Z(y));
      };
      let boven=.3, straal=.6;
      if(p.soort==="kasteel"){
        const basis=laagste(.62);
        const steen=p.id==="redmont"?"#B98A72":STEEN[Math.floor(r(1)*STEEN.length)];
        const dak=TORENDAK[Math.floor(r(2)*TORENDAK.length)];
        const S=.9, hw=S/2, mh=.17, dk=.05;
        const [bx,by]=[cx,cy];
        const P=(lx,lz)=>{ const [x,y]=w(lx,lz); return [X(x),Z(y)]; };
        /* een voet tot onder de grond, zodat het kasteel nergens zweeft */
        { const [x,z]=P(0,0); stuk(vast,BOX,x,basis-.7,z,S+.14,.72,S+.14,rot,steen); }
        /* de ringmuur met kantelen */
        for(let zijde=0;zijde<4;zijde++){
          const a=zijde*Math.PI/2, ca=Math.cos(a), sa=Math.sin(a);
          const [x,z]=P(ca*hw,sa*hw);
          const lang=zijde%2?S:S;
          stuk(vast,BOX,x,basis,z,zijde%2?lang:dk,mh,zijde%2?dk:lang,rot,steen);
          for(let k=-5;k<=5;k+=2){
            const t=k/11*S;
            const [kx,kz]=P(ca*hw-sa*t,sa*hw+ca*t);
            stuk(vast,BOX,kx,basis+mh,kz,.035,.03,.035,rot,steen);
          }
        }
        for(const [lx,lz] of [[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]]){
          const [x,z]=P(lx,lz);
          stuk(vast,CYL,x,basis,z,.075,.29,.075,0,steen);
          stuk(vast,KEGEL,x,basis+.29,z,.092,.17,.092,0,dak);
        }
        /* poortgebouw */
        { const [x,z]=P(0,hw); stuk(vast,BOX,x,basis,z,.16,.24,.1,rot,steen); }
        /* de burcht: een vierkante toren en een hoge ronde */
        { const [x,z]=P(-.08,-.06); stuk(vast,BOX,x,basis,z,.3,.42,.26,rot,steen);
          for(const [lx,lz] of [[-.13,-.11],[.13,-.11],[.13,.11],[-.13,.11]]){ const [tx,tz]=P(-.08+lx,-.06+lz); stuk(vast,BOX,tx,basis+.42,tz,.045,.04,.045,rot,steen); } }
        { const [x,z]=P(.14,.08); stuk(vast,CYL,x,basis,z,.07,.62,.07,0,steen); stuk(vast,KEGEL,x,basis+.62,z,.09,.22,.09,0,dak);
          stuk(vast,CYL,x,basis+.84,z,.004,.14,.004,0,"#5A4632");
          stuk(doek,VLAK,x,basis+.94,z,.12,.07,1,rot+Math.PI/2,"#8E2B2B");
          lampjes.push(x,basis+.66,z,x+.02,basis+.48,z+.02); }
        /* een paar huisjes op de binnenplaats en eromheen */
        for(let i=0;i<3;i++)huis(-.25+i*.2,.24,.85,DAKEN[Math.floor(r(10+i)*DAKEN.length)],MUREN[Math.floor(r(20+i)*MUREN.length)]);
        for(let i=0;i<7;i++){ const a=r(30+i)*Math.PI*2, d=.85+r(40+i)*.6; huis(Math.cos(a)*d,Math.sin(a)*d,1,DAKEN[Math.floor(r(50+i)*DAKEN.length)],MUREN[Math.floor(r(60+i)*MUREN.length)],r(70+i)); }
        { const [x,z]=P(0,hw+.08); lampjes.push(x,basis+.28,z); }
        boven=basis+1.15; straal=1.0;
      }else if(p.soort==="stad"||p.soort==="haven"){
        /* Een dorp of stad: huizen dicht opeen rond een plein, alleen waar
           land is — een havenstad ligt aan het water en groeit dus alleen
           landinwaarts. Wat het dichtst bij het midden ligt komt eerst. */
        const R=p.soort==="stad"?.9:.95, aantal=p.soort==="stad"?30:24;
        const kand=[];
        for(let gz=-R;gz<=R;gz+=.14)for(let gx=-R;gx<=R;gx+=.14){
          const i=Math.round(gx*71+gz*13+400), lx=gx+(r(i)-.5)*.07, lz=gz+(r(i+700)-.5)*.07;
          const d=Math.hypot(lx,lz); if(d>R)continue;
          const [x,y]=w(lx,lz); if(!opLand(x,y))continue;
          kand.push([lx,lz,d+r(i+900)*.3]);
        }
        kand.sort((a,b)=>a[2]-b[2]);
        const plein=kand.shift();
        for(const [lx,lz] of kand.slice(0,aantal)){
          /* de huizen staan grofweg in het gelid, met een kleine afwijking */
          const a=Math.round(Math.atan2(lz,lx)/(Math.PI/2))*(Math.PI/2)+(r(lx*53+lz*19)-.5)*.3;
          huis(lx,lz,1.15,DAKEN[Math.floor(r(lx*97+lz*31+5)*DAKEN.length)],MUREN[Math.floor(r(lz*91+lx*37+9)*MUREN.length)],a);
        }
        /* een kerk of hal met toren op het plein */
        const [px,pz]=plein||[0,0];
        const [x,y]=w(px,pz), g0=Math.max(grond(x,y),.03);
        stuk(vast,BOX,X(x),g0-.03,Z(y),.19,.12,.09,rot,"#D8D0BC");
        stuk(vast,GEVEL,X(x),g0+.09,Z(y),.2,.08,.1,rot,"#6E5B4A");
        const [tx,ty]=w(px-.12,pz);
        stuk(vast,BOX,X(tx),g0-.03,Z(ty),.06,.3,.06,rot,"#D8D0BC");
        stuk(vast,PIRAMIDE,X(tx),g0+.27,Z(ty),.08,.15,.08,rot,"#4B5563");
        lampjes.push(X(tx),g0+.2,Z(ty)+.04);
        /* een steiger het water in */
        if(p.soort==="haven"){
          let sx=0,sz=0;
          for(let i=0;i<16;i++){ const a=i/16*Math.PI*2; if(hNorm(cx+Math.cos(a)*1.3,cy+Math.sin(a)*1.3)<0){sx+=Math.cos(a);sz+=Math.sin(a);} }
          const l=Math.hypot(sx,sz);
          if(l>0){
            sx/=l; sz/=l;
            let t=0; while(t<2&&hNorm(cx+sx*t,cy+sz*t)>=0)t+=.04;
            for(const zij of [-.18,.18]){
              const ox=-sz*zij, oz=sx*zij, mx=cx+sx*(t+.18)+ox, my=cy+sz*(t+.18)+oz;
              stuk(vast,BOX,X(mx),-.05,Z(my),.5,.09,.045,Math.atan2(sz,sx),"#6B5138");
            }
          }
        }
        boven=g0+.5; straal=1.05;
      }else if(p.soort==="ruine"){
        const basis=laagste(.5);
        for(let i=0;i<7;i++){
          const a=i/7*Math.PI*2+r(i)*.3, [x,y]=w(Math.cos(a)*.38,Math.sin(a)*.38);
          stuk(vast,BOX,X(x),basis-.1,Z(y),.05,.12+r(i+9)*.22,.24,rot+a,"#8F8A7A");
        }
        { const [x,y]=w(.06,-.05); stuk(vast,CYL,X(x),basis-.1,Z(y),.08,.36+r(30)*.15,.08,0,"#8F8A7A"); }
        for(let i=0;i<6;i++){ const [x,y]=w((r(40+i)-.5)*.9,(r(50+i)-.5)*.9); stuk(vast,BOX,X(x),grond(x,y)-.02,Z(y),.04,.03,.05,r(i),"#7E796B"); }
        boven=basis+.55; straal=.6;
      }else if(p.soort==="slagveld"){
        const basis=laagste(.4);
        { const [x,y]=w(0,0); stuk(vast,BOX,X(x),basis-.1,Z(y),.06,.32,.06,rot,"#A7A190"); stuk(vast,PIRAMIDE,X(x),basis+.22,Z(y),.065,.05,.065,rot,"#A7A190"); }
        const VLAGGEN=["#8E2B2B","#2B4C7E","#8E2B2B","#C9A94A","#2B4C7E"];
        for(let i=0;i<5;i++){
          const a=r(i)*Math.PI*2, d=.25+r(i+5)*.35, [x,y]=w(Math.cos(a)*d,Math.sin(a)*d), g0=grond(x,y);
          stuk(vast,CYL,X(x),g0,Z(y),.005,.28,.005,0,"#5A4632");
          stuk(doek,VLAK,X(x),g0+.2,Z(y),.09,.06,1,r(i+11)*6,VLAGGEN[i]);
        }
        /* tenten van een legerkamp */
        for(let i=0;i<4;i++){ const a=r(i+20)*Math.PI*2, d=.5+r(i+25)*.3, [x,y]=w(Math.cos(a)*d,Math.sin(a)*d);
          stuk(vast,PIRAMIDE,X(x),grond(x,y)-.01,Z(y),.09,.07,.09,a,"#D9CFB4"); }
        boven=basis+.45; straal=.7;
      }else{
        boven=Math.max(yOp(cx,cy),0)+.18; straal=0;
      }
      plekBoven[p.id]=boven;
      if(straal)gebouwPlekken.push([cx,cy,straal]);
      /* schepen bij een haven: op het dichtstbijzijnde water */
      if(p.soort==="haven")maakSchepen(p,cx,cy,r);
    }
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0});
    mat.onBeforeCompile=metNevel;
    const matDoek=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});
    matDoek.onBeforeCompile=metNevel;
    const g=new THREE.Group();
    if(vast.length){ const m=new THREE.Mesh(mergeGeometries(vast),mat); m.castShadow=m.receiveShadow=true; g.add(m); }
    if(doek.length){ const m=new THREE.Mesh(mergeGeometries(doek),matDoek); m.castShadow=true; g.add(m); }
    for(const x of [...vast,...doek])x.dispose();
    wereld.add(g); gebouwen=g;
    /* 's nachts: licht achter de ramen */
    const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.Float32BufferAttribute(lampjes,3));
    const gloed=document.createElement("canvas"); gloed.width=gloed.height=64;
    { const c=gloed.getContext("2d"), gr=c.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,"rgba(255,214,150,1)"); gr.addColorStop(.18,"rgba(255,170,80,.6)"); gr.addColorStop(1,"rgba(255,140,60,0)");
      c.fillStyle=gr; c.fillRect(0,0,64,64); }
    const lm=new THREE.PointsMaterial({size:.24,map:new THREE.CanvasTexture(gloed),color:0xFFC27A,transparent:true,
      depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true,fog:false});
    lichtjes=new THREE.Points(lg,lm); lichtjes.renderOrder=4;
    wereld.add(lichtjes);
  }
  /* Een schip: een romp die naar de punten toe smaller en hoger wordt, een mast
     en een vierkant zeil — het silhouet van een wolfschip. */
  let scheepsVormen=null;
  function maakSchepen(p,cx,cy,r){
    if(!scheepsVormen){
      const romp=new THREE.BoxGeometry(1,1,1,6,1,1);
      const ps=romp.getAttribute("position");
      for(let i=0;i<ps.count;i++){
        const x=ps.getX(i), t=Math.abs(x)*2;
        ps.setZ(i,ps.getZ(i)*(1-t*t*.85)); ps.setY(i,ps.getY(i)+t*t*.35+(ps.getY(i)<0?t*.25:0));
      }
      romp.computeVertexNormals();
      scheepsVormen={
        romp,
        mast:new THREE.CylinderGeometry(.004,.005,1,5).translate(0,.5,0),
        zeil:new THREE.PlaneGeometry(1,1),
        rompMat:new THREE.MeshStandardMaterial({color:0x5B4330,roughness:.8}),
        mastMat:new THREE.MeshStandardMaterial({color:0x4A3826,roughness:.8}),
        zeilMat:[new THREE.MeshStandardMaterial({color:0xEDE4CF,roughness:.9,side:THREE.DoubleSide}),
                 new THREE.MeshStandardMaterial({color:0xA83A2C,roughness:.9,side:THREE.DoubleSide})]
      };
      for(const m of [scheepsVormen.rompMat,scheepsVormen.mastMat,...scheepsVormen.zeilMat])m.onBeforeCompile=metNevel;
    }
    const V=scheepsVormen, n=1+Math.floor(r(200)*3);
    for(let i=0;i<n;i++){
      /* zoek water binnen anderhalve eenheid */
      let best=null;
      for(let k=0;k<40&&!best;k++){
        const a=r(210+k+i*40)*Math.PI*2, d=.7+r(260+k)*1.6, x=cx+Math.cos(a)*d, y=cy+Math.sin(a)*d;
        if(hNorm(x,y)<-.05)best=[x,y];
      }
      if(!best)continue;
      const g=new THREE.Group();
      const romp=new THREE.Mesh(V.romp,V.rompMat); romp.scale.set(.3,.04,.07); romp.position.y=.01; g.add(romp);
      const mast=new THREE.Mesh(V.mast,V.mastMat); mast.scale.set(1,.22,1); g.add(mast);
      const zeil=new THREE.Mesh(V.zeil,V.zeilMat[r(300+i)<.5?1:0]); zeil.scale.set(.13,.12,1); zeil.position.y=.15; zeil.rotation.y=Math.PI/2; g.add(zeil);
      g.position.set(X(best[0]),0,Z(best[1])); g.rotation.y=r(320+i)*Math.PI*2;
      g.traverse(o=>{ if(o.isMesh){o.castShadow=true;} });
      g.userData.fase=r(340+i)*10;
      scene.add(g); schepen.push(g);
    }
  }

  /* ================================ namen ================================ */
  const namen=[];
  function maakNamen(){
    for(const n of namen)wereld.remove(n.obj);
    namen.length=0;
    const maak=(tekst,klasse,id,x,y,boven,z,midden)=>{
      const el=document.createElement("div");
      el.className="l3 "+klasse; el.textContent=tekst;
      el.addEventListener("pointerdown",e=>e.stopPropagation());
      el.addEventListener("click",e=>{ e.stopPropagation(); ctx.kies(id); });
      const obj=new CSS2DObject(el);
      obj.center.set(.5,midden?.5:1);
      obj.position.set(X(x),boven,Z(y));
      wereld.add(obj);
      namen.push({el,obj,id,x,y,z:z??3,soort:klasse,uit:true});
    };
    for(const p of ctx.PLAATSEN){
      const pos=D.POS[p.id]; if(!pos)continue;
      const natuur=/^(natuur|landschap|rivier)$/.test(p.soort);
      maak(p.naam,natuur?"l3-natuur":"l3-plaats",p.id,pos[0],pos[1],plekBoven[p.id]??(Math.max(yOp(...pos),0)+.2),p.z,false);
    }
    for(const id in ctx.GEBIEDEN){
      const i=D.ids.indexOf(id); if(i<0)continue;
      const pool=D.pool[i+1]; if(!pool)continue;
      maak(ctx.GEBIEDEN[id].naam,"l3-land","gebied:"+id,pool.x,pool.y,Math.max(yOp(pool.x,pool.y),0)+3,0,true);
    }
    for(const z of ctx.ZEEEN||[]){
      if(!z.id||z.x==null)continue;
      maak(z.naam,"l3-zee","zee:"+z.id,klem(z.x,10,W-10),klem(z.y,10,H-10),.4,0,true);
    }
  }
  /* Welke namen er staan: net als op de kaart, hoe dichterbij hoe meer. Daarna
     mogen ze elkaar niet overlappen (de belangrijkste wint), en wat achter een
     berg ligt, staat er niet. */
  const tv=new THREE.Vector3();
  let gekozen=null;
  function werkNamenBij(){
    const camAfst=camera.position.distanceTo(controls.target);
    const rp=ctx.routePlekken?ctx.routePlekken():new Set();
    const B=houder.clientWidth, Hh=houder.clientHeight;
    const kand=[];
    for(const n of namen){
      let aan;
      if(n.soort==="l3-land")aan=camAfst>40&&camAfst<1300;
      else if(n.soort==="l3-zee")aan=camAfst>110;
      else{
        n.obj.getWorldPosition(tv);
        aan=camera.position.distanceTo(tv)<Math.min(900,1200/Math.pow(n.z,1.45));
        if(rp.has(n.id))aan=true;
      }
      if(n.id===gekozen)aan=true;
      if(aan){
        n.obj.getWorldPosition(tv); const ver=camera.position.distanceTo(tv);
        tv.project(camera);
        if(tv.z>1||Math.abs(tv.x)>1.05||Math.abs(tv.y)>1.05)aan=false;
        else if(n.verborgen&&n.id!==gekozen)aan=false;
        else{
          if(!n.maat&&n.el.offsetWidth)n.maat=[n.el.offsetWidth,n.el.offsetHeight];
          const m=n.maat||[n.el.textContent.length*8,16];
          const sx=(tv.x+1)/2*B, sy=(1-tv.y)/2*Hh, oy=n.soort==="l3-land"||n.soort==="l3-zee"?m[1]/2:0;
          kand.push({n,vak:[sx-m[0]/2-4,sy+oy-m[1]-2,sx+m[0]/2+4,sy+oy+2],
            prio:n.id===gekozen?-9:n.soort==="l3-land"?-2:n.soort==="l3-zee"?-1:(rp.has(n.id)?.5:n.z)+ver*.001});
        }
      }
      if(!aan&&!n.uit){ n.el.classList.add("uit"); n.uit=true; }
    }
    kand.sort((a,b)=>a.prio-b.prio);
    const bezet=[];
    for(const k of kand){
      const v=k.vak, botst=bezet.some(b=>v[0]<b[2]&&v[2]>b[0]&&v[1]<b[3]&&v[3]>b[1]);
      if(botst!==k.n.uit){ k.n.el.classList.toggle("uit",botst); k.n.uit=botst; }
      if(!botst)bezet.push(v);
    }
  }
  /* staat er een berg tussen de camera en de naam? Langs de straal stappen. */
  let verbergStap=0;
  function werkVerborgenBij(){
    const sy=wereld.scale.y, c=camera.position;
    for(let i=0;i<namen.length;i++){
      if((i+verbergStap)%4)continue;
      const n=namen[i]; if(n.soort==="l3-zee"){n.verborgen=false;continue;}
      n.obj.getWorldPosition(tv);
      let weg=false;
      for(let s=1;s<28;s++){
        const t=s/28, px=c.x+(tv.x-c.x)*t, py=c.y+(tv.y-c.y)*t, pz=c.z+(tv.z-c.z)*t;
        if(yOp(px+W/2,pz+H/2)*sy>py+.05){ weg=true; break; }
      }
      n.verborgen=weg;
    }
    verbergStap++;
  }

  /* ======================= lijnen: routes en de gekozen plek ======================= */
  const lijnen=new THREE.Group(); wereld.add(lijnen);
  const lijnMats=[];
  function lijnOverLand(punten,kleur,breed,opts={}){
    const p=[];
    for(const [x,y] of punten)p.push(X(x),Math.max(yOp(x,y),0)+(opts.boven??.12),Z(y));
    const g=new LineGeometry(); g.setPositions(p);
    const m=new LineMaterial({color:new THREE.Color(kleur),linewidth:breed,worldUnits:false,transparent:true,
      opacity:opts.dekking??1,dashed:!!opts.streep,dashSize:opts.streep?.5:1,gapSize:opts.streep?.35:0,depthTest:opts.diepte??true});
    m.resolution.set(houder.clientWidth,houder.clientHeight);
    const l=new Line2(g,m); l.computeLineDistances(); l.renderOrder=opts.volgorde??5;
    lijnMats.push(m);
    return l;
  }
  function ruimLijnen(groep){
    for(const l of [...groep.children]){ groep.remove(l); l.geometry.dispose(); const i=lijnMats.indexOf(l.material); if(i>=0)lijnMats.splice(i,1); l.material.dispose(); }
  }
  /* een reis volgt dezelfde vloeiende kromme als op de kaart (vloeiend() in index.html) */
  function kromme(pad){
    const S=ctx.SPANNING||.75, uit=[];
    if(pad.length<3){
      for(let i=0;i<pad.length-1;i++){ const [a,b]=[pad[i],pad[i+1]], n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.3));
        for(let k=0;k<n;k++)uit.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]); }
      uit.push(pad[pad.length-1]); return uit;
    }
    const n=pad.length;
    for(let i=0;i<n-1;i++){
      const p0=pad[i-1]||pad[0], p1=pad[i], p2=pad[i+1], p3=pad[i+2]||pad[n-1];
      const c1=[p1[0]+(p2[0]-p0[0])/6*S,p1[1]+(p2[1]-p0[1])/6*S], c2=[p2[0]-(p3[0]-p1[0])/6*S,p2[1]-(p3[1]-p1[1])/6*S];
      const stappen=Math.max(4,Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/.3));
      for(let k=0;k<stappen;k++){
        const t=k/stappen, u=1-t;
        uit.push([u*u*u*p1[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*p2[0],u*u*u*p1[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*p2[1]]);
      }
    }
    uit.push(pad[n-1]);
    return uit;
  }
  const routeGroep=new THREE.Group(); lijnen.add(routeGroep);
  const keuzeGroep=new THREE.Group(); lijnen.add(keuzeGroep);
  function tekenRoutes(){
    ruimLijnen(routeGroep);
    if(!D)return;
    const halo=css("--halo")||"#EAE7D9";
    for(const reis of ctx.route()){
      const pts=kromme(reis.pad), kleur=cssKleur(reis.kleur);
      routeGroep.add(lijnOverLand(pts,halo,6.5,{dekking:.55,boven:.18,volgorde:5}));
      const l=lijnOverLand(pts,kleur,3.2,{streep:true,boven:.2,volgorde:6});
      l.userData.loopt=true; routeGroep.add(l);
    }
  }
  /* het gekozen land krijgt zijn grens in de accentkleur, een plaats een ring */
  let ringLijn=null;
  const hulpSvg=(()=>{
    const s=document.createElementNS("http://www.w3.org/2000/svg","svg");
    s.setAttribute("viewBox",`0 0 ${W} ${H}`);
    s.style.cssText="position:absolute;left:-9999px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none";
    document.body.appendChild(s); return s;
  })();
  function grensPunten(id){
    const uit=[];
    for(const d of ctx.GEO.vormen[id]||[]){
      const pad=document.createElementNS("http://www.w3.org/2000/svg","path");
      pad.setAttribute("d",d); hulpSvg.appendChild(pad);
      const L=pad.getTotalLength(), n=Math.max(8,Math.ceil(L/.35));
      let stuk=[], vorige=null;
      for(let i=0;i<=n;i++){
        const q=pad.getPointAtLength(i/n*L);
        if(vorige&&Math.hypot(q.x-vorige[0],q.y-vorige[1])>2){ if(stuk.length>1)uit.push(stuk); stuk=[]; }
        stuk.push(vorige=[q.x,q.y]);
      }
      if(stuk.length>1)uit.push(stuk);
      pad.remove();
    }
    return uit;
  }
  function tekenKeuze(id){
    ruimLijnen(keuzeGroep); ringLijn=null;
    if(!D||!id)return;
    const accent=css("--accent")||"#8A2F27";
    if(id.startsWith("gebied:")){
      for(const s of grensPunten(id.slice(7)))keuzeGroep.add(lijnOverLand(s,accent,2.6,{boven:.15,dekking:.95}));
    }else if(D.POS[id]){
      const [x,y]=D.POS[id], R=(gebouwPlekken.find(g=>g[0]===x&&g[1]===y)||[0,0,.5])[2]+.25, pts=[];
      for(let i=0;i<=64;i++){ const a=i/64*Math.PI*2; pts.push([x+Math.cos(a)*R,y+Math.sin(a)*R]); }
      ringLijn=lijnOverLand(pts,accent,2.4,{boven:.08}); keuzeGroep.add(ringLijn);
    }
  }

  /* ================================ thema ================================ */
  let landKleurTex=null, landNormTex=null, wolkDek=.9, wolkSch=.4;
  function zetThema(){
    const th=isDonker()?THEMA.donker:THEMA.licht;
    const zr=new THREE.Vector3(...th.zon).normalize();
    GEDEELD.uZonRicht.value.copy(zr);
    GEDEELD.uZonGloed.value.set(th.gloed);
    GEDEELD.uNevelKleur.value.set(th.nevel);
    GEDEELD.uNevelDicht.value=th.nevelDicht; GEDEELD.uNevelVal.value=th.nevelVal;
    GEDEELD.uZenit.value.set(th.zenit);
    luchtMat.uniforms.uZonKleur.value.set(th.zonKleur);
    luchtMat.uniforms.uZonSchijf.value=isDonker()?.35:1;
    zon.color.set(th.zonKleur); zon.intensity=th.zonSterkte;
    hemi.color.set(th.hemelLicht); hemi.groundColor.set(th.grondLicht); hemi.intensity=th.hemiSterkte;
    renderer.toneMappingExposure=th.belichting;
    sterren.visible=!!th.sterren;
    waterMat.uniforms.uOndiep.value.set(th.ondiep); waterMat.uniforms.uDiep.value.set(th.diep);
    waterMat.uniforms.uSchuim.value.set(th.schuim); waterMat.uniforms.uZonKleur.value.set(th.zonKleur);
    wolkDek=th.wolkDekking; wolkSch=th.wolkSchaduw;
    if(wolken){
      wolken.material.uniforms.uWolkLicht.value.set(th.wolkLicht);
      wolken.material.uniforms.uWolkDonker.value.set(th.wolkDonker);
      wolken.material.uniforms.uDekking.value=intro?0:wolkDek;
      GEDEELD.uWolkSterkte.value=intro?0:wolkSch;
    }
    if(lichtjes)lichtjes.visible=!!th.lichtjes;
    const bodem=scene.getObjectByName("bodem"); if(bodem)bodem.material.color.set(th.bodemDiep);
    if(D)tekenRoutes();
  }

  /* ================================ opbouw ================================ */
  let gebouwd=false;
  async function bouwAlles(){
    await bouwGegevens();
    await ctx.adem();
    const kleur=bouwKleur();
    await ctx.adem();
    landKleurTex=new THREE.DataTexture(kleur,RW,RH,THREE.RGBAFormat);
    landKleurTex.colorSpace=THREE.SRGBColorSpace;
    landKleurTex.generateMipmaps=true; landKleurTex.minFilter=THREE.LinearMipmapLinearFilter;
    landKleurTex.magFilter=THREE.LinearFilter; landKleurTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    landKleurTex.needsUpdate=true;
    landNormTex=new THREE.DataTexture(bouwNormalen(),RW,RH,THREE.RGBAFormat);
    landNormTex.generateMipmaps=true; landNormTex.minFilter=THREE.LinearMipmapLinearFilter;
    landNormTex.magFilter=THREE.LinearFilter; landNormTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    landNormTex.needsUpdate=true;
    await ctx.adem();
    landMat=maakLandMat(landKleurTex,landNormTex);
    maakVakken();
    diepteTex=bouwDiepte();
    waterMat.uniforms.uDiepte.value=diepteTex;
    if(!water)maakWater();
    if(!wolken)maakWolken();
    await ctx.adem();
    maakGebouwen();
    maakBomen();
    maakNamen();
    zetThema();
    gebouwd=true;
  }
  function ruimOp(){
    for(const v of vakken){ for(const g of v.geo)if(g)g.dispose(); wereld.remove(v.mesh); }
    vakken=[]; for(const k in indexen)delete indexen[k];
    if(landMat)landMat.dispose(); if(landKleurTex)landKleurTex.dispose(); if(landNormTex)landNormTex.dispose(); if(diepteTex)diepteTex.dispose();
    if(gebouwen){ wereld.remove(gebouwen); gebouwen.traverse(o=>{ if(o.geometry)o.geometry.dispose(); }); gebouwen=null; }
    if(lichtjes){ wereld.remove(lichtjes); lichtjes.geometry.dispose(); lichtjes=null; }
    for(const s of schepen)scene.remove(s); schepen=[];
    if(bomen){ wereld.remove(bomen.naald,bomen.loof); bomen=null; }
    boomVakken.clear(); gebouwPlekken.length=0;
    for(const n of namen)wereld.remove(n.obj); namen.length=0;
    ruimLijnen(routeGroep); ruimLijnen(keuzeGroep);
    gebouwd=false;
  }

  /* ================================ camera ================================ */
  const sph=new THREE.Spherical(), off=new THREE.Vector3();
  function zetCamera(doel,afst,polar,azimut){
    sph.set(afst,Math.max(1e-4,polar),azimut);
    off.setFromSpherical(sph);
    camera.position.copy(doel).add(off);
    camera.lookAt(doel);
  }
  let vlucht=null;
  /* Vliegen naar een plek. De straal loopt via de logaritme, en ligt de nieuwe
     plek ver weg, dan gaat de camera halverwege eerst omhoog: zo vlieg je over
     het land heen in plaats van er vlak langs te schuren. */
  function vlieg(x,y,afst,polar,duur=1900){
    const van=controls.target.clone();
    sph.setFromVector3(off.copy(camera.position).sub(van));
    const naar=new THREE.Vector3(X(x),grondY(x,y),Z(y));
    /* staat het zijpaneel open, dan het doel iets naar links op het scherm */
    const pb=ctx.paneelBreedte?ctx.paneelBreedte():0;
    if(pb){
      const perEenheid=houder.clientHeight/(2*afst*Math.tan(FOV*Math.PI/360));
      const rechts=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0); rechts.y=0; rechts.normalize();
      naar.addScaledVector(rechts,pb/2/perEenheid);
    }
    const afstand=van.distanceTo(naar);
    const r0=sph.radius, p0=sph.phi, a0=sph.theta;
    const [p1,a1]=vrijZicht(naar,afst,polar??p0,a0);
    vlucht={t0:performance.now(),duur:minderBeweging()?1:duur,van,naar,
      r0,r1:afst,rm:Math.max(r0,afst,afstand*.55),p0,p1,a0,a1};
  }
  /* Kijkt de camera vanaf hier over een heuvel heen naar het doel, of tegen de
     heuvel aan? Dan eerst een stukje om het doel heen draaien, en pas als dat
     nergens helpt steiler omhoog. Liever schuin over het land dan erop neer. */
  function vrijZicht(doel,afst,polar,azimut){
    const c=new THREE.Vector3();
    const vrij=(p,a)=>{
      sph.set(afst,p,a); c.setFromSpherical(sph).add(doel);
      const [cx,cy]=naarKaart(c);
      if(c.y<grondY(cx,cy)+Math.max(1.2,afst*.1))return false;
      /* het laatste stuk niet: dat ligt op de helling van het doel zelf */
      for(let s=1;s<=24;s++){
        const t=s/24*.86, x=c.x+(doel.x-c.x)*t, y=c.y+(doel.y-c.y)*t, z=c.z+(doel.z-c.z)*t;
        if(grondY(x+W/2,z+H/2)>y-.05)return false;
      }
      return true;
    };
    const draai=[0,.4,-.4,.8,-.8,1.3,-1.3,1.9,-1.9,2.6,-2.6,Math.PI];
    for(let p=polar;p>.25;p-=.07)
      for(const d of draai)if(vrij(p,azimut+d))return [p,azimut+d];
    return [.25,azimut];
  }
  function werkVluchtBij(nu){
    if(!vlucht)return;
    const v=vlucht, k=Math.min(1,(nu-v.t0)/v.duur), e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
    const doel=v.van.clone().lerp(v.naar,e);
    /* kwadratische bezier in log-ruimte tussen begin, top en eind */
    const l0=Math.log(v.r0), l1=Math.log(v.r1), lm=Math.log(v.rm);
    const r=Math.exp((1-e)*(1-e)*l0+2*(1-e)*e*lm+e*e*l1);
    controls.target.copy(doel);
    zetCamera(doel,r,v.p0+(v.p1-v.p0)*e,v.a0+(v.a1-v.a0)*e);
    if(k>=1)vlucht=null;
  }
  /* Bij het scrollen kantelt de camera mee: dichtbij kijk je over het land
     uit naar de horizon, van ver kijk je erop neer. */
  let zoomTijd=0;
  renderer.domElement.addEventListener("wheel",()=>{ zoomTijd=performance.now(); vlucht=null; },{passive:true});
  function kantelMee(nu){
    if(nu-zoomTijd>450||vlucht)return;
    const d=camera.position.distanceTo(controls.target);
    const t=klem((Math.log(d)-Math.log(6))/(Math.log(700)-Math.log(6)),0,1);
    const wil=1.32+(.62-1.32)*t;
    sph.setFromVector3(off.copy(camera.position).sub(controls.target));
    sph.phi+=(wil-sph.phi)*.1;
    off.setFromSpherical(sph); camera.position.copy(controls.target).add(off);
  }
  function houdBinnen(){
    const t=controls.target;
    t.x=klem(t.x,-W*.6,W*.6); t.z=klem(t.z,-H*.6,H*.6);
    const [tx,ty]=naarKaart(t);
    t.y+=(grondY(tx,ty)-t.y)*.15;
    const [cx,cy]=naarKaart(camera.position);
    const min=grondY(cx,cy)+.6;
    if(camera.position.y<min)camera.position.y=min;
    /* het dichtbije vlak meeschuiven met de hoogte: vlakbij scherp, en in de
       verte geen gevecht tussen water en zeebodem */
    const boven=camera.position.y-grondY(cx,cy);
    const near=klem(boven*.06,.03,8);
    if(Math.abs(near-camera.near)/camera.near>.2){ camera.near=near; camera.updateProjectionMatrix(); }
  }
  /* de schaduw van de zon: een vak rond waar je kijkt, groter naarmate je verder weg bent */
  function werkSchaduwBij(){
    const t=controls.target, d=camera.position.distanceTo(t);
    const vak=klem(d*1.1,18,800);
    const sc=zon.shadow.camera;
    if(Math.abs(sc.right-vak)/vak>.08){
      sc.left=-vak; sc.right=vak; sc.top=vak; sc.bottom=-vak; sc.updateProjectionMatrix();
      zon.shadow.normalBias=vak/zon.shadow.mapSize.x*2.2;
    }
    const zr=GEDEELD.uZonRicht.value;
    zon.target.position.copy(t);
    zon.position.copy(t).addScaledVector(zr,1500);
    zon.shadow.bias=-.0003;
  }
  function draaiRoos(){
    if(!ctx.roos)return;
    const a=controls.getAzimuthalAngle();
    ctx.roos.style.transform=`rotate(${a*180/Math.PI}deg)`;
  }

  /* ================================ klikken ================================ */
  const straal=new THREE.Raycaster(), muis=new THREE.Vector2();
  let neer=null;
  renderer.domElement.addEventListener("pointerdown",e=>{ neer=[e.clientX,e.clientY]; vlucht=null; });
  renderer.domElement.addEventListener("pointerup",e=>{
    if(!neer||Math.hypot(e.clientX-neer[0],e.clientY-neer[1])>5||!D)return;
    const r=renderer.domElement.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    /* eerst: ligt er een plaats vlak bij de klik (op het scherm)? */
    let best=null, bestD=18;
    for(const n of namen){
      if(n.soort!=="l3-plaats"&&n.soort!=="l3-natuur")continue;
      const pos=D.POS[n.id]; if(!pos)continue;
      tv.set(X(pos[0]),Math.max(yOp(...pos),0)*wereld.scale.y,Z(pos[1])).project(camera);
      if(tv.z>1)continue;
      const d=Math.hypot((tv.x+1)/2*r.width-mx,(1-tv.y)/2*r.height-my);
      if(d<bestD){bestD=d;best=n.id;}
    }
    if(best){ ctx.kies(best); return; }
    muis.set(mx/r.width*2-1,-(my/r.height)*2+1);
    straal.setFromCamera(muis,camera);
    const o=straal.ray.origin, d=straal.ray.direction, sy=wereld.scale.y;
    for(let s=0,stap=.1;s<6000;s+=stap,stap=Math.min(4,stap*1.04)){
      const px=o.x+d.x*s, py=o.y+d.y*s, pz=o.z+d.z*s, wx=px+W/2, wy=pz+H/2;
      if(py<-ZEEDIEPTE)break;
      if(py<=Math.max(0,yOp(wx,wy)*sy)){
        if(wx<0||wy<0||wx>=W||wy>=H){ ctx.kies(null); return; }
        const fp=Math.floor(wy*RES)*RW+Math.floor(wx*RES);
        if(!D.land[fp]){ ctx.kies(null); return; }
        const id=D.ids[D.reg[fp]-1];
        if(ctx.GEBIEDEN[id])ctx.kies("gebied:"+id);
        else{ const pl=ctx.PLAATSEN.find(p=>p.vorm===id); ctx.kies(pl?pl.id:null); }
        return;
      }
    }
  });

  /* ================================ de lus ================================ */
  let actief=false, lusAan=false, vorige=0, intro=null;
  function lus(nu){
    if(!lusAan)return;
    requestAnimationFrame(lus);
    const dt=Math.min(.1,(nu-(vorige||nu))/1000); vorige=nu;
    GEDEELD.uTijd.value+=dt;
    GEDEELD.uWind.value.x+=dt*.9; GEDEELD.uWind.value.y+=dt*.35;
    if(intro)werkIntroBij(nu);
    else{
      werkVluchtBij(nu);
      if(!vlucht){ controls.update(); kantelMee(nu); }
      houdBinnen();
    }
    lucht.position.copy(camera.position); sterren.position.copy(camera.position);
    werkVakkenBij();
    werkBomenBij(nu,false);
    werkSchaduwBij();
    for(const s of schepen){ const f=s.userData.fase+GEDEELD.uTijd.value; s.position.y=Math.sin(f*1.3)*.008; s.rotation.z=Math.sin(f)*.05; s.rotation.x=Math.sin(f*.8)*.03; }
    for(const m of lijnMats)if(m.dashed)m.dashOffset-=dt*.9;
    if(ringLijn)ringLijn.material.opacity=.65+.35*Math.sin(nu/260);
    if(!intro){ if(beeldNr%3===0)werkVerborgenBij(); werkNamenBij(); }
    draaiRoos();
    renderer.render(scene,camera);
    labelRenderer.render(scene,camera);
  }
  function maat(){
    const b=houder.clientWidth||1, h=houder.clientHeight||1;
    camera.aspect=b/h; camera.updateProjectionMatrix();
    renderer.setSize(b,h); labelRenderer.setSize(b,h);
    for(const m of lijnMats)m.resolution.set(b,h);
  }
  new ResizeObserver(()=>{ if(actief)maat(); }).observe(houder);

  /* ---- de overgang ----
     Bij het aanzetten begint de camera recht boven precies het stuk kaart dat
     je op de platte kaart zag, met het land plat. Dan rijzen de bergen op en
     kantelt de blik naar de horizon. Bij het uitzetten andersom. */
  const zichtBreedte=(afst)=>2*afst*Math.tan(FOV*Math.PI/360)*camera.aspect;
  function werkIntroBij(nu){
    const v=intro, k=Math.min(1,(nu-v.t0)/v.duur);
    const e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2, op=1-Math.pow(1-k,3);
    wereld.scale.y=v.s0+(v.s1-v.s0)*(v.uit?e:op);
    /* de wolken komen pas als het land overeind staat, anders hangen ze over
       het beeld dat net nog de platte kaart was */
    if(wolken){ const w=v.uit?1-e:e*e; wolken.material.uniforms.uDekking.value=wolkDek*w; GEDEELD.uWolkSterkte.value=wolkSch*w; }
    controls.target.copy(v.doel);
    zetCamera(v.doel,v.r0+(v.r1-v.r0)*e,v.p0+(v.p1-v.p0)*e,v.a0+(v.a1-v.a0)*e);
    if(k>=1){ intro=null; v.klaar(); }
  }
  function speelIntro(opts){
    return new Promise(res=>{
      if(minderBeweging()){ wereld.scale.y=opts.s1; zetCamera(opts.doel,opts.r1,opts.p1,opts.a1); controls.target.copy(opts.doel); res(); return; }
      intro={...opts,t0:performance.now(),klaar:res};
    });
  }

  /* ================================ naar buiten ================================ */
  let wachtendeKeuze;
  return {
    get actief(){ return actief; },
    async aan(){
      if(actief)return;
      if(gebouwd&&D&&D.sleutel!==ctx.sleutel())ruimOp();
      if(!gebouwd){
        ctx.laad.aan();
        await ctx.adem();
        try{ await bouwAlles(); }
        finally{ ctx.laad.weg(); }
      }
      actief=true;
      houder.hidden=false;
      document.body.classList.add("drie3d");
      maat();
      const [x0,y0,x1,y1]=ctx.zicht();
      const cx=klem((x0+x1)/2,0,W), cy=klem((y0+y1)/2,0,H), breed=klem(x1-x0,20,W*1.6);
      const r0=breed/(2*Math.tan(FOV*Math.PI/360)*camera.aspect);
      const doel=new THREE.Vector3(X(cx),0,Z(cy));
      for(const n of namen){ n.el.classList.add("uit"); n.uit=true; }
      tekenRoutes(); tekenKeuze(ctx.gekozen());
      gekozen=ctx.gekozen();
      wereld.scale.y=.02; zetCamera(doel,r0,0,0); controls.target.copy(doel);
      controls.enabled=false;
      lusAan=true; vorige=0; requestAnimationFrame(lus);
      /* hoe verder ingezoomd, hoe schuiner de blik aan het eind: van dichtbij
         kijk je het land in, van ver zie je het hele werelddeel met de horizon */
      const p1=klem(.97+.13*Math.log10(1000/Math.max(r0,30)),.97,1.16);
      await speelIntro({doel,s0:.02,s1:1,r0,r1:r0*.6,p0:0,p1,a0:0,a1:-.2,duur:3200});
      controls.target.copy(doel); controls.update();
      controls.enabled=true;
      document.body.dataset.drie="klaar";
      if(wachtendeKeuze!==undefined){ const id=wachtendeKeuze; wachtendeKeuze=undefined; this.toon(id); }
    },
    async uit(animeer=true){
      if(!actief)return;
      controls.enabled=false; vlucht=null;
      const doel=controls.target.clone();
      sph.setFromVector3(off.copy(camera.position).sub(doel));
      if(animeer)await speelIntro({doel,s0:1,s1:.02,r0:sph.radius,r1:sph.radius*1.25,p0:sph.phi,p1:0,a0:sph.theta,a1:0,duur:1100,uit:true});
      const breed=zichtBreedte(camera.position.distanceTo(doel));
      actief=false; lusAan=false;
      houder.hidden=true;
      document.body.classList.remove("drie3d");
      delete document.body.dataset.drie;
      if(ctx.roos)ctx.roos.style.transform="";
      ctx.zetZicht(doel.x+W/2,doel.z+H/2,breed);
    },
    /* het zijpaneel of de lijst heeft iets gekozen: daarheen vliegen */
    toon(id){
      if(!actief||intro){ wachtendeKeuze=id; return; }
      this.kies(id);
      if(!id||!D)return;
      if(id.startsWith("gebied:")){
        const i=D.ids.indexOf(id.slice(7)), pool=D.pool[i+1]; if(!pool)return;
        let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
        for(const s of grensPunten(id.slice(7)))for(const [x,y] of s){ x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y); }
        vlieg(pool.x,pool.y,klem(Math.max(x1-x0,y1-y0)*1.25,40,900),.88);
      }else if(id.startsWith("zee:")){
        const z=(ctx.ZEEEN||[]).find(z=>"zee:"+z.id===id); if(z)vlieg(klem(z.x,0,W),klem(z.y,0,H),260,.8);
      }else if(D.POS[id]){
        const p=ctx.PLAATSEN.find(p=>p.id===id);
        const afst=p&&/^(natuur|landschap|rivier)$/.test(p.soort)?Math.max(20,(p.straal||8)*2.8):11;
        vlieg(D.POS[id][0],D.POS[id][1],afst,1.02);
      }
    },
    kies(id){
      gekozen=id;
      if(!actief||!D)return;
      for(const n of namen)n.el.classList.toggle("sel",n.id===id);
      tekenKeuze(id);
    },
    routes(){ if(actief)tekenRoutes(); },
    async thema(){
      if(!gebouwd)return;
      ctx.laad.aan(); await ctx.adem();
      try{
        const k=bouwKleur();
        landKleurTex.image.data.set(k); landKleurTex.needsUpdate=true;
        zetThema();
        boomStand.t=0; werkBomenBij(performance.now(),true);
      }finally{ ctx.laad.weg(); }
    },
    zoom(f){
      vlucht=null;
      const d=camera.position.distanceTo(controls.target);
      sph.setFromVector3(off.copy(camera.position).sub(controls.target));
      vlucht={t0:performance.now(),duur:minderBeweging()?1:450,van:controls.target.clone(),naar:controls.target.clone(),
        r0:d,r1:klem(d/f,controls.minDistance,controls.maxDistance),rm:Math.max(d,d/f),p0:sph.phi,p1:sph.phi,a0:sph.theta,a1:sph.theta};
    },
    overzicht(){
      const pb=ctx.paneelBreedte?ctx.paneelBreedte():0;
      vlieg(W/2+(pb?40:0),H/2+30,760,.72,2200);
    }
  };
}
