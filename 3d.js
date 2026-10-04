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
import {bouwModellen,bouwGehuchten,gehuchtBomen,modelInfo,stijlVan,GEBOUW_GLSL_V,GEBOUW_GLSL_V_MAIN,GEBOUW_GLSL_F,GEBOUW_GLSL_KLEUR,GEBOUW_GLSL_GLOED} from "./3d-modellen.js";
import {TAKEN,rekenregels,rooster,groveRijen,leesVeld,kustVelden,wegLijnen,SEGBREED,LIJSTBREED,METER,MARGE,SCHAAL,ZEEDIEPTE,ZEE0,Yvan,dakHoogte} from "./3d-grond.js";

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
    akkers:["#D8C47A","#9FB060","#9A8460","#BCC888","#C6A85E"],
    weg:"#D3C49E", dorp:"#8E7866", heg:"#55663E"
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
    akkers:["#5C5531","#3E4B2A","#3B3225","#4B5333","#504A2C"],
    weg:"#5A5440", dorp:"#3A3530", heg:"#1E2A18"
  }
};

/* ---- hoe dicht een land bewoond is ----
   Naar de bouwstijl van het land, en naar wat er groeit: op akkerland wonen
   de meeste mensen, in het naaldbos en de woestijn bijna niemand. */
const DICHT_STIJL={araluen:1,hibernia:.8,picta:.3,skandia:.35,teutlandt:.9,gallica:1,iberion:.7,toscana:.95,helleno:.6,arrida:.16,indus:.55,"nihon-ja":.8,steppen:.1};
const GROEI_DICHT={akker:1.3,grasland:1,steppe:.5,heide:.4,loofbos:.6,naaldbos:.35,jungle:.3,woestijn:.12,moeras:.15,toendra:.15,kaal:.25};

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
/* Dag of nacht in de 3D-wereld. Dat staat los van het thema van de pagina:
   een donker thema is een keuze voor het scherm, geen tijdstip. De knop naast
   de 3D-knop zet het om (en het wordt onthouden). */
let nachtModus=false;
try{ nachtModus=localStorage.getItem("gj-tijd")==="nacht"; }catch(e){}
const isDonker=()=>nachtModus;
/* De kleuren van de wereld (rots, sneeuw, de tinten van de landen) staan in
   de CSS, per thema. De wereld neemt ze van het lichte thema overdag en van
   het donkere 's nachts, wat de pagina ook toont. */
let themaVars=null;
function wcss(n){
  if(!themaVars){
    themaVars={licht:{},donker:{}};
    for(const blad of document.styleSheets){
      let regels; try{ regels=blad.cssRules; }catch(e){ continue; }
      for(const r of regels){
        const sel=r.selectorText||"";
        const doel=sel===":root"?themaVars.licht:sel===':root[data-theme="dark"]'?themaVars.donker:null;
        if(!doel)continue;
        for(let i=0;i<r.style.length;i++){ const k=r.style[i]; if(k.startsWith("--"))doel[k]=r.style.getPropertyValue(k).trim(); }
      }
    }
  }
  return (nachtModus?themaVars.donker[n]:themaVars.licht[n])||themaVars.licht[n]||css(n);
}
const rgb=hex=>{ const s=hex.replace("#",""); const n=parseInt(s.length===3?s.replace(/./g,"$&$&"):s,16); return [n>>16&255,n>>8&255,n&255]; };
const mengIn=(k,doel,t)=>{ k[0]+=(doel[0]-k[0])*t; k[1]+=(doel[1]-k[1])*t; k[2]+=(doel[2]-k[2])*t; };
/* "var(--pers-3)" of "#abc" → een echte kleur */
function cssKleur(v){
  const m=/var\((--[^)]+)\)/.exec(v||"");
  return (m?css(m[1]):v)||"#888";
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
     een telefoon twee. Het raster (de kaart met de zee eromheen) wordt een
     plaatje, en dat moet in één textuur passen. */
  const maxTex=renderer.capabilities.maxTextureSize;
  const klein=innerWidth<900||(navigator.hardwareConcurrency||4)<4;
  const RES=(!klein&&maxTex>=(W+2*MARGE)*3)?3:2;

  const scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0xffffff,0.001);   /* alleen om USE_FOG aan te zetten; de echte nevel staat hierboven */
  const camera=new THREE.PerspectiveCamera(FOV,1,.05,60000);
  const wereld=new THREE.Group();                 /* alles wat met het land mee omhoog komt */
  scene.add(wereld);

  const GEDEELD={
    uZonRicht:{value:new THREE.Vector3(0,1,0)}, uZonGloed:{value:new THREE.Color()},
    uNevelKleur:{value:new THREE.Color()}, uNevelDicht:{value:.003}, uNevelVal:{value:.03},
    uZenit:{value:new THREE.Color()}, uTijd:{value:0},
    uWolkKaart:{value:null}, uWind:{value:new THREE.Vector2()}, uWolkVak:{value:new THREE.Vector4(-W,-H,2*W,2*H)},
    uWolkSterkte:{value:0}, uGebouwLicht:{value:.12}, uNacht:{value:0}
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
  controls.minDistance=.22; controls.maxDistance=1500;
  controls.maxPolarAngle=Math.PI*.49;
  controls.zoomSpeed=1.1; controls.rotateSpeed=.6;
  controls.keyPanSpeed=25;
  controls.listenToKeyEvents(window);
  controls.enabled=false;

  /* ===================== de gegevens: hoogte en kleur ===================== */
  let D=null;                   /* alles wat uit world.svg en data.json volgt */
  const R=rooster(W,H,RES), {RW,RH,N}=R;
  /* de broncode van de ruisfuncties, voor de workers (en voor T hieronder) */
  const BRON=`const zeepzacht=${T.zeepzacht};\nconst LAAG=${JSON.stringify(T.LAAG)};\nconst BERGKETENS=${JSON.stringify(T.BERGKETENS)};\n`
    +[T.hash2,T.ruis,T.fbm,T.landruis,T.veeg,T.afstandTotKeten].map(String).join("\n");

  /* ---- de rekenploeg ----
     Een paar Web Workers die het rekenwerk uit 3d-grond.js doen, terwijl de
     pagina blijft reageren. Het werk gaat in vaste stroken (STROKEN, los van
     het aantal workers), zodat de uitkomst niet afhangt van hoeveel kernen er
     toevallig zijn. Lukt het niet om workers te maken, of valt er een om, dan
     doet de hoofddraad dezelfde stroken zelf, met een adempauze ertussen. */
  const STROKEN=8;
  const ploeg=(()=>{
    let werkers=[], nr=0;
    const wacht=new Map(), rij=[], vrij=[];
    const p={kapot:false};
    const volgende=()=>{
      while(vrij.length&&rij.length){
        const w=vrij.pop(), j=rij.shift();
        wacht.set(j.nr,j);
        w.postMessage({nr:j.nr,taak:j.taak,G:j.G,bron:BRON},j.mee);
      }
    };
    /* Valt er een worker om, dan is wat hem was meegegeven weg (overgedragen).
       Alles wat nog openstaat faalt dan, en bouwAlles() begint opnieuw, nu
       op de hoofddraad. */
    const valOm=fout=>{
      p.kapot=true;
      for(const w of werkers)w.terminate();
      werkers=[]; vrij.length=0;
      const open=[...wacht.values(),...rij.splice(0)]; wacht.clear();
      for(const j of open)j.mis(Object.assign(new Error("rekenploeg: "+fout),{opnieuw:true}));
    };
    function maak(){
      if(werkers.length||p.kapot)return;
      const n=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1));
      try{
        for(let i=0;i<n;i++){
          const w=new Worker(new URL("./3d-grond.js",import.meta.url),{type:"module"});
          w.onmessage=e=>{
            const {nr:k,uit,fout}=e.data, j=wacht.get(k); if(!j)return;
            wacht.delete(k); vrij.push(w);
            if(fout){ console.warn("3D-rekenwerk:",fout); valOm(fout); return; }
            j.klaar(uit); volgende();
          };
          w.onerror=e=>{ e.preventDefault(); if(!p.kapot)valOm(e.message||"worker"); };
          werkers.push(w); vrij.push(w);
        }
      }catch(e){ p.kapot=true; werkers=[]; vrij.length=0; }
    }
    /* taak met gegevens G; mee zijn de buffers die mogen worden overgedragen */
    p.doe=async(taak,G,mee=[])=>{
      if(!p.kapot)maak();
      if(p.kapot){ await ctx.adem(); return TAKEN[taak](G,rekenregels(BRON)); }
      return new Promise((klaar,mis)=>{ rij.push({nr:++nr,taak,G,mee,klaar,mis,t0:performance.now()}); volgende(); });
    };
    p.stop=()=>{ for(const w of werkers)w.terminate(); werkers=[]; vrij.length=0; };
    return p;
  })();
  /* de stroken: vaste grenzen, even veel rijen per strook */
  const stroken=()=>{ const uit=[]; for(let i=0;i<STROKEN;i++)uit.push([Math.round(RH*i/STROKEN),Math.round(RH*(i+1)/STROKEN)]); return uit; };
  /* een stuk van een veld (rijen r0..r1 van breedte b), los gekopieerd */
  const snij=(f,b,r0,r1)=>f.slice(r0*b,r1*b);
  const mee=G=>{ const b=[]; for(const k in G){ const v=G[k]; if(v&&ArrayBuffer.isView(v)&&!b.includes(v.buffer))b.push(v.buffer); } return b; };

  async function bouwGegevens(){
    const adem=ctx.adem;
    const ids=Object.keys(ctx.GEO.vormen);
    const {PW,PH}=R;
    /* --- welk gebied ligt waar --- */
    const cv=document.createElement("canvas"); cv.width=RW; cv.height=RH;
    const c2=cv.getContext("2d",{willReadFrequently:true});
    c2.setTransform(RES,0,0,RES,MARGE*RES,MARGE*RES);
    ids.forEach((id,i)=>{ c2.fillStyle=`rgb(${i+1},0,0)`; for(const d of ctx.GEO.vormen[id])c2.fill(new Path2D(d)); });
    let rd=c2.getImageData(0,0,RW,RH).data;
    let reg=new Uint8Array(N), land=new Uint8Array(N);
    for(let p=0,q=0;p<N;p++,q+=4){ reg[p]=rd[q]; if(rd[q+3]>120)land[p]=1; }
    rd=null; cv.width=cv.height=1;

    /* --- de rivieren, zoals de kaart ze getekend heeft --- */
    let rivier=new Uint8Array(N);
    {
      const rc=document.createElement("canvas"); rc.width=RW; rc.height=RH;
      const r2=rc.getContext("2d",{willReadFrequently:true});
      r2.setTransform(RES,0,0,RES,MARGE*RES,MARGE*RES);
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
    /* --- hetzelfde op een grof rooster: één punt per eenheid --- */
    const pc=document.createElement("canvas"); pc.width=PW; pc.height=PH;
    const pctx=pc.getContext("2d",{willReadFrequently:true});
    pctx.setTransform(1,0,0,1,MARGE,MARGE);
    ids.forEach((id,i)=>{ pctx.fillStyle=`rgb(${i+1},0,0)`; for(const d of ctx.GEO.vormen[id])pctx.fill(new Path2D(d)); });
    const pd=pctx.getImageData(0,0,PW,PH).data;
    const pReg=new Uint8Array(PW*PH), pdReg=new Uint8Array(PW*PH);
    for(let p=0;p<PW*PH;p++){ pdReg[p]=pd[p*4]; pReg[p]=pd[p*4+3]>120?pd[p*4]:0; }
    pc.width=pc.height=1;
    await adem();

    /* --- het terrein per gebied, en de plaatsen --- */
    const SOORTEN=Object.keys(T.GROEI);
    const info={}, werkInfo={};
    ids.forEach((id,i)=>{
      const tr=T.terreinVan(id);
      const meta=ctx.GEBIEDEN[id]||ctx.PLAATSEN.find(p=>p.vorm===id);
      const soorten=[].concat(tr.begroeiing||"grasland").map(s=>T.GROEI[s]?s:"grasland");
      const r=T.RELIEF[tr.relief]||T.RELIEF.heuvels;
      info[i+1]={r,soorten,koud:tr.koud?1:0,tint:(meta&&meta.tint)||"a"};
      werkInfo[i+1]={amp:r.amp,rug:r.rug,soorten,koud:tr.koud?1:0};
    });
    const POS={};
    for(const p of ctx.PLAATSEN){ if(p.wacht)continue; const r=ctx.plek(p); if(r)POS[p.id]=r; }
    const vlekken=[];
    for(const p of ctx.PLAATSEN){
      if(!T.GROEI[p.begroeiing]||!POS[p.id])continue;
      const [x,y]=POS[p.id];
      vlekken.push({x,y,r:p.straal||14,rr:(p.straal||14)*1.75,soort:p.begroeiing,gebied:p.gebied});
    }
    /* per plaats: hoe breed de grond eronder vlak wordt, en hoe groot de
       open plek in het bos eromheen (een kasteel ligt tussen zijn akkers) */
    const plekken=[];
    for(const p of ctx.PLAATSEN){
      const pos=POS[p.id]; if(!pos)continue;
      const m=modelVoor(p);
      plekken.push({id:p.id,x:pos[0],y:pos[1],vlak:m.vlak||null,open:m.open||0,kloof:m.kloof||null,meer:m.meer||null,klif:m.klif||null});
    }

    /* --- het rekenwerk --- */
    const v=await ploeg.doe("voorbereiding",{R,land,reg,pReg,pdReg,info:werkInfo,SOORTEN,vlekken,plekken},[land.buffer,reg.buffer,pReg.buffer,pdReg.buffer]);
    land=v.land; reg=v.reg;
    /* de drie afstandsvelden tegelijk */
    const [ak,az,ap]=await Promise.all(["kust","zee","pool"].map(soort=>{
      const G={R,soort,land:land.slice(),reg:reg.slice()};
      return ploeg.doe("afstand",G,mee(G));
    }));
    const {fKust,fFijn}=kustVelden(R,ak.dmax,v.pdReg,T);
    let h=new Float32Array(N), kust=new Uint8Array(N);
    await Promise.all(stroken().map(async([y0,y1])=>{
      const [g0,g1]=groveRijen(R,y0,y1);
      const G={R,y0,y1,go:g0*PW,
        land:snij(land,RW,y0,y1),rivier:snij(rivier,RW,y0,y1),kustAfst:snij(ak.kustAfst,RW,y0,y1),zeeAfst:snij(az.zeeAfst,RW,y0,y1),
        fAmp:snij(v.fAmp,PW,g0,g1),fRug:snij(v.fRug,PW,g0,g1),fKust:snij(fKust,PW,g0,g1),fFijn:snij(fFijn,PW,g0,g1)};
      const r=await ploeg.doe("hoogte",G,mee(G));
      h.set(r.h,y0*RW); kust.set(r.kust,y0*RW);
    }));
    const a=await ploeg.doe("afwerking",{R,h,land,rivier,reg,kust,plekken,kloven:v.kloven},[h.buffer,land.buffer,rivier.buffer,reg.buffer,kust.buffer]);
    /* --- de naamloze boerderijen, gehuchten en dorpen, en de wegen ---
       Hoe dicht een land bewoond is: naar zijn bouwstijl (de akkers van
       Araluen en Gallica vol, de steppe en de woestijn bijna leeg) en naar
       wat er groeit. */
    const dicht=new Float32Array(256), wegLand=new Uint8Array(256);
    ids.forEach((id,i)=>{
      if(!ctx.GEBIEDEN[id])return;
      const st=stijlVan(id), w=werkInfo[i+1];
      const groei=w.soorten.reduce((t,s)=>t+(GROEI_DICHT[s]??.5),0)/w.soorten.length;
      dicht[i+1]=(DICHT_STIJL[st]??.5)*groei*(w.koud?.75:1);
      wegLand[i+1]=st==="steppen"?0:1;
    });
    const plaatsLijst=[];
    for(const p of ctx.PLAATSEN){
      const pos=POS[p.id]; if(!pos)continue;
      const groot=/^(stad|haven|kasteel)$/.test(p.soort);
      const fx=Math.floor((pos[0]+MARGE)*RES), fy=Math.floor((pos[1]+MARGE)*RES), r0=a.reg[fy*RW+fx]||0;
      plaatsLijst.push({x:pos[0],y:pos[1],r:groot?1.3:/^(ruine|slagveld)$/.test(p.soort)?.8:.3,groot,weg:wegLand[r0]});
    }
    const nz=await ploeg.doe("nederzettingen",{R,h:a.h,land:a.land,rivier:a.rivier,reg:a.reg,fBos:v.fBos,dicht,wegLand,plaatsen:plaatsLijst,meren:a.meren});
    /* een gehucht ligt in een open plek in het bos, net als een plaats */
    const bosPlekken=plekken.slice();
    for(let i=0;i<nz.plekken.length;i+=6)bosPlekken.push({x:nz.plekken[i],y:nz.plekken[i+1],open:[.3,.36,.45][nz.plekken[i+2]]});
    /* het bladerdak en de normalen, per strook (met twee rijen rand) */
    const bos=new Uint8Array(N), normalen=new Uint8Array(N*4);
    await Promise.all(stroken().map(async([y0,y1])=>{
      const hr0=Math.max(0,y0-2), hr1=Math.min(RH,y1+2), [g0,g1]=groveRijen(R,hr0,hr1);
      const G={R,y0,y1,hr0,hr1,go:g0*PW,plekken:bosPlekken.filter(p=>p.open&&p.y+4>hr0/RES-MARGE&&p.y-4<hr1/RES-MARGE),meren:a.meren,
        h:snij(a.h,RW,hr0,hr1),land:snij(a.land,RW,hr0,hr1),rivier:snij(a.rivier,RW,hr0,hr1),kust:snij(a.kust,RW,hr0,hr1),
        fBos:snij(v.fBos,PW,g0,g1)};
      const r=await ploeg.doe("bos",G,mee(G));
      bos.set(r.bos,y0*RW); normalen.set(r.normalen,y0*RW*4);
    }));
    await adem();
    D={ids,reg:a.reg,land:a.land,rivier:a.rivier,h:a.h,kust:a.kust,grens:a.grens,bos,normalen,
       pReg:v.pReg,pdReg:v.pdReg,mixA:v.mixA,mixB:v.mixB,mixF:v.mixF,SOORTEN,fKoud:v.fKoud,fBos:v.fBos,fLoof:v.fLoof,
       info,vlekken,POS,pool:ap.pool,kloven:v.kloven,meren:a.meren,sleutel:ctx.sleutel(),
       plekken:nz.plekken,wegen:JSON.parse(nz.wegen),bruggen:nz.bruggen};
  }

  /* hoogte op een willekeurige plek, uit het raster (0..1 land, -1..0 zee) */
  function hNorm(wx,wy){
    const fx=(wx+MARGE)*RES, fy=(wy+MARGE)*RES;
    if(fx<0||fy<0||fx>RW-1.001||fy>RH-1.001)return -1;
    const x0=fx|0, y0=fy|0, tx=fx-x0, ty=fy-y0, p=y0*RW+x0, h=D.h;
    return h[p]*(1-tx)*(1-ty)+h[p+1]*tx*(1-ty)+h[p+RW]*(1-tx)*ty+h[p+RW+1]*tx*ty;
  }
  const yOp=(wx,wy)=>Yvan(hNorm(wx,wy));
  /* het bladerdak op een plek: de hoogte van wat je ziet, bos meegerekend */
  function bosOp(wx,wy){
    const fx=(wx+MARGE)*RES, fy=(wy+MARGE)*RES;
    if(fx<0||fy<0||fx>RW-1.001||fy>RH-1.001)return 0;
    const x0=fx|0, y0=fy|0, tx=fx-x0, ty=fy-y0, p=y0*RW+x0, b=D.bos;
    return b[p]*(1-tx)*(1-ty)+b[p+1]*tx*(1-ty)+b[p+RW]*(1-tx)*ty+b[p+RW+1]*tx*ty;
  }
  const yDak=(wx,wy)=>{ const b=bosOp(wx,wy); return yOp(wx,wy)+(b>0?dakHoogte(b,wx,wy,T):0); };
  /* ligt dit punt op het land? Langs de kust is het land zo laag dat de
     hoogte er niets over zegt; het raster van de landvormen wel */
  const opLand=(wx,wy)=>{
    const x=Math.floor((wx+MARGE)*RES), y=Math.floor((wy+MARGE)*RES);
    return x>=0&&y>=0&&x<RW&&y<RH&&D.land[y*RW+x]===1;
  };
  const leesD=(f,wx,wy)=>leesVeld(f,0,R,wx,wy);
  const totKeten=(wx,wy)=>T.afstandTotKeten(wx,wy);
  /* de grond onder een punt, met water als bodem — zo hoog als de camera minstens moet */
  const grondY=(wx,wy)=>Math.max(0,yDak(wx,wy))*wereld.scale.y;

  /* ---- de kleur van het land ----
     Het zware deel (per rasterpunt) staat in 3d-grond.js en gaat per strook
     naar de rekenploeg. Hier eerst de kleurvelden op het grove rooster —
     begroeiing en de tint van het land, zacht over de grenzen —, en na
     afloop de lappendeken van akkers rond dorpen en kastelen. */
  async function bouwKleur(){
    const donker=isDonker(), th=donker?THEMA.donker:THEMA.licht;
    const {PW,PH}=R, {pReg,info}=D;
    const M2=PW*PH;
    const fR=new Float32Array(M2), fG=new Float32Array(M2), fB=new Float32Array(M2);
    const fKorrel=new Float32Array(M2), fVlek=new Float32Array(M2);
    const kleurVan=s=>rgb(donker?T.GROEI[s].donker:T.GROEI[s].licht);
    const tonen={}; for(const k of "abcdef")tonen[k]=rgb(wcss("--tone-"+k)||"#888888");
    const TOON=.30;      /* zelfde als in bouwGrond() */
    const middel=kleurVan("grasland");
    fR.fill(middel[0]); fG.fill(middel[1]); fB.fill(middel[2]);
    fKorrel.fill(T.GROEI.grasland.korrel); fVlek.fill(T.GROEI.grasland.vlek);
    for(let p=0;p<M2;p++){
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
      for(let y=Math.max(-MARGE,Math.floor(v.y-v.rr));y<=Math.min(PH-1-MARGE,Math.ceil(v.y+v.rr));y++)
        for(let x=Math.max(-MARGE,Math.floor(v.x-v.rr));x<=Math.min(PW-1-MARGE,Math.ceil(v.x+v.rr));x++){
          const p=(y+MARGE)*PW+x+MARGE; if(!pReg[p])continue;
          const golf=v.r*(.72+.56*T.ruis(x*.10+91,y*.10-53));
          const w=glad(klem(1-Math.hypot(x-v.x,y-v.y)/golf,0,1)); if(w<=0)continue;
          fR[p]+=(k[0]-fR[p])*w; fG[p]+=(k[1]-fG[p])*w; fB[p]+=(k[2]-fB[p])*w;
          fKorrel[p]+=(gr.korrel-fKorrel[p])*w; fVlek[p]+=(gr.vlek-fVlek[p])*w;
        }
    }
    const kl={ROTS:rgb(wcss("--rots")||"#9C9782"),SNEEUW:rgb(wcss("--sneeuw")||"#F1EFE4"),GRENS:rgb(wcss("--coast")||"#5A6356"),
      ZAND:rgb(th.zand),RIV:rgb(th.rivier),BO:rgb(th.bodemOndiep),BD:rgb(th.bodemDiep)};
    const uit=new Uint8Array(N*4);
    const RAND=Math.round(7*RES)+2;     /* rijen extra boven en onder, voor de holtes */
    await Promise.all(stroken().map(async([y0,y1])=>{
      const [g0,g1]=groveRijen(R,y0,y1), hr0=Math.max(0,y0-RAND), hr1=Math.min(RH,y1+RAND);
      const G={R,y0,y1,hr0,hr1,go:g0*PW,th:kl,
        h:snij(D.h,RW,hr0,hr1),land:snij(D.land,RW,y0,y1),kust:snij(D.kust,RW,y0,y1),grens:snij(D.grens,RW,y0,y1),
        rivier:snij(D.rivier,RW,y0,y1),bos:snij(D.bos,RW,y0,y1),
        fR:snij(fR,PW,g0,g1),fG:snij(fG,PW,g0,g1),fB:snij(fB,PW,g0,g1),fKorrel:snij(fKorrel,PW,g0,g1),
        fVlek:snij(fVlek,PW,g0,g1),fKoud:snij(D.fKoud,PW,g0,g1)};
      const r=await ploeg.doe("kleur",G,mee(G));
      uit.set(r.kleur,y0*RW*4);
    }));
    /* de akkers rond dorpen en kastelen, en rond elke naamloze nederzetting;
       van ver is een gehucht een vlekje daken tussen zijn akkers */
    const akk=th.akkers.map(rgb), {land,h,rivier}=D, dk=rgb(th.dorp);
    for(const [cx,cy,Ra] of akkerPlekken()){
      const hk=T.hash2(cx*13|0,cy*7|0), rot=hk*Math.PI, co=Math.cos(rot), si=Math.sin(rot);
      for(let y=Math.max(0,Math.floor((cy+MARGE-Ra)*RES));y<=Math.min(RH-1,Math.ceil((cy+MARGE+Ra)*RES));y++)
        for(let x=Math.max(0,Math.floor((cx+MARGE-Ra)*RES));x<=Math.min(RW-1,Math.ceil((cx+MARGE+Ra)*RES));x++){
          const pp=y*RW+x; if(!land[pp]||h[pp]>.33||rivier[pp]||D.bos[pp]>60)continue;
          const dx=x/RES-MARGE-cx, dy=y/RES-MARGE-cy, d=Math.hypot(dx,dy);
          if(d>Ra||d<.55)continue;
          const u=(dx*co+dy*si)/1.6, vv=(-dx*si+dy*co)/1.1;
          const cu=Math.floor(u), cv=Math.floor(vv), hc=T.hash2(cu+997*(hk*100|0),cv-311);
          if(hc<.18)continue;
          const kk=akk[Math.floor(hc*akk.length)%akk.length];
          const w=(1-glad(d/Ra))*.3*(1-D.bos[pp]/60);
          const q=pp*4;
          uit[q]+=(kk[0]-uit[q])*w; uit[q+1]+=(kk[1]-uit[q+1])*w; uit[q+2]+=(kk[2]-uit[q+2])*w;
        }
    }
    const P=D.plekken;
    for(let i=0;i<P.length;i+=6){
      const cx=P[i], cy=P[i+1], r=[.05,.08,.12][P[i+2]];
      for(let y=Math.floor((cy+MARGE-r)*RES);y<=Math.ceil((cy+MARGE+r)*RES);y++)for(let x=Math.floor((cx+MARGE-r)*RES);x<=Math.ceil((cx+MARGE+r)*RES);x++){
        const pp=y*RW+x; if(pp<0||pp>=N||!land[pp])continue;
        const d=Math.hypot(x/RES-MARGE-cx,y/RES-MARGE-cy); if(d>r)continue;
        const w=(1-d/r)*.45, q=pp*4;
        uit[q]+=(dk[0]-uit[q])*w; uit[q+1]+=(dk[1]-uit[q+1])*w; uit[q+2]+=(dk[2]-uit[q+2])*w;
      }
    }
    return uit;
  }

  /* waar akkers liggen: rond de plaatsen van de kaart, en rond elke naamloze
     boerderij, elk gehucht en dorp ([x, y, straal]) */
  function akkerPlekken(){
    const uit=[];
    for(const p of ctx.PLAATSEN){
      if(!/^(stad|haven|kasteel)$/.test(p.soort)||!D.POS[p.id])continue;
      uit.push([D.POS[p.id][0],D.POS[p.id][1],p.soort==="kasteel"?3.0:3.6]);
    }
    const P=D.plekken;
    for(let i=0;i<P.length;i+=6)uit.push([P[i],P[i+1],[1.1,1.7,2.4][P[i+2]]]);
    return uit;
  }
  /* De waterdiepte voor de zee-shader, op het volle raster. Op een grover
     raster loopt de kustlijn van het water een halve eenheid scheef ten
     opzichte van het land, en staan huizen aan de haven met hun voeten in zee. */
  function bouwDiepte(){
    const uit=new Uint16Array(N), h=D.h;
    for(let p=0;p<N;p++)uit[p]=THREE.DataUtils.toHalfFloat(Yvan(h[p]));
    const t=new THREE.DataTexture(uit,RW,RH,THREE.RedFormat,THREE.HalfFloatType);
    t.minFilter=t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
    return t;
  }

  /* ======================= het land: stukken met detail =======================
     Het land is opgedeeld in vakken van 40 bij 40. Elk vak wordt fijner naarmate
     de camera dichterbij komt: van een punt per vier eenheden in de verte tot
     vier per eenheid vlakbij. Een rok langs de rand dekt de naad tussen twee
     vakken van verschillende fijnheid af. */
  const VAK=40, VNX=Math.ceil((W+2*MARGE)/VAK), VNY=Math.ceil((H+2*MARGE)/VAK);
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
    const x0=cx*VAK-MARGE, y0=cy*VAK-MARGE;
    let i3=0,i2=0;
    for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
      const wx=x0+i*s, wy=y0+j*s, y=yDak(wx,wy);
      const nx=-(yDak(wx+s,wy)-yDak(wx-s,wy))/(2*s), nz=-(yDak(wx,wy+s)-yDak(wx,wy-s))/(2*s), l=Math.hypot(nx,1,nz);
      pos[i3]=X(wx); pos[i3+1]=y; pos[i3+2]=Z(wy);
      nor[i3]=nx/l; nor[i3+1]=1/l; nor[i3+2]=nz/l;
      /* het kleurplaatje dekt het hele raster, kaart en zee eromheen */
      uv[i2]=(wx+MARGE)/(W+2*MARGE); uv[i2+1]=(wy+MARGE)/(H+2*MARGE); i3+=3; i2+=2;
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
  /* ---- de kruinen ----
     Het bladerdak is een massa in het land (zie bosVeld() in 3d-grond.js),
     maar van dichtbij moet het uit kruinen bestaan. Die tekent de shader
     erin: een raster van cellen met in elke cel een kruin op een eigen plek
     (celruis, "Worley"), met een eigen maat en tint. Een loofboom is een
     koepel, een naaldboom een kegel; tussen de kruinen valt minder licht. De
     kruinen hangen aan de wereld, niet aan het scherm, dus ze staan stil als
     de camera beweegt. Worden ze kleiner dan een paar beeldpunten, dan gaan
     ze geleidelijk over in het egale bosgroen van het kleurplaatje — zo
     afgesteld dat het gemiddelde even donker blijft, zodat er bij geen enkele
     afstand iets verspringt. */
  /* op een telefoon minder stappen voor de parallax van de kruinen */
  const KRUINSTAP=klein?3:7;
  const KRUIN_GLSL=`
  uniform sampler2D uLoof;
  vec2 kHash(vec2 c){
    uvec2 q=uvec2(ivec2(c)+ivec2(65536));
    q=q*uvec2(1597334673U,3812015801U);
    uint n=(q.x^q.y)*1597334673U;
    return vec2(uvec2(n,n*48271U))*(1.0/4294967295.0);
  }
  /* p in cellen; uit: hoe hoog de kruin hier is (0 tussen de kruinen, 1 op
     de top), de helling naar buiten, en licht en tint */
  float kruin(vec2 p,float loof,out vec2 helling,out vec3 kleur){
    vec2 c=floor(p), f=p-c;
    float best=9.0; vec2 bv=vec2(0.0), bid=vec2(0.0);
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
      vec2 g=vec2(float(i),float(j)), r=g+.2+.6*kHash(c+g)-f;
      float d=dot(r,r);
      if(d<best){ best=d; bv=r; bid=c+g; }
    }
    vec2 h2=kHash(bid+vec2(17.0,-31.0));
    /* een kruin is geen cirkel: een paar lobben rond de rand */
    float hoek=atan(bv.y,bv.x);
    float lob=1.0+.13*sin(hoek*5.0+h2.y*6.28)*mix(.4,1.0,loof)+.06*sin(hoek*9.0+h2.x*6.28);
    float afst=sqrt(best), d=afst/(mix(.58,.82,h2.x)*mix(.86,1.12,loof)*lob);
    float binnen=1.0-smoothstep(.8,1.0,d);
    float koepel=sqrt(max(1.0-d*d,0.0)), kegel=max(1.0-d,0.0);
    float hoog=mix(kegel,koepel,loof)*binnen*mix(.75,1.0,h2.x);
    float steil=mix(1.2,min(d/max(koepel,.25),2.4)*.7,loof);
    helling=-bv/max(afst,1e-4)*steil*binnen*.55;
    float licht=mix(.34,1.0,hoog)/mix(.60,.70,loof);
    vec3 tint=mix(vec3(.93,1.0,1.05),vec3(1.06+.09*h2.y,1.03,.88),loof);
    kleur=vec3(licht*(.82+.36*h2.y))*mix(vec3(1.0),tint,.8);
    return hoog;
  }
  /* De kruinen steken boven de grond tussen de bomen uit. Schuin bekeken
     verbergt een kruin wat erachter ligt: langs de kijkrichting naar binnen
     stappen tot de straal een kruin raakt (parallax). Zo worden het bollen
     in plaats van plaatjes op de grond. */
  float kruinRaak(vec2 p0,vec3 V,float loof,float sterk,out vec2 helling,out vec3 kleur){
    vec2 stap=-V.xz/max(V.y,.22)*(.055/.11)*sterk;
    float diep=0.0, diepV=0.0, zakV=1.0-kruin(p0,loof,helling,kleur);
    if(zakV>0.0){
      for(int i=0;i<${KRUINSTAP};i++){
        diep+=${(1.05/KRUINSTAP).toFixed(3)};
        float zak=1.0-kruin(p0+stap*diep,loof,helling,kleur);
        if(diep>=zak){
          /* tussen de laatste twee stappen: waar de straal het oppervlak kruist */
          float a=zakV-diepV, b=diep-zak;
          diep=mix(diepV,diep,a/max(a+b,1e-4));
          break;
        }
        diepV=diep; zakV=zak;
      }
    }
    return kruin(p0+stap*diep,loof,helling,kleur);
  }`;
  /* de kleur van rots, uit hetzelfde CSS-variabele als de kaart (per thema) */
  const rotsKleur={value:new THREE.Color()}, wegKleur={value:new THREE.Color()};
  const wegU={uWegSeg:{value:null},uWegLijst:{value:null},uWegCel:{value:null}};
  let wegL=null, akkerData=null;
  const akkU={value:[0,1,2,3,4].map(()=>new THREE.Color())}, hegKleur={value:new THREE.Color()};
  function maakLandMat(kleurTex,normTex,loofTex){
    const m=new THREE.MeshStandardMaterial({map:kleurTex,normalMap:normTex,
      normalMapType:THREE.ObjectSpaceNormalMap,roughness:.93,metalness:0});
    m.onBeforeCompile=sh=>{
      metNevel(sh);
      sh.uniforms.uDetail={value:detailTex};
      sh.uniforms.uLoof={value:loofTex};
      sh.uniforms.uRots=rotsKleur;
      Object.assign(sh.uniforms,wegU);
      sh.uniforms.uAkk=akkU; sh.uniforms.uHeg=hegKleur;
      sh.uniforms.uWegKleur=wegKleur;
      sh.vertexShader=sh.vertexShader
        .replace("#include <common>","#include <common>\nvarying vec3 vWolkW;")
        .replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nvWolkW=(modelMatrix*vec4(transformed,1.0)).xyz;");
      sh.fragmentShader=sh.fragmentShader
        .replace("#include <fog_pars_fragment>","#include <fog_pars_fragment>\nvarying vec3 vWolkW;\nuniform sampler2D uDetail;\nuniform vec3 uRots;\nuniform vec3 uAkk[5];\nuniform vec3 uHeg;\nuniform sampler2D uWegSeg;\nuniform sampler2D uWegLijst;\nuniform sampler2D uWegCel;\nuniform vec3 uWegKleur;\n"+WOLK_GLSL+KRUIN_GLSL
          +"float randSchaduw(vec4 c,float s){ vec3 p=c.xyz/c.w; float r=min(min(p.x,1.0-p.x),min(p.y,1.0-p.y)); return mix(1.0,s,smoothstep(0.0,.18,r)); }")
        /* Van dichtbij is het kleurplaatje te grof: dan een fijne korrel van
           gras, aarde en steen eroverheen, die in de verte weer wegvalt. */
        .replace("#include <map_fragment>",`#include <map_fragment>
          float dAfst=distance(vWolkW,cameraPosition);
          float korrel=texture2D(uDetail,vWolkW.xz*.83).r*.55+texture2D(uDetail,vWolkW.xz*3.1).r*.45;
          /* in het bos alleen een vleugje: daar doen de kruinen het werk */
          float bosM=texture2D(normalMap,vNormalMapUv).a;
          diffuseColor.rgb*=mix(1.0,.84+.32*korrel,(1.0-smoothstep(6.0,55.0,dAfst))*(1.0-.7*bosM));
          /* Een steile wand (een klif, een bergflank) is rots. Het kleurplaatje
             is daar uitgerekt — een wand van een eenheid hoog beslaat maar een
             paar beeldpunten ervan —, dus hier eigen rots, met lagen gesteente
             die horizontaal door de wand lopen en verticale voren van het
             water dat erlangs loopt. */
          vec3 nO=texture2D(normalMap,vNormalMapUv).xyz*2.0-1.0;
          float wand=smoothstep(.27,.55,1.0-normalize(nO).y)*(1.0-bosM);
          if(wand>.002){
            float laag=texture2D(uDetail,vec2((vWolkW.x+vWolkW.z)*.05,vWolkW.y*.9)).r;
            float voor=texture2D(uDetail,vec2((vWolkW.x-vWolkW.z)*1.3,vWolkW.y*.12)).r;
            vec3 rots=uRots*(.72+.4*laag)*(.93+.12*voor);
            diffuseColor.rgb=mix(diffuseColor.rgb,rots,wand);
          }
          float loof=texture2D(uLoof,vMapUv).r;
          /* vaste celmaat: een maat die met het loof meeloopt zou het hele
             patroon laten verschuiven waar het bos van soort wisselt */
          vec2 kp=vWolkW.xz/.035;
          float bosZicht=bosM*(1.0-smoothstep(.3,.65,length(fwidth(kp))));
          vec2 kruinHelling=vec2(0.0);
          /* bladclusters binnen een kruin: dezelfde korrel, fijner */
          float blad=texture2D(uDetail,vWolkW.xz*2.4).r;
          /* waar de kruinen te klein worden om te tekenen: groepjes bomen,
             open plekken en schaduw ertussen, zodat bos ook van ver bos is */
          if(bosM>.01){
            float pol=texture2D(uDetail,vWolkW.xz*1.3).r*.6+texture2D(uDetail,vWolkW.xz*.37).r*.4;
            diffuseColor.rgb*=mix(1.0,.66+.5*pol,bosM*(1.0-bosZicht));
          }
          if(bosZicht>.002){
            vec3 kk;
            float hk=kruinRaak(kp,normalize(cameraPosition-vWolkW),loof,bosZicht,kruinHelling,kk);
            kk*=mix(1.0,.8+.4*blad,hk);
            diffuseColor.rgb*=mix(vec3(1.0),kk,bosZicht);
          }
          /* De lappendeken van akkers. Twee lagen: kavels (grote cellen van
             een paar eenheden, elk met een eigen richting en een eigen
             overheersend gewas) die tot ver weg te zien zijn, en daarin
             langwerpige akkers in rijen, met heggen langs de kavelranden en
             tussen een deel van de akkers, en een pad tussen de kavels. Alles
             in plaatselijke coördinaten van de kavel, zodat het patroon stil
             blijft liggen. Elk detail gaat, als het kleiner wordt dan een
             paar beeldpunten, over in het gemiddelde van wat het bedekt; zo
             verspringt er bij geen enkele afstand iets. */
          float akker=texture2D(uLoof,vMapUv).g*(1.0-bosM);
          float akPx=length(fwidth(vWolkW.xz));
          if(akker>.01){
            /* de kavelranden golven wat: echte percelen volgen sloten en
               oude grenzen, geen rechte lijnen van punt tot punt */
            vec2 kWarp=(vec2(texture2D(uDetail,vWolkW.xz*.065).r,texture2D(uDetail,vWolkW.xz*.065+vec2(.37,.61)).r)-.5)*.3;
            vec2 bp=(vWolkW.xz+kWarp)/1.0, bc=floor(bp), bf=bp-bc;
            float b1=9.0, b2=9.0; vec2 bid=vec2(0.0), bpos=vec2(0.0);
            for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
              vec2 g=vec2(float(i),float(j)), o=.1+.8*kHash(bc+g+vec2(3.0,11.0)), r=g+o-bf;
              float d=dot(r,r);
              if(d<b1){ b2=b1; b1=d; bid=bc+g; bpos=bc+g+o; } else if(d<b2)b2=d;
            }
            vec2 h3=kHash(bid+vec2(7.0,-19.0));
            /* het gewas van de kavel, en of hij in akkers verdeeld is of één wei */
            int kg=int(h3.y*5.0);
            vec3 kavelKleur=uAkk[kg];
            float th=h3.x*3.1416, cs=cos(th), sn=sin(th);
            vec2 q=vWolkW.xz+kWarp-bpos*1.0; q=vec2(cs*q.x+sn*q.y,-sn*q.x+cs*q.y);
            float w=mix(.065,.12,h3.y), L=mix(.16,.38,fract(h3.y*7.13));
            float rij=floor(q.y/w), sch=kHash(vec2(rij,bid.x+bid.y*17.0)).x*L;
            float kol=floor((q.x+sch)/L);
            vec2 hh=kHash(vec2(kol,rij)+bid*64.0);
            int ag=int(hh.x*5.0);
            /* de helft van de akkers heeft het gewas van de kavel, de rest een ander */
            vec3 akkerKleur=hh.y<.5?kavelKleur:uAkk[ag];
            float fy=fract(q.y/w), fx=fract((q.x+sch)/L);
            float rand=min(min(fy,1.0-fy)*w,min(fx,1.0-fx)*L);
            float zAkker=1.0-smoothstep(.013,.035,akPx);
            vec3 gewas=mix(mix(kavelKleur,(uAkk[0]+uAkk[1]+uAkk[2]+uAkk[3]+uAkk[4])*.2,.4+.45*smoothstep(.04,.26,akPx)),akkerKleur,zAkker);
            /* ploegvoren in een deel van de akkers */
            float voor=step(.6,hh.y)*(.5+.5*sin(q.y/w*6.2832*7.0))*(1.0-smoothstep(.002,.007,akPx));
            gewas*=1.0-.06*voor;
            /* heggen: langs elke kavelrand, en tussen een deel van de akkers */
            float aa=akPx*.7;
            float kRand=(sqrt(b2)-sqrt(b1))*1.0*.5;
            float hegK=1.0-smoothstep(.0016,.0016+aa,kRand);
            float hegA=(1.0-smoothstep(.0012,.0012+aa,rand))*step(.45,kHash(vec2(rij*3.0+kol,bid.y)).y);
            float zHeg=1.0-smoothstep(.005,.016,akPx);
            float heg=max(hegK,hegA*zHeg);
            /* van ver: de heggen als een zweem donkerder langs de kavelranden */
            heg=mix((1.0-smoothstep(.0,.016+akPx,kRand))*.12*(1.0-smoothstep(.03,.13,akPx)),heg,zHeg);
            float pad=(1.0-smoothstep(.002,.002+aa,abs(kRand-.004)))*zHeg*.6;
            vec3 akkerRes=mix(gewas,uHeg,heg);
            akkerRes=mix(akkerRes,uWegKleur,pad*(1.0-heg));
            float zKavel=1.0-smoothstep(.16,.45,akPx);
            diffuseColor.rgb=mix(diffuseColor.rgb,akkerRes*(.92+.16*korrel),akker*.62*zKavel);
          }
          /* De wegen. Per cel van een eenheid staat in uWegCel welke
             lijnstukken er langs komen (wegLijnen() in 3d-grond.js); hier de
             echte afstand tot elk ervan, dus scherp op elke afstand. Is een
             weg smaller dan een beeldpunt, dan dekt hij maar een deel ervan;
             langs de rand een strookje berm, in het midden de sporen van de
             karren. Straten (soort 1) zijn wat grijzer: daar ligt grind. */
          vec2 wKp=vWolkW.xz+vec2(${(W/2).toFixed(1)},${(H/2).toFixed(1)});
          float wCel=texelFetch(uWegCel,ivec2(floor(wKp+${MARGE.toFixed(1)})),0).r;
          if(wCel>0.0){
            int wO=int(floor(wCel/32.0)), wN=int(wCel-floor(wCel/32.0)*32.0);
            float wE=1e3, wS=0.0, wH=.01;
            for(int i=0;i<31;i++){
              if(i>=wN)break;
              int li=wO+i;
              int sk=int(texelFetch(uWegLijst,ivec2(li%${LIJSTBREED},li/${LIJSTBREED}),0).r);
              ivec2 st=ivec2((sk%${SEGBREED})*2,sk/${SEGBREED});
              vec4 sa=texelFetch(uWegSeg,st,0), sb=texelFetch(uWegSeg,st+ivec2(1,0),0);
              vec2 ab=sa.zw-sa.xy;
              float t=clamp(dot(wKp-sa.xy,ab)/max(dot(ab,ab),1e-10),0.0,1.0);
              float e=length(wKp-sa.xy-ab*t)-sb.x;
              if(e<wE){ wE=e; wS=sb.y; wH=sb.x; }
            }
            if(wE<.05){
              float wPx=length(fwidth(wKp));
              float wAA=wPx*.6+1e-5;
              float dek=clamp(2.6*wH/max(wPx,1e-5),0.0,1.0);
              /* onder een gesloten bladerdak zie je de weg niet */
              float weg=(1.0-smoothstep(-wAA,wAA,wE))*dek*(1.0-smoothstep(.5,.9,bosM));
              float berm=(1.0-smoothstep(0.0,.008+wAA,wE))*(1.0-weg)*.2*dek;
              float spoor=(1.0-smoothstep(.0011,.0011+wAA,abs(wE+wH*.55)))*clamp(.003/max(wPx,1e-5),0.0,1.0)*(1.0-wS);
              vec3 wk=mix(uWegKleur,uWegKleur*vec3(.9,.9,.93),wS)*(.88+.24*texture2D(uDetail,wKp*2.3).r)*(1.0-.16*spoor);
              diffuseColor.rgb=mix(diffuseColor.rgb*(1.0-berm),wk,weg*.94);
            }
          }`)
        /* Onder water is een schaduw zachter: het water strooit het licht. Zo
           tekenen de schaduwen van bergen zich in ondiep water niet meer als
           harde vlakken af op de bodem (het wateroppervlak zelf ontvangt geen
           schaduw). */
        /* De schaduwkaart dekt een vak rond waar je kijkt; daarbuiten valt
           geen schaduw. Naar de rand van dat vak toe loopt de schaduw daarom
           geleidelijk uit, anders staat er een rechte lijn in het landschap. */
        .replace("#include <lights_fragment_begin>",THREE.ShaderChunk.lights_fragment_begin.replace(
          "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;",
          "directLight.color *= ( directLight.visible && receiveShadow ) ? onderWater+(1.0-onderWater)*randSchaduw(vDirectionalShadowCoord[ i ],getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )) : 1.0;"))
        .replace("#include <normal_fragment_maps>",`
          float onderWater=.8*(1.0-smoothstep(-1.4,-.04,vWolkW.y));
          normal=texture2D(normalMap,vNormalMapUv).xyz*2.0-1.0;
          normal.xz+=kruinHelling*bosZicht;
          normal=normalize(normalMatrix*normalize(normal));`)
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
      const x0=v.cx*VAK-MARGE, y0=v.cy*VAK-MARGE;
      vb.min.set(X(x0),v.ymin*sy,Z(y0)); vb.max.set(X(x0+VAK),Math.max(v.ymax,0)*sy,Z(y0+VAK));
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
    uniforms:{...GEDEELD,uDiepte:{value:null},uGolf:{value:golfTex},
      /* het raster van de diepte; een rasterpunt ligt midden in zijn texel */
      uVak:{value:new THREE.Vector4(-W/2-MARGE-.5/RES,-H/2-MARGE-.5/RES,W+2*MARGE,H+2*MARGE)},
      uMaxDiep:{value:ZEEDIEPTE+ZEE0},uOndiep:{value:new THREE.Color()},uDiep:{value:new THREE.Color()},
      uSchuim:{value:new THREE.Color()},uZonKleur:{value:new THREE.Color()}},
    vertexShader:`varying vec3 vW;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader:NEVEL_GLSL+LUCHT_GLSL+WOLK_GLSL+`
      uniform float uTijd; uniform sampler2D uDiepte; uniform sampler2D uGolf; uniform vec4 uVak; uniform float uMaxDiep;
      uniform vec3 uOndiep; uniform vec3 uDiep; uniform vec3 uSchuim; uniform vec3 uZonKleur;
      varying vec3 vW;
      void main(){
        /* het raster van de diepte dekt de kaart en de zee eromheen; daarbuiten
           is het overal volle oceaan */
        vec2 k=(vW.xz-uVak.xy)/uVak.zw;
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
        float alfa=clamp(mix(.18,1.0,t)+fres*.55+schuim,0.0,1.0);
        /* diep water is ondoorzichtig: wat eronder ligt doet er dan niet meer
           toe, en de oceaan voorbij het raster sluit naadloos aan */
        alfa=max(alfa,smoothstep(3.5,5.5,diepte))*(1.0-opLand);
        gl_FragColor=vec4(kleur,alfa);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb=nevel(gl_FragColor.rgb,vW);
      }`,
    transparent:true, depthWrite:false
  });
  /* Eén watervlak tot aan de horizon. Het schuift met de camera mee (de
     golven hangen aan de wereld, niet aan het vlak, dus dat zie je niet), en
     is zo groot dat de rand ver voorbij het verste punt ligt dat de nevel nog
     doorlaat. Een aparte bodem eronder is er niet: verder dan het raster is
     het water diep, en diep water is ondoorzichtig. */
  /* Water dat niet de zee is (vijvers, grachten, plassen en het bergmeer):
     dezelfde lucht in de weerspiegeling en dezelfde golfjes, maar vlak en
     overal even diep. */
  const plasMat=new THREE.ShaderMaterial({
    uniforms:{...GEDEELD,uGolf:{value:golfTex},uOndiep:waterMat.uniforms.uOndiep,uDiep:waterMat.uniforms.uDiep,uZonKleur:waterMat.uniforms.uZonKleur},
    vertexShader:`varying vec3 vW;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader:NEVEL_GLSL+LUCHT_GLSL+WOLK_GLSL+`
      uniform float uTijd; uniform sampler2D uGolf; uniform vec3 uOndiep; uniform vec3 uDiep; uniform vec3 uZonKleur; varying vec3 vW;
      void main(){
        vec3 V=normalize(cameraPosition-vW);
        vec3 g=texture2D(uGolf,vW.xz*.5+uTijd*vec2(.01,.006)).xyz*2.0-1.0;
        vec3 n=normalize(vec3(g.x*.3,2.4,g.y*.3));
        float fres=.04+.96*pow(1.0-max(dot(n,V),0.0),5.0);
        vec3 R=reflect(-V,n); R.y=abs(R.y);
        float ws=wolkSchaduw(vW);
        vec3 licht=uZonKleur*max(uZonRicht.y,0.0)*.55*ws+uZenit*.35+uNevelKleur*.25;
        vec3 Hh=normalize(uZonRicht+V);
        vec3 kleur=mix(mix(uOndiep,uDiep,.55)*licht,luchtKleur(R),fres)+uZonKleur*pow(max(dot(n,Hh),0.0),300.0)*3.0*ws;
        gl_FragColor=vec4(kleur,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb=nevel(gl_FragColor.rgb,vW);
      }`
  });
  function maakWater(){
    water=new THREE.Mesh(new THREE.PlaneGeometry(1,1),waterMat);
    water.rotation.x=-Math.PI/2; water.scale.set(120000,120000,1);
    water.renderOrder=1; water.frustumCulled=false;
    scene.add(water);
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
    /* Het plaatje van één bol wolk: dicht in het midden, rafelig naar de
       rand, met wat fijnere klontjes erin (alfa), en een tweede laagje ruis
       voor de structuur van het licht (blauw). De belichting zelf komt in de
       shader: een bol heeft een kant naar de zon. */
    const P=128, pd=new Uint8Array(P*P*4);
    /* een bol is zelf een trosje zachte deelbollen */
    const deel=[]; for(let i=0;i<9;i++){ const a=T.hash2(i,61)*Math.PI*2, d=Math.sqrt(T.hash2(i,67))*.42; deel.push([Math.cos(a)*d,Math.sin(a)*d*.8,.28+T.hash2(i,71)*.26]); }
    for(let y=0;y<P;y++)for(let x=0;x<P;x++){
      const u=x/P*2-1+1/P, v=y/P*2-1+1/P, r=Math.hypot(u,v);
      const n=herhaal(x/P,y/P,4,4,31), f=herhaal(x/P,y/P,9,3,37);
      let leeg=1; for(const [cx,cy,cr] of deel){ const t=klem(1-Math.hypot(u-cx,v-cy)/cr,0,1); leeg*=1-t*t*(3-2*t)*.75; }
      /* naar de rand van het plaatje altijd naar nul, anders wordt het vierkant zichtbaar */
      const dicht=klem((1-leeg)*(.55+.9*n),0,1)*glad(klem((1-r)/.3,0,1));
      const q=(y*P+x)*4; pd[q]=255; pd[q+1]=255; pd[q+2]=f*255; pd[q+3]=dicht*(.8+.4*f)*255*.6;
    }
    const pufTex=new THREE.DataTexture(pd,P,P,THREE.RGBAFormat);
    pufTex.generateMipmaps=true; pufTex.minFilter=THREE.LinearMipmapLinearFilter; pufTex.magFilter=THREE.LinearFilter; pufTex.needsUpdate=true;
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
          /* elke bol een eigen draaiing van het plaatje, zodat ze niet op elkaar lijken */
          vec2 q=vUv*2.0-1.0;
          float hk=vVar*6.283, cs=cos(hk), sn=sin(hk);
          vec4 t=texture2D(uPuf,vec2(cs*q.x-sn*q.y,sn*q.x+cs*q.y)*.5+.5);
          float afst=distance(vW,cameraPosition);
          float a=t.a*uDekking*smoothstep(8.0,45.0,afst);
          if(a<.004)discard;
          /* De bol als bol belicht: de kant naar de zon licht, de andere kant
             grijzer; en van onder, waar de wolk dik is, donkerder. */
          vec3 rechts=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          vec3 op=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
          vec3 naar=normalize(cameraPosition-vW);
          vec3 n=normalize(rechts*q.x+op*q.y*.8+naar*sqrt(max(1.0-dot(q,q),.05)));
          float zon=dot(n,uZonRicht)*.5+.5;
          float licht=mix(.42,1.12,zon)*mix(.72,1.06,vHoog)*mix(.9,1.06,t.b)*(.95+.1*vVar);
          vec3 c=mix(uWolkDonker,uWolkLicht,clamp(licht,0.0,1.2));
          /* tegen de zon in: een lichte rand waar de wolk dun is */
          float tegen=pow(max(dot(-naar,uZonRicht),0.0),5.0);
          c+=uZonGloed*tegen*(1.0-smoothstep(.0,.5,t.a))*.9;
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

  /* ================================ de bosrand ================================
     Het bos zelf is een bladerdak in het land (bosVeld() in 3d-grond.js, de
     kruinen in de shader hierboven). Maar waar een bos ophoudt, zie je van
     dichtbij bomen staan: stammen en silhouetten, geen afgeronde dijk. Langs
     de rand van het bladerdak staan daarom bomen als plaatjes die naar de
     camera draaien, op de grond en even hoog als het dak; met hier en daar
     een losse boom in het veld ernaast.

     Zo'n boom wordt nooit kleiner of weggehaald omdat hij buiten een straal
     valt. Hij tekent zolang hij een paar beeldpunten groot is, en lost pas
     daarna geleidelijk op — dan is hij kleiner dan de bosrand van het land
     zelf, die gewoon blijft staan. */
  const RANDVAK=16, randVakken=new Map();
  const RANDVER=klein?70:100;        /* verder weg is een boom kleiner dan een beeldpunt */
  const RANDMAX=klein?60000:160000;
  let randBomen=null;
  const randStand={x:1e9,y:1e9,b:0};
  const randU={uPixSchaal:{value:800},uRand:{value:new THREE.Vector2(2.4,5)},uAtlas:{value:null}};
  function maakRandAtlas(){
    /* vier soorten: twee naaldbomen, twee loofbomen. Grijs, met licht van
       boven; de kleur van het bos komt er in de shader overheen */
    const B=128, cv=document.createElement("canvas"); cv.width=B*8; cv.height=B*2;
    const c=cv.getContext("2d");
    const r=(i,k)=>T.hash2(i*31+7,k*17+3);
    const stam=(x0,breed,hoog)=>{ c.fillStyle="#8a7d6c"; c.fillRect(x0-breed/2,B*2-hoog,breed,hoog); };
    const vlek=(x,y,rad,l)=>{
      const g=c.createRadialGradient(x-rad*.35,y-rad*.4,rad*.1,x,y,rad);
      g.addColorStop(0,`rgb(${Math.min(255,l+30)},${Math.min(255,l+30)},${Math.min(255,l+30)})`); g.addColorStop(1,`rgb(${l-40},${l-40},${l-40})`);
      c.fillStyle=g; c.beginPath(); c.arc(x,y,rad,0,7); c.fill();
    };
    for(let t=0;t<2;t++){            /* naaldbomen: lagen van takken, smal naar boven */
      const x0=B*t+B/2, top=t?10:22, voet=B*2-22, breed=t?44:56;
      stam(x0,7,30);
      const lagen=t?9:7;
      for(let i=0;i<lagen;i++){
        const f=i/(lagen-1), y=top+(voet-top)*f, w=breed*(.18+.82*f)*(.85+.3*r(t,i));
        const l=255-f*55;
        const g=c.createLinearGradient(x0-w,0,x0+w,0);
        g.addColorStop(0,`rgb(${l},${l},${l})`); g.addColorStop(1,`rgb(${l-45},${l-45},${l-45})`);
        c.fillStyle=g; c.beginPath();
        c.moveTo(x0,y-(voet-top)/lagen*1.6); c.lineTo(x0+w,y+6); c.lineTo(x0-w,y+6); c.closePath(); c.fill();
      }
    }
    for(let t=0;t<2;t++){            /* loofbomen: een kruin van wolkjes blad */
      const x0=B*(2+t)+B/2, cy=t?B*.95:B*.9, rx=t?44:56, ry=t?70:58;
      stam(x0,9,B*2-cy-10);
      for(let i=0;i<34;i++){
        const a=r(t+5,i)*Math.PI*2, d=Math.sqrt(r(t+9,i));
        const x=x0+Math.cos(a)*d*rx*.8, y=cy+Math.sin(a)*d*ry*.8, rad=14+r(t+3,i)*12;
        vlek(x,y,rad,215+(cy-y)/ry*30);
      }
    }
    /* en vier bomen die bij een plaats horen, in hun eigen kleur:
       een palm (Arrida, Indus), een dode kromme boom (Grimsdell, de
       Vlakte der Eenzamen), een esdoorn (de tuinen van Nihon-Ja) en een
       cipres (Toscana, Rovo) */
    { const x0=B*4+B/2;           /* palm */
      c.strokeStyle="#8A7254"; c.lineWidth=7; c.beginPath(); c.moveTo(x0+6,B*2); c.quadraticCurveTo(x0-10,B*1.2,x0+4,B*.55); c.stroke();
      for(let i=0;i<9;i++){
        const a=-Math.PI*.95+i/8*Math.PI*.9, l=48+r(40,i)*14;
        c.strokeStyle=i%2?"#6E8E3A":"#7FA046"; c.lineWidth=9;
        c.beginPath(); c.moveTo(x0+4,B*.55); c.quadraticCurveTo(x0+4+Math.cos(a)*l*.6,B*.55+Math.sin(a)*l*.6-14,x0+4+Math.cos(a)*l,B*.55+Math.sin(a)*l*.4+18); c.stroke();
      } }
    { const x0=B*5+B/2;           /* dode boom */
      c.strokeStyle="#6A5E52"; c.lineCap="round";
      const tak=(x,y,a,l,w,d)=>{ if(d>5||l<5)return; const x2=x+Math.cos(a)*l, y2=y+Math.sin(a)*l; c.lineWidth=w; c.beginPath(); c.moveTo(x,y); c.lineTo(x2,y2); c.stroke();
        tak(x2,y2,a-.45-r(d,l|0)*.3,l*.72,w*.66,d+1); tak(x2,y2,a+.4+r(l|0,d)*.3,l*.68,w*.62,d+1); };
      tak(x0,B*2,-Math.PI/2+.08,70,10,0); }
    { const x0=B*6+B/2;           /* esdoorn, rood in de tuin */
      stam(x0,8,70);
      for(let i=0;i<30;i++){ const a=r(50,i)*Math.PI*2, d=Math.sqrt(r(51,i)); const x=x0+Math.cos(a)*d*46, y=B*1.05+Math.sin(a)*d*38, rad=14+r(52,i)*10;
        const g=c.createRadialGradient(x-rad*.3,y-rad*.4,rad*.1,x,y,rad); g.addColorStop(0,"#E06A4E"); g.addColorStop(1,"#9E3A2C"); c.fillStyle=g; c.beginPath(); c.arc(x,y,rad,0,7); c.fill(); } }
    { const x0=B*7+B/2;           /* cipres: smal, hoog, donker */
      stam(x0,6,16);
      const g=c.createLinearGradient(x0-18,0,x0+18,0); g.addColorStop(0,"#5E7A4A"); g.addColorStop(1,"#2E4228");
      c.fillStyle=g; c.beginPath(); c.moveTo(x0,6); c.quadraticCurveTo(x0+26,B*.9,x0+12,B*2-14); c.lineTo(x0-12,B*2-14); c.quadraticCurveTo(x0-26,B*.9,x0,6); c.fill(); }
    const t=new THREE.CanvasTexture(cv);
    t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4;
    return t;
  }
  function maakRandBomen(){
    randU.uAtlas.value=maakRandAtlas();
    const g=new THREE.InstancedBufferGeometry();
    const vlak=new THREE.PlaneGeometry(1,1).translate(0,.5,0);
    g.index=vlak.index; g.setAttribute("position",vlak.getAttribute("position")); g.setAttribute("normal",vlak.getAttribute("normal"));
    g.setAttribute("aBoom",new THREE.InstancedBufferAttribute(new Float32Array(RANDMAX*4),4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSoort",new THREE.InstancedBufferAttribute(new Float32Array(RANDMAX*2),2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aKleur",new THREE.InstancedBufferAttribute(new Float32Array(RANDMAX*3),3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount=0;
    const m=new THREE.MeshStandardMaterial({roughness:.95,metalness:0,side:THREE.DoubleSide,alphaToCoverage:true});
    m.onBeforeCompile=sh=>{
      metNevel(sh); Object.assign(sh.uniforms,randU);
      sh.vertexShader=sh.vertexShader
        .replace("#include <common>",`#include <common>
          attribute vec4 aBoom; attribute vec2 aSoort; attribute vec3 aKleur;
          uniform float uPixSchaal; uniform vec2 uRand;
          varying vec2 vAtlas; varying vec3 vBoomKleur; varying float vZicht; varying vec3 vWolkW;`)
        .replace("#include <beginnormal_vertex>",`
          vec3 bMidden=aBoom.xyz;
          vec3 bNaar=cameraPosition-(modelMatrix*vec4(bMidden,1.0)).xyz;
          vec2 bH=normalize(bNaar.xz+vec2(1e-5,0.0));
          vec3 bRechts=vec3(bH.y,0.0,-bH.x);
          /* een bol als normaal: de kant naar de zon licht, de andere kant donker */
          vec3 objectNormal=normalize(vec3(bH.x,0.0,bH.y)*.35+bRechts*position.x*.9+vec3(0.0,.55+position.y*.6,0.0));`)
        .replace("#include <begin_vertex>",`
          float bSoort=floor(aSoort.x);
          float bBreed=aBoom.w*(bSoort<1.5?.62:bSoort>6.5?.4:.86);
          vec3 transformed=bMidden+bRechts*position.x*bBreed+vec3(0.0,position.y*aBoom.w*1.15,0.0);
          vZicht=smoothstep(uRand.x,uRand.y,aBoom.w*uPixSchaal/length(bNaar));
          if(vZicht<=0.0)transformed=bMidden;
          vAtlas=vec2((floor(aSoort.x)+position.x+.5)*.125,position.y);
          vBoomKleur=aKleur*(1.3+.4*aSoort.y);`)
        .replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nvWolkW=(modelMatrix*vec4(transformed,1.0)).xyz;");
      sh.fragmentShader=sh.fragmentShader
        .replace("#include <common>","#include <common>\nuniform sampler2D uAtlas; uniform float uGebouwLicht; varying vec2 vAtlas; varying vec3 vBoomKleur; varying float vZicht;")
        /* licht van rondom, en tegen de zon in schijnt het blad wat door: anders
           wordt een boom met de zon erachter een zwarte stip */
        .replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
          vec3 bV=-normalize(vViewPosition);   /* van de camera naar de boom */
          float bTegen=pow(max(dot(normalize((viewMatrix*vec4(uZonRicht,0.0)).xyz),bV),0.0),3.0);
          totalEmissiveRadiance+=diffuseColor.rgb*(uGebouwLicht*1.6+bTegen*.45);`)
        .replace("#include <fog_pars_fragment>","#include <fog_pars_fragment>\nvarying vec3 vWolkW;\n"+WOLK_GLSL)
        .replace("#include <map_fragment>",`
          vec4 bt=texture2D(uAtlas,vAtlas);
          diffuseColor.rgb*=bt.rgb*vBoomKleur;
          diffuseColor.a=bt.a*vZicht;
          if(diffuseColor.a<.03)discard;`)
        .replace("#include <lights_fragment_end>",`#include <lights_fragment_end>
          float ws=wolkSchaduw(vWolkW); reflectedLight.directDiffuse*=ws; reflectedLight.directSpecular*=ws;`);
    };
    randBomen=new THREE.Mesh(g,m);
    randBomen.frustumCulled=false; randBomen.receiveShadow=true;
    wereld.add(randBomen);
  }
  /* de bomen van één vak: langs de rand van het bladerdak, en een enkele
     losse boom in het veld naast een bos */
  function randBomenIn(cx,cy){
    const sl=cx+","+cy; let v=randVakken.get(sl); if(v)return v;
    const {land,bos,rivier,h}=D, kl=landKleurTex.image.data, uit=[];
    const x0=Math.max(2,Math.floor((cx*RANDVAK+MARGE)*RES)), x1=Math.min(RW-2,Math.floor(((cx+1)*RANDVAK+MARGE)*RES));
    const y0=Math.max(2,Math.floor((cy*RANDVAK+MARGE)*RES)), y1=Math.min(RH-2,Math.floor(((cy+1)*RANDVAK+MARGE)*RES));
    const buren=[-2,2,-2*RW,2*RW,-2-2*RW,2-2*RW,-2+2*RW,2+2*RW];
    const lin=c=>Math.pow(c/255,2.2);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const p=y*RW+x; if(!land[p])continue;
      const b=bos[p];
      const rand=b>10&&b<245;
      let n=0;
      if(rand)n=b<128?7:5;
      else if(b===0&&!rivier[p]&&h[p]<.3&&T.hash2(x*7+13,y*11+5)<.006&&!opPlaats(x/RES-MARGE,y/RES-MARGE)
        &&leesD(D.fBos,x/RES-MARGE,y/RES-MARGE)*.5>T.hash2(x+1,y+1))n=1;
      if(!n)continue;
      /* de kleur van het bos ernaast, niet van het veld waar de rand op staat */
      let q=p, bb=-1; for(const d of buren)if(bos[p+d]>bb){ bb=bos[p+d]; q=p+d; }
      const kr=lin(kl[q*4]), kg=lin(kl[q*4+1]), kb=lin(kl[q*4+2]);
      for(let i=0;i<n;i++){
        const wx=x/RES-MARGE+(T.hash2(x+3+i*91,y-7)-.5)*1.1/RES, wy=y/RES-MARGE+(T.hash2(x-5,y+2+i*53)-.5)*1.1/RES;
        const maat=(.026+.012*T.hash2(x-1+i*7,y+9))*(rand?1:1.1);
        const loof=leesD(D.fLoof,wx,wy)>T.hash2(x+5+i,y+1);
        uit.push(X(wx),yOp(wx,wy)-.01,Z(wy),maat,(loof?2:0)+(T.hash2(x+9,y+2+i)<.5?1:0),T.hash2(x+2+i,y+8),kr,kg,kb);
      }
    }
    /* de bomen die bij een plaats horen: palmen, cipressen, tuinbomen */
    const KLEUR={4:[.8,.8,.8],5:[.85,.85,.85],6:[.8,.8,.8],7:[.8,.8,.8]};
    for(let i=0;i<losseBomen.length;i+=4){
      const x=losseBomen[i], y=losseBomen[i+1];
      if(x<cx*RANDVAK||x>=(cx+1)*RANDVAK||y<cy*RANDVAK||y>=(cy+1)*RANDVAK)continue;
      const soort=losseBomen[i+2], maat=losseBomen[i+3]*(.2+.06*T.hash2(i,7));
      const k=KLEUR[soort]||[.12,.2,.07];
      uit.push(X(x),yOp(x,y)-.01,Z(y),maat,soort,T.hash2(i,11),k[0],k[1],k[2]);
    }
    /* de bomen bij de naamloze nederzettingen in dit vak */
    if(gPerTegel&&RANDVAK===GTEGEL){
      const lijst=gPerTegel.get(cx+","+cy)||[], gb=[];
      for(const p of lijst)gehuchtBomen(p,gebiedStijl(p[5]),opLand,T.hash2,gb);
      for(let i=0;i<gb.length;i+=4){
        const x=gb[i], y=gb[i+1], soort=gb[i+2], maat=gb[i+3]*(.2+.06*T.hash2(i,13));
        const k=KLEUR[soort]||[.12,.2,.07];
        uit.push(X(x),yOp(x,y)-.01,Z(y),maat,soort,T.hash2(i,17),k[0],k[1],k[2]);
      }
    }
    v=new Float32Array(uit);
    randVakken.set(sl,v);
    if(randVakken.size>2500){ const eerste=randVakken.keys().next().value; randVakken.delete(eerste); }
    return v;
  }
  /* ---- het fijne werk: bomen langs heggen en wegen, en losse veldbomen ----
     Alleen in de vakken dichtbij (DETAILVER): verder weg is zo'n boom kleiner
     dan een beeldpunt. De heggen liggen waar de shader ze tekent: hier staat
     hetzelfde kavelpatroon nog eens, met dezelfde husselfunctie (kHash) en
     dezelfde golving uit het korrelplaatje. */
  const DETAILVER=klein?20:30, detailVakken=new Map();
  const kHashJS=(cx,cy)=>{
    const qx=Math.imul((cx+65536)>>>0,1597334673)>>>0, qy=Math.imul((cy+65536)>>>0,3812015801)>>>0;
    const n=Math.imul((qx^qy)>>>0,1597334673)>>>0;
    return [n/4294967295,(Math.imul(n,48271)>>>0)/4294967295];
  };
  const korrelOp=(u,v)=>{   /* het korrelplaatje bilineair, herhalend */
    const d=detailTex.image.data, S=256, x=u*S-.5, y=v*S-.5, x0=Math.floor(x), y0=Math.floor(y), tx=x-x0, ty=y-y0;
    const p=(i,j)=>d[((((j%S)+S)%S)*S+(((i%S)+S)%S))*4]/255;
    return p(x0,y0)*(1-tx)*(1-ty)+p(x0+1,y0)*tx*(1-ty)+p(x0,y0+1)*(1-tx)*ty+p(x0+1,y0+1)*tx*ty;
  };
  /* hoe ver een wereldpunt (X,Z) van de rand van zijn kavel ligt */
  function kavelRand(px,pz){
    const wx=(korrelOp(px*.065,pz*.065)-.5)*.3, wz=(korrelOp(px*.065+.37,pz*.065+.61)-.5)*.3;
    const bx=(px+wx)/1.0, bz=(pz+wz)/1.0, cx=Math.floor(bx), cz=Math.floor(bz), fx=bx-cx, fz=bz-cz;
    let b1=9,b2=9;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
      const o=kHashJS(cx+i+3,cz+j+11), rx=i+.1+.8*o[0]-fx, rz=j+.1+.8*o[1]-fz, d=rx*rx+rz*rz;
      if(d<b1){ b2=b1; b1=d; } else if(d<b2)b2=d;
    }
    return (Math.sqrt(b2)-Math.sqrt(b1))*1.0*.5;
  }
  const akkerOp=(wx,wy)=>{ if(!akkerData)return 0; const i=Math.floor(wx+MARGE), j=Math.floor(wy+MARGE); return i<0||j<0||i>=R.PW||j>=R.PH?0:akkerData[(j*R.PW+i)*2+1]/255; };
  function detailIn(cx,cy){
    const sl=cx+","+cy; let v=detailVakken.get(sl); if(v)return v;
    const uit=[], {land,bos,rivier,h}=D;
    /* het groen van een boom in het veld: van zichzelf, niet van de akker eronder */
    const kleurBij=(wx,wy)=>{ const f=.82+.36*T.hash2(Math.round(wx*71),Math.round(wy*67)), g=T.hash2(Math.round(wx*13),Math.round(wy*19)); return [.15*f*(1+.25*g),.24*f,.09*f]; };
    const stijlBij=(wx,wy)=>{ const p=Math.floor((wy+MARGE)*RES)*RW+Math.floor((wx+MARGE)*RES); return gebiedStijl(D.reg[p]); };
    const vrij=(wx,wy)=>{ const p=Math.floor((wy+MARGE)*RES)*RW+Math.floor((wx+MARGE)*RES); return p>=0&&p<N&&land[p]&&!rivier[p]&&bos[p]<20&&h[p]<.3&&!opPlaats(wx,wy); };
    /* langs de kavelranden */
    const S=.035;
    for(let wy=cy*RANDVAK+S/2;wy<(cy+1)*RANDVAK;wy+=S)for(let wx=cx*RANDVAK+S/2;wx<(cx+1)*RANDVAK;wx+=S){
      const ak=akkerOp(wx,wy); if(ak<.3)continue;
      /* niet elke heg heeft bomen: in stukken van een eenheid of zo wel of niet */
      if(T.hash2(Math.floor(wx/.4)*5+1,Math.floor(wy/.4)*3+7)>.75*ak)continue;
      const hk=T.hash2(Math.round(wx*97),Math.round(wy*89));
      if(hk>.85)continue;
      const kr=kavelRand(X(wx),Z(wy)); if(kr>.0065)continue;
      if(!vrij(wx,wy))continue;
      const st=stijlBij(wx,wy); if(st==="arrida"||st==="steppen")continue;
      const k=kleurBij(wx,wy);
      uit.push(X(wx),yOp(wx,wy)-.002,Z(wy),.016+.008*T.hash2(Math.round(wx*31),Math.round(wy*37)),st==="toscana"||st==="helleno"?7:2+(hk<.05*ak?1:0),hk*5%1,k[0],k[1],k[2]);
    }
    /* langs de wegen: stukken laan, in Toscana cipressen */
    if(wegL){
      const {seg,lijst,cel}=wegL, gezien=new Set();
      for(let j=cy*RANDVAK;j<(cy+1)*RANDVAK;j++)for(let i=cx*RANDVAK;i<(cx+1)*RANDVAK;i++){
        const ci=(j+MARGE)*R.PW+i+MARGE, c=cel[ci]; if(!(c>0))continue;
        const o=Math.floor(c/32), n=c-o*32;
        for(let t=0;t<n;t++){
          const k=lijst[o+t]; if(gezien.has(k))continue; gezien.add(k);
          const a=((Math.floor(k/SEGBREED)*SEGBREED*2)+(k%SEGBREED)*2)*4;
          const x0=seg[a],y0=seg[a+1],x1=seg[a+2],y1=seg[a+3],half=seg[a+4],soort=seg[a+5];
          if(soort>0)continue;
          const mxs=(x0+x1)/2, mys=(y0+y1)/2;
          if(mxs<cx*RANDVAK||mxs>=(cx+1)*RANDVAK||mys<cy*RANDVAK||mys>=(cy+1)*RANDVAK)continue;
          const L=Math.hypot(x1-x0,y1-y0); if(L<1e-4)continue;
          const nx=-(y1-y0)/L, ny=(x1-x0)/L;
          for(let d=0;d<L;d+=.028){
            const px=x0+(x1-x0)*d/L, py=y0+(y1-y0)*d/L;
            /* een laan loopt in stukken van een paar honderd meter, aan één
               of aan beide kanten, en niet elke boom staat er nog */
            const stuk=T.hash2(Math.floor(px/.45)*7+3,Math.floor(py/.45)*11+5);
            if(stuk>.2)continue;
            if(T.hash2(Math.round(px*211),Math.round(py*223))<.22)continue;
            const st=stijlBij(px,py); if(st==="arrida"||st==="steppen")continue;
            for(const z of stuk<.08?[-1,1]:[stuk<.14?-1:1]){
              const tx=px+nx*z*(half+3.5*METER), ty=py+ny*z*(half+3.5*METER);
              if(!vrij(tx,ty))continue;
              const kk=kleurBij(tx,ty);
              uit.push(X(tx),yOp(tx,ty)-.002,Z(ty),.017+.005*T.hash2(Math.round(tx*53),Math.round(ty*59)),st==="toscana"||st==="helleno"?7:2,T.hash2(Math.round(tx*7),Math.round(ty*3)),kk[0],kk[1],kk[2]);
            }
          }
        }
      }
    }
    /* een losse boom midden in een wei */
    for(let i=0;i<60;i++){
      const wx=(cx+T.hash2(cx*13+i,cy*7))*RANDVAK, wy=(cy+T.hash2(cx*5,cy*17+i))*RANDVAK;
      if(akkerOp(wx,wy)<.25||!vrij(wx,wy))continue;
      const st=stijlBij(wx,wy); if(st==="arrida"||st==="steppen")continue;
      const k=kleurBij(wx,wy);
      uit.push(X(wx),yOp(wx,wy)-.002,Z(wy),.02+.008*T.hash2(i,cx+cy),2,T.hash2(i+3,cx-cy),k[0],k[1],k[2]);
    }
    v=new Float32Array(uit);
    detailVakken.set(sl,v);
    if(detailVakken.size>600){ const eerste=detailVakken.keys().next().value; detailVakken.delete(eerste); }
    return v;
  }
  /* ---- stenen ----
     Rotsblokken op steile hellingen, hoog in de bergen en aan de voet van een
     klif: een onregelmatige steen, duizenden keren getekend in één opdracht,
     elk met een eigen maat, draaiing en tint. Net als het fijne werk alleen
     in de vakken dichtbij. */
  const STEENMAX=klein?20000:50000, steenVakken=new Map();
  let stenen=null;
  function maakStenen(){
    const g=new THREE.IcosahedronGeometry(1,1), pa=g.getAttribute("position");
    for(let i=0;i<pa.count;i++){ const f=.78+.44*T.hash2(i*7+1,i*13+5); pa.setXYZ(i,pa.getX(i)*f,pa.getY(i)*f*.7,pa.getZ(i)*f); }
    g.computeVertexNormals();
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95,metalness:0,flatShading:true});
    m.onBeforeCompile=sh=>{ metNevel(sh); sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nuniform float uGebouwLicht;").replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*uGebouwLicht;"); };
    stenen=new THREE.InstancedMesh(g,m,STEENMAX);
    stenen.count=0; stenen.castShadow=stenen.receiveShadow=true; stenen.frustumCulled=false;
    stenen.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(STEENMAX*3),3);
    wereld.add(stenen);
  }
  function stenenIn(cx,cy){
    const sl=cx+","+cy; let v=steenVakken.get(sl); if(v)return v;
    const uit=[], {land,h,bos,rivier}=D, S=.15;
    for(let wy=cy*RANDVAK+S/2;wy<(cy+1)*RANDVAK;wy+=S)for(let wx=cx*RANDVAK+S/2;wx<(cx+1)*RANDVAK;wx+=S){
      const px=wx+(T.hash2(Math.round(wx*41),Math.round(wy*43))-.5)*S, py=wy+(T.hash2(Math.round(wx*47),Math.round(wy*53))-.5)*S;
      const fx=Math.floor((px+MARGE)*RES), fy=Math.floor((py+MARGE)*RES); if(fx<1||fy<1||fx>=RW-1||fy>=RH-1)continue;
      const p=fy*RW+fx; if(!land[p]||rivier[p]>40||bos[p]>120)continue;
      const gx=(Yvan(h[p+1])-Yvan(h[p-1]))*RES*.5, gz=(Yvan(h[p+RW])-Yvan(h[p-RW]))*RES*.5, hl=Math.hypot(gx,gz);
      /* hoe groot de kans op een steen hier is */
      const kans=klem((hl-.6)/1.4,0,1)*.7+klem((h[p]-.32)/.3,0,1)*.35+(D.kust[p]<8&&hl>.5?.4:0);
      const hk=T.hash2(Math.round(px*61),Math.round(py*67)); if(hk>kans)continue;
      const maat=(.004+.016*Math.pow(T.hash2(Math.round(px*71),Math.round(py*73)),2.2))*(1+hl*.3);
      const t=.85+.3*T.hash2(Math.round(px*79),Math.round(py*83));
      uit.push(X(px),yOp(px,py)-maat*.35,Z(py),maat,hk*97%6.283,t);
    }
    v=new Float32Array(uit);
    steenVakken.set(sl,v);
    if(steenVakken.size>600){ const eerste=steenVakken.keys().next().value; steenVakken.delete(eerste); }
    return v;
  }
  const steenM=new THREE.Matrix4(), steenQ=new THREE.Quaternion(), steenAs=new THREE.Vector3(0,1,0), steenP=new THREE.Vector3(), steenS=new THREE.Vector3(), steenK=new THREE.Color();
  function werkRandBomenBij(dwing){
    if(!randBomen)return;
    const c=camera.position, [mx,my]=naarKaart(c);
    const boven=c.y-grondY(mx,my);
    randBomen.visible=boven<RANDVER;
    if(stenen)stenen.visible=boven<DETAILVER;
    if(!randBomen.visible)return;
    if(!dwing&&Math.hypot(mx-randStand.x,my-randStand.y)<Math.min(8,2+boven*.1)&&Math.abs(boven-randStand.b)<Math.max(3,boven*.25))return;
    randStand.x=mx; randStand.y=my; randStand.b=boven;
    const r=Math.sqrt(Math.max(0,RANDVER*RANDVER-boven*boven))+RANDVAK;
    const vakken2=[];
    for(let cy=Math.floor((my-r)/RANDVAK);cy<=Math.floor((my+r)/RANDVAK);cy++)
      for(let cx=Math.floor((mx-r)/RANDVAK);cx<=Math.floor((mx+r)/RANDVAK);cx++){
        if(cx*RANDVAK>W+MARGE||cy*RANDVAK>H+MARGE||(cx+1)*RANDVAK<-MARGE||(cy+1)*RANDVAK<-MARGE)continue;
        const dx=Math.max(0,Math.abs(mx-(cx+.5)*RANDVAK)-RANDVAK/2), dy=Math.max(0,Math.abs(my-(cy+.5)*RANDVAK)-RANDVAK/2);
        const d=Math.hypot(dx,dy); if(d>r)continue;
        vakken2.push([d,cx,cy]);
      }
    vakken2.sort((a,b)=>a[0]-b[0]);
    const g=randBomen.geometry, A=g.getAttribute("aBoom").array, S=g.getAttribute("aSoort").array, K=g.getAttribute("aKleur").array;
    let n=0;
    for(const [d,cx,cy] of vakken2){
      const lagen=[randBomenIn(cx,cy)];
      if(Math.hypot(d,boven)<DETAILVER)lagen.push(detailIn(cx,cy));
      for(const v of lagen)for(let i=0;i<v.length&&n<RANDMAX;i+=9,n++){
        A[n*4]=v[i]; A[n*4+1]=v[i+1]; A[n*4+2]=v[i+2]; A[n*4+3]=v[i+3];
        S[n*2]=v[i+4]; S[n*2+1]=v[i+5];
        K[n*3]=v[i+6]; K[n*3+1]=v[i+7]; K[n*3+2]=v[i+8];
      }
      if(n>=RANDMAX)break;
    }
    g.instanceCount=n;
    for(const k of ["aBoom","aSoort","aKleur"]){ const at=g.getAttribute(k); at.needsUpdate=true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0,n*at.itemSize); }
    /* de stenen in de vakken dichtbij */
    if(stenen){
      steenK.set(wcss("--rots")||"#9C9782");
      let ns=0;
      for(const [d,cx,cy] of vakken2){
        if(Math.hypot(d,boven)>=DETAILVER)continue;
        const v=stenenIn(cx,cy);
        for(let i=0;i<v.length&&ns<STEENMAX;i+=6,ns++){
          steenM.compose(steenP.set(v[i],v[i+1],v[i+2]),steenQ.setFromAxisAngle(steenAs,v[i+4]),steenS.set(v[i+3],v[i+3],v[i+3]));
          stenen.setMatrixAt(ns,steenM);
          stenen.instanceColor.setXYZ(ns,steenK.r*v[i+5],steenK.g*v[i+5],steenK.b*v[i+5]);
        }
        if(ns>=STEENMAX)break;
      }
      stenen.count=ns; stenen.instanceMatrix.needsUpdate=true; stenen.instanceColor.needsUpdate=true;
    }
  }
  const gebouwPlekken=[];        /* [x,y,straal]: de plek van elk gebouwd ding */
  /* staat hier al een plaats van de kaart (een kasteel, een stad)? Dan
     geen boom: die zou op het binnenplein of midden in een straat staan */
  let plaatsVak=null;
  function opPlaats(wx,wy){
    if(!plaatsVak){ plaatsVak=new Map(); for(const g of gebouwPlekken){ const k=Math.floor(g[0]/8)+","+Math.floor(g[1]/8); if(!plaatsVak.has(k))plaatsVak.set(k,[]); plaatsVak.get(k).push(g); } }
    const i=Math.floor(wx/8), j=Math.floor(wy/8);
    for(let b=j-1;b<=j+1;b++)for(let a=i-1;a<=i+1;a++){ const l=plaatsVak.get(a+","+b); if(l)for(const g of l)if(Math.hypot(g[0]-wx,g[1]-wy)<g[2]*1.05)return true; }
    return false;
  }

  /* ================================ gebouwen ================================
   Wat er gebouwd staat komt uit 3d-modellen.js: per plaats een eigen model
   (of een standaard naar soort en bouwstijl), alles samengevoegd tot een
   paar vormen met de kleur in de hoekpunten. Zo kost een hele wereld vol
   kastelen, steden en schepen maar een handvol tekenopdrachten. */
  const modelVoor=p=>modelInfo(p);
  let gebouwen=null, lichtjes=null, losseBomen=[], wegenVanPlaatsen=[], gebouwMat=null, doekMat=null, wiekMat=null;
  const plekBoven={};            /* plaats-id → hoogte van de top (voor het naambordje) */
  const rivierOp=(wx,wy)=>{
    const x=Math.floor((wx+MARGE)*RES), y=Math.floor((wy+MARGE)*RES);
    return x>=0&&y>=0&&x<RW&&y<RH?D.rivier[y*RW+x]:0;
  };
  function maakGebouwen(){
    const m=bouwModellen({PLAATSEN:ctx.PLAATSEN,POS:D.POS,X,Z,yOp,hNorm,opLand,hash2:T.hash2,rivierOp,kloven:D.kloven});
    Object.assign(plekBoven,m.boven);
    gebouwPlekken.push(...m.plekken);
    losseBomen=m.bomen;
    wegenVanPlaatsen=m.wegen;
    const g=new THREE.Group();
    /* Een gebouw is klein en heeft geen eigen hemel om zich heen: de
       schaduwkant zou zwart worden. Een vleugje eigen licht (uGebouwLicht,
       per thema) houdt muren en daken leesbaar. Het materiaal van elk vlak —
       steen, vakwerk, riet, pannen, de ramen en 's nachts het licht erachter
       — tekent de shader uit 3d-modellen.js. */
    const gebouwShader=sh=>{
      metNevel(sh);
      sh.vertexShader=sh.vertexShader
        .replace("#include <common>","#include <common>\n"+GEBOUW_GLSL_V)
        .replace("#include <project_vertex>","#include <project_vertex>\n"+GEBOUW_GLSL_V_MAIN);
      sh.fragmentShader=sh.fragmentShader
        .replace("#include <common>","#include <common>\nuniform float uGebouwLicht;\n"+GEBOUW_GLSL_F)
        .replace("#include <color_fragment>","#include <color_fragment>\n"+GEBOUW_GLSL_KLEUR)
        .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*uGebouwLicht;"+GEBOUW_GLSL_GLOED);
    };
    const mat=gebouwMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0});
    mat.onBeforeCompile=gebouwShader;
    const md=doekMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});
    md.onBeforeCompile=gebouwShader;
    /* de wieken van de molens draaien om hun as: aDobber = [naaf x, naaf z,
       naaf y, richting van de as] */
    wiekMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});
    wiekMat.onBeforeCompile=sh=>{
      gebouwShader(sh);
      const draai=`vec3 wAs=vec3(cos(aDobber.w),0.0,sin(aDobber.w));
        float wHoek=uTijd*.9+aDobber.x*3.1+aDobber.y*1.7, wC=cos(wHoek), wS=sin(wHoek);`;
      const rod=v=>`(${v}*wC+cross(wAs,${v})*wS+wAs*dot(wAs,${v})*(1.0-wC))`;
      sh.vertexShader=sh.vertexShader
        .replace("#include <common>","#include <common>\nattribute vec4 aDobber; uniform float uTijd;")
        .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\n"+draai+"\nobjectNormal="+rod("objectNormal")+";")
        .replace("#include <begin_vertex>",`#include <begin_vertex>
          vec3 wNaaf=vec3(aDobber.x,aDobber.z,aDobber.y), wP=transformed-wNaaf;
          transformed=wNaaf+${rod("wP")};`);
    };
    /* in blokken: wat buiten beeld valt wordt niet getekend, en wat zo ver
       weg ligt dat het kleiner is dan een paar beeldpunten ook niet (zie
       werkGebouwBlokkenBij) */
    for(const [geo,mt] of [[m.vast,mat],[m.doek,md]]){
      if(!geo)continue;
      for(const deel of deelOp(geo,GBLOK)){ const x=new THREE.Mesh(deel,mt); x.castShadow=x.receiveShadow=true; g.add(x); gebouwBlokken.push(x); }
      geo.dispose();
    }
    /* de schepen deinen: elk om zijn eigen middelpunt, met zijn eigen fase */
    if(m.schepen){
      const ms=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,side:THREE.DoubleSide});
      ms.onBeforeCompile=sh=>{
        gebouwShader(sh);
        sh.vertexShader=sh.vertexShader
          .replace("#include <common>","#include <common>\nattribute vec4 aDobber; uniform float uTijd;")
          .replace("#include <begin_vertex>",`#include <begin_vertex>
            float df=aDobber.z+uTijd, dz=sin(df)*.05, dx=sin(df*.8)*.03;
            vec3 dp=vec3(aDobber.x,0.0,aDobber.y), dq=transformed-dp;
            dq=vec3(dq.x*cos(dz)-dq.y*sin(dz),dq.x*sin(dz)+dq.y*cos(dz),dq.z);
            dq=vec3(dq.x,dq.y*cos(dx)-dq.z*sin(dx),dq.y*sin(dx)+dq.z*cos(dx));
            transformed=dp+dq; transformed.y+=sin(df*1.3)*.002;`);
      };
      const x=new THREE.Mesh(m.schepen,ms); x.castShadow=true; x.receiveShadow=true; g.add(x);
    }
    /* vijvers, grachten en plassen: water dat de lucht weerspiegelt */
    if(m.plas){ const x=new THREE.Mesh(m.plas,plasMat); g.add(x); }
    /* de bergmeren: een waterspiegel op de hoogte van de laagste oever (de
       kom zelf is in 3d-grond.js uitgesleten) */
    for(const mr of D.meren||[]){
      const x=new THREE.Mesh(new THREE.CircleGeometry(mr.r,48).rotateX(-Math.PI/2),plasMat);
      x.position.set(X(mr.x),mr.niveau,Z(mr.y)); g.add(x);
    }
    wereld.add(g); gebouwen=g;
    /* 's nachts: licht achter de ramen */
    const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.BufferAttribute(m.lampjes,3));
    const gloed=document.createElement("canvas"); gloed.width=gloed.height=64;
    { const c=gloed.getContext("2d"), gr=c.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,"rgba(255,214,150,1)"); gr.addColorStop(.18,"rgba(255,170,80,.6)"); gr.addColorStop(1,"rgba(255,140,60,0)");
      c.fillStyle=gr; c.fillRect(0,0,64,64); }
    const lm=new THREE.PointsMaterial({size:.07,map:new THREE.CanvasTexture(gloed),color:0xFFC27A,transparent:true,
      depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true,fog:false});
    lichtjes=new THREE.Points(lg,lm); lichtjes.renderOrder=4;
    wereld.add(lichtjes);
  }

  /* ================================ de nederzettingen ================================
     De naamloze boerderijen, gehuchten en dorpen (nederzettingen() in
     3d-grond.js) zijn met duizenden; ze worden pas gebouwd als de camera in
     de buurt komt, per tegel van GTEGEL eenheden, de dichtstbijzijnde eerst
     en hooguit één per beeldje. Verder weg zijn ze een vlekje daken tussen
     hun akkers (zie bouwKleur), en een tegel die ver achter de camera ligt
     wordt weer opgeruimd. */
  const GTEGEL=16, GBOUW=klein?10:15, GWEG=GBOUW+12;
  const gTegels=new Map(); let gPerTegel=null;
  const gebiedStijl=r=>stijlVan(D.ids[r-1]||"");
  function verdeelGehuchten(){
    gPerTegel=new Map(); const P=D.plekken;
    for(let i=0;i<P.length;i+=6){
      const k=Math.floor(P[i]/GTEGEL)+","+Math.floor(P[i+1]/GTEGEL);
      let l=gPerTegel.get(k); if(!l)gPerTegel.set(k,l=[]);
      l.push([P[i],P[i+1],P[i+2],P[i+3],P[i+4],P[i+5]]);
    }
  }
  function werkGehuchtenBij(){
    if(!gPerTegel||!gebouwMat)return;
    const c=camera.position, [mx,my]=naarKaart(c), boven=Math.max(0,c.y-grondY(mx,my));
    const afst=(tx,ty)=>{ const dx=Math.max(0,Math.abs(mx-(tx+.5)*GTEGEL)-GTEGEL/2), dy=Math.max(0,Math.abs(my-(ty+.5)*GTEGEL)-GTEGEL/2); return Math.hypot(dx,dy,boven); };
    for(const [k,t] of gTegels)if(afst(t.tx,t.ty)>GWEG){ wereld.remove(t.g); t.g.traverse(o=>{ if(o.geometry)o.geometry.dispose(); }); gTegels.delete(k); }
    if(boven>GBOUW)return;
    const r=Math.ceil(Math.sqrt(GBOUW*GBOUW-boven*boven)/GTEGEL)+1;
    let best=null, bd=GBOUW;
    for(let ty=Math.floor(my/GTEGEL)-r;ty<=Math.floor(my/GTEGEL)+r;ty++)for(let tx=Math.floor(mx/GTEGEL)-r;tx<=Math.floor(mx/GTEGEL)+r;tx++){
      const k=tx+","+ty; if(gTegels.has(k)||!gPerTegel.has(k))continue;
      const d=afst(tx,ty); if(d<bd){ bd=d; best=[k,tx,ty]; }
    }
    if(!best)return;
    const [k,tx,ty]=best;
    const m=bouwGehuchten({X,Z,yOp,hNorm,opLand,hash2:T.hash2,rivierOp},gPerTegel.get(k),gebiedStijl);
    const g=new THREE.Group();
    if(m.vast){ const x=new THREE.Mesh(m.vast,gebouwMat); x.castShadow=x.receiveShadow=true; g.add(x); }
    if(m.doek){ const x=new THREE.Mesh(m.doek,doekMat); x.castShadow=x.receiveShadow=true; g.add(x); }
    if(m.wiek){ const x=new THREE.Mesh(m.wiek,wiekMat); x.castShadow=true; x.frustumCulled=false; g.add(x); }
    wereld.add(g); gTegels.set(k,{g,tx,ty});
  }
  function ruimGehuchten(){
    for(const t of gTegels.values()){ wereld.remove(t.g); t.g.traverse(o=>{ if(o.geometry)o.geometry.dispose(); }); }
    gTegels.clear(); gPerTegel=null;
  }

  /* ================================ wegen ================================
     De wegen tussen de plaatsen en de nederzettingen (uit 3d-grond.js) en de
     straten van de plaatsen zelf (uit 3d-modellen.js), als drie kleine
     texturen voor de shader van het land: de lijnstukken, per cel de lijst
     van lijnstukken, en waar die lijst begint. */
  function maakWegen(){
    const alle=D.wegen.map(w=>({pts:w.p,breed:w.b,soort:w.s})).concat(wegenVanPlaatsen);
    const L=wegL=wegLijnen(R,alle);
    const tex=(data,b,h,fmt)=>{ const t=new THREE.DataTexture(data,b,h,fmt,THREE.FloatType); t.minFilter=t.magFilter=THREE.NearestFilter; t.generateMipmaps=false; t.needsUpdate=true; return t; };
    wegU.uWegSeg.value=tex(L.seg,SEGBREED*2,L.segRijen,THREE.RGBAFormat);
    wegU.uWegLijst.value=tex(L.lijst,LIJSTBREED,L.lijstRijen,THREE.RedFormat);
    wegU.uWegCel.value=tex(L.cel,R.PW,R.PH,THREE.RedFormat);
  }

  /* een samengevoegde vorm opdelen in blokken van maat×maat (naar het
     midden van elke driehoek), elk met zijn eigen omtrek voor het wegsnoeien */
  const GBLOK=80, GZICHT=klein?160:240, gebouwBlokken=[];
  function deelOp(geo,maat){
    const pos=geo.getAttribute("position").array, namen=Object.keys(geo.attributes), bak=new Map();
    for(let t=0;t<pos.length/9;t++){
      const cx=(pos[t*9]+pos[t*9+3]+pos[t*9+6])/3, cz=(pos[t*9+2]+pos[t*9+5]+pos[t*9+8])/3;
      const k=Math.floor(cx/maat)+","+Math.floor(cz/maat);
      let l=bak.get(k); if(!l)bak.set(k,l=[]); l.push(t);
    }
    const uit=[];
    for(const l of bak.values()){
      const g=new THREE.BufferGeometry();
      for(const n of namen){
        const a=geo.getAttribute(n), w=a.itemSize, src=a.array, dst=new Float32Array(l.length*3*w);
        l.forEach((t,i)=>dst.set(src.subarray(t*3*w,(t+1)*3*w),i*3*w));
        g.setAttribute(n,new THREE.BufferAttribute(dst,w));
      }
      g.computeBoundingSphere(); uit.push(g);
    }
    return uit;
  }
  const bolW=new THREE.Vector3();
  function werkGebouwBlokkenBij(){
    const c=camera.position;
    for(const x of gebouwBlokken){
      const b=x.geometry.boundingSphere; bolW.copy(b.center); bolW.y*=wereld.scale.y;
      x.visible=c.distanceTo(bolW)-b.radius<GZICHT;
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
        if(yDak(px+W/2,pz+H/2)*sy>py+.05){ weg=true; break; }
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
    for(const [x,y] of punten)p.push(X(x),Math.max(yDak(x,y),0)+(opts.boven??.12),Z(y));
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
  let landKleurTex=null, landNormTex=null, loofTex=null, wolkDek=.9, wolkSch=.4;
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
    GEDEELD.uGebouwLicht.value=isDonker()?.04:.13;
    GEDEELD.uNacht.value=isDonker()?1:0;
    rotsKleur.value.set(wcss("--rots")||"#9C9782");
    wegKleur.value.set(th.weg);
    th.akkers.forEach((k,i)=>akkU.value[i].set(k)); hegKleur.value.set(th.heg);
    if(D)tekenRoutes();
  }

  /* ================================ opbouw ================================ */
  let gebouwd=false;
  /* Valt de rekenploeg halverwege om, dan is wat hij onder handen had weg;
     dan nog één keer, nu op de hoofddraad (de ploeg staat dan op kapot). */
  const opnieuwBijFout=async f=>{ try{ return await f(); }catch(e){ if(e&&e.opnieuw)return await f(); throw e; } };
  async function bouwAlles(){
    await opnieuwBijFout(bouwGegevens);
    await ctx.adem();
    const kleur=await opnieuwBijFout(bouwKleur);
    await ctx.adem();
    landKleurTex=new THREE.DataTexture(kleur,RW,RH,THREE.RGBAFormat);
    landKleurTex.colorSpace=THREE.SRGBColorSpace;
    landKleurTex.generateMipmaps=true; landKleurTex.minFilter=THREE.LinearMipmapLinearFilter;
    landKleurTex.magFilter=THREE.LinearFilter; landKleurTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    landKleurTex.needsUpdate=true;
    landNormTex=new THREE.DataTexture(D.normalen,RW,RH,THREE.RGBAFormat);
    landNormTex.generateMipmaps=true; landNormTex.minFilter=THREE.LinearMipmapLinearFilter;
    landNormTex.magFilter=THREE.LinearFilter; landNormTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    landNormTex.needsUpdate=true;
    await ctx.adem();
    /* Op het grove rooster: hoeveel loof (en hoeveel naald) het bos heeft (R),
       en hoeveel van het land akkerland is (G), niet op het strand */
    { const MM=R.PW*R.PH, l=new Uint8Array(MM*2), ak=new Float32Array(MM), A=D.SOORTEN.indexOf("akker");
      for(let i=0;i<MM;i++){
        if(!D.pReg[i])continue;
        const x=i%R.PW, y=(i/R.PW)|0, fp=Math.min(RH-1,Math.floor((y+.5)*RES))*RW+Math.min(RW-1,Math.floor((x+.5)*RES));
        ak[i]=((D.mixA[i]===A?1-D.mixF[i]:0)+(D.mixB[i]===A?D.mixF[i]:0))*klem((D.kust[fp]/18-1.2)/1.2,0,1)*(1-glad(klem((D.h[fp]-.12)/.12,0,1)));
      }
      for(const [cx,cy,Ra] of akkerPlekken()){
        for(let y=Math.floor(cy-Ra);y<=Math.ceil(cy+Ra);y++)for(let x=Math.floor(cx-Ra);x<=Math.ceil(cx+Ra);x++){
          const i=(y+MARGE)*R.PW+x+MARGE; if(i<0||i>=MM||!D.pReg[i])continue;
          const fp=Math.min(RH-1,Math.floor((y+MARGE+.5)*RES))*RW+Math.min(RW-1,Math.floor((x+MARGE+.5)*RES));
          if(D.h[fp]>.3)continue;
          const t=1-glad(klem(Math.hypot(x+.5-cx,y+.5-cy)/Ra,0,1));
          ak[i]=Math.max(ak[i],t*klem((D.kust[fp]/18-.6)/1,0,1));
        }
      }
      T.veeg(ak,R.PW,R.PH,2);
      for(let i=0;i<MM;i++){ l[i*2]=klem(D.fLoof[i],0,1)*255; l[i*2+1]=klem(ak[i],0,1)*255; }
      akkerData=l;
      loofTex=new THREE.DataTexture(l,R.PW,R.PH,THREE.RGFormat);
      loofTex.minFilter=loofTex.magFilter=THREE.LinearFilter; loofTex.needsUpdate=true; }
    landMat=maakLandMat(landKleurTex,landNormTex,loofTex);
    maakVakken();
    diepteTex=bouwDiepte();
    waterMat.uniforms.uDiepte.value=diepteTex;
    if(!water)maakWater();
    if(!wolken)maakWolken();
    await ctx.adem();
    maakGebouwen();
    maakWegen();
    verdeelGehuchten();
    if(!randBomen)maakRandBomen();
    if(!stenen)maakStenen();
    randVakken.clear(); detailVakken.clear(); steenVakken.clear(); randStand.x=1e9;
    maakNamen();
    zetThema();
    gebouwd=true;
  }
  function ruimOp(){
    for(const v of vakken){ for(const g of v.geo)if(g)g.dispose(); wereld.remove(v.mesh); }
    vakken=[]; for(const k in indexen)delete indexen[k];
    if(landMat)landMat.dispose(); for(const k in wegU){ if(wegU[k].value)wegU[k].value.dispose(); wegU[k].value=null; } if(landKleurTex)landKleurTex.dispose(); if(landNormTex)landNormTex.dispose(); if(loofTex)loofTex.dispose(); if(diepteTex)diepteTex.dispose();
    if(gebouwen){ wereld.remove(gebouwen); gebouwen.traverse(o=>{ if(o.geometry)o.geometry.dispose(); }); gebouwen=null; }
    gebouwBlokken.length=0;
    if(lichtjes){ wereld.remove(lichtjes); lichtjes.geometry.dispose(); lichtjes=null; }
    gebouwPlekken.length=0; plaatsVak=null;
    ruimGehuchten();
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
    const r0=sph.radius, p0=sph.phi, a0=sph.theta;
    const [p1,a1]=vrijZicht(naar,afst,polar??p0,a0);
    /* Op een smal scherm schuift het paneel van onderen over het beeld: dan
       het doel naar het vrije stuk erboven. Een stap over de grond naar de
       camera toe is op het scherm een stap omlaag, korter naarmate de blik
       schuiner over het land gaat. */
    const ph=ctx.paneelHoogte?ctx.paneelHoogte():0;
    if(ph){
      const perEenheid=houder.clientHeight/(2*afst*Math.tan(FOV*Math.PI/360));
      const d=ph/2/perEenheid/Math.max(.35,Math.cos(p1));
      naar.x+=Math.sin(a1)*d; naar.z+=Math.cos(a1)*d;
    }
    const afstand=van.distanceTo(naar);
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
      if(c.y<grondY(cx,cy)+Math.max(.15,afst*.1))return false;
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
    const t=klem((Math.log(d)-Math.log(1.5))/(Math.log(700)-Math.log(1.5)),0,1);
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
    const min=grondY(cx,cy)+.05;
    if(camera.position.y<min)camera.position.y=min;
    /* het dichtbije vlak meeschuiven met de hoogte: vlakbij scherp, en in de
       verte geen gevecht tussen water en zeebodem */
    const boven=camera.position.y-grondY(cx,cy);
    const near=klem(boven*.06,.004,8);
    if(Math.abs(near-camera.near)/camera.near>.2){ camera.near=near; camera.updateProjectionMatrix(); }
  }
  /* de schaduw van de zon: een vak rond waar je kijkt, groter naarmate je verder weg bent */
  function werkSchaduwBij(){
    const t=controls.target, d=camera.position.distanceTo(t);
    const vak=klem(d*1.1,2.5,800);
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
      if(py<=Math.max(0,yDak(wx,wy)*sy)){
        if(!opLand(wx,wy)){ ctx.kies(null); return; }
        const fp=Math.floor((wy+MARGE)*RES)*RW+Math.floor((wx+MARGE)*RES);
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
    if(water){ water.position.x=camera.position.x; water.position.z=camera.position.z; }
    werkVakkenBij();
    werkRandBomenBij(false);
    werkGehuchtenBij();
    if(beeldNr%10===0)werkGebouwBlokkenBij();
    werkSchaduwBij();
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
    randU.uPixSchaal.value=h*renderer.getPixelRatio()/(2*Math.tan(FOV*Math.PI/360));
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
        /* een plaats op ware schaal is klein: dichterbij dan een landschap */
        const afst=p&&/^(natuur|landschap|rivier)$/.test(p.soort)?Math.max(20,(p.straal||8)*2.8):1.8;
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
    /* het thema van de pagina is gewisseld: de wereld blijft wat hij is
       (dag of nacht), alleen de lijnen en de keuze krijgen de nieuwe kleuren */
    async thema(){
      if(!gebouwd)return;
      zetThema(); tekenKeuze(gekozen);
    },
    /* dag of nacht: de kleuren van het land zijn erin gebakken, dus die opnieuw */
    async wisselTijd(){
      nachtModus=!nachtModus;
      try{ localStorage.setItem("gj-tijd",nachtModus?"nacht":"dag"); }catch(e){}
      if(!gebouwd)return nachtModus;
      ctx.laad.aan(); await ctx.adem();
      try{
        const k=await opnieuwBijFout(bouwKleur);
        landKleurTex.image.data.set(k); landKleurTex.needsUpdate=true;
        randVakken.clear(); detailVakken.clear(); werkRandBomenBij(true);
        zetThema();
      }finally{ ctx.laad.weg(); }
      return nachtModus;
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
