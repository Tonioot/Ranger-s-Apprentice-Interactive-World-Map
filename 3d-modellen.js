/* ==========================================================================
   3d-modellen.js — wat er gebouwd staat: kastelen, steden, havens, ruïnes

   Elke plaats op de kaart krijgt hier een eigen model, zo goed als de boeken
   het beschrijven: Redmont van rode steen boven Wensley, Kasteel Araluen met
   slanke witte torens en tuinen, Hallasholm met zijn houten Grote Zaal en een
   strand vol wolfschepen, de zwarte burcht Montsombre met de kooien langs de
   weg, de woestijnsteden van Arrida, de burchten van Nihon-Ja. Wat niet
   speciaal beschreven staat, krijgt een model naar zijn soort (kasteel, stad,
   haven, ruïne, slagveld) in de bouwstijl van zijn land.

   Opbouw
     BOUWERS     plaats-id → een functie die de plaats bouwt. Bovenaan elke
                 bouwer staat wat de boeken (en data.json) erover zeggen.
     SOORTEN     de standaard per soort, voor alles wat geen eigen bouwer heeft.
     STIJLEN     per land: muren, daken, de vorm van een huis, het soort kasteel
                 en het soort schip.
     de bouwdoos de onderdelen waarmee alles gebouwd wordt: blok, toren, muur
                 met kantelen, zadeldak, pagodedak, koepel, schip, vlag…

   Alles komt in een paar grote vormen terecht (stevig, doek, schepen, water)
   met de kleur in de hoekpunten — een hele wereld vol gebouwen kost zo maar
   een handvol tekenopdrachten. De maten zijn klein gehouden: een kasteel is
   nog geen kaarteenheid breed, een huis een tiende daarvan. Zo blijft de
   wereld groot.

   Coördinaten: elke bouwer werkt in een eigen vlak rond zijn plaats, (u,v) in
   kaarteenheden, gedraaid zoals de plaats het wil; b.w(u,v) geeft de plek op
   de kaart. Hoogtes zijn absolute wereldhoogtes (y), zoals yOp() ze geeft.
   ========================================================================== */
import * as THREE from "three";

const klem=(v,a,b)=>v<a?a:v>b?b:v;

/* ======================= de bouwdoos: vormen =======================
   Eenheidsvormen, met de voet op y=0 en het midden op x=z=0. Zonder index,
   zodat ze los aan elkaar geregen kunnen worden. */
function sjabloon(g){
  g=g.index?g.toNonIndexed():g;
  if(g.getAttribute("uv"))g.deleteAttribute("uv");
  g.computeVertexNormals();
  return {p:g.getAttribute("position").array,n:g.getAttribute("normal").array};
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
  V.blok=sjabloon(new THREE.BoxGeometry(1,1,1).translate(0,.5,0));
  V.cil=sjabloon(new THREE.CylinderGeometry(1,1,1,10).translate(0,.5,0));
  V.cil6=sjabloon(new THREE.CylinderGeometry(1,1,1,6).translate(0,.5,0));
  V.kegel=sjabloon(new THREE.ConeGeometry(1,1,10).translate(0,.5,0));
  V.kegel6=sjabloon(new THREE.ConeGeometry(1,1,6).translate(0,.5,0));
  V.pir=sjabloon(new THREE.ConeGeometry(Math.SQRT1_2,1,4).rotateY(Math.PI/4).translate(0,.5,0));
  /* zadeldak: nok langs x op hoogte 1, goten op z=±.5 */
  V.zadel=sjabloon(veelvlak([[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5],[-.5,1,0],[.5,1,0]],
    [[0,1,5,4],[3,2,5,4],[0,3,4],[1,2,5],[0,1,2,3]]));
  /* schilddak: nok half zo lang als het huis */
  V.schild=sjabloon(loft([[.5,.5,0],[.25,.001,1]]));
  /* pagodedak: breed uitlopend, met opkrullende hoeken */
  V.pagode=sjabloon(loft([[.5,.5,0,.09],[.36,.36,.28,.02],[.22,.22,.62],[.12,.005,1]]));
  V.koepel=sjabloon(new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2));
  V.ui=sjabloon(draai([[0,0],[.78,.08],[1,.32],[.82,.6],[.4,.82],[.1,.95],[.02,1]],12));
  V.bol=sjabloon(new THREE.IcosahedronGeometry(1,1));
  V.vlak=sjabloon(new THREE.PlaneGeometry(1,1).translate(.5,.5,0));        /* een vlag: van de paal af */
  V.doek=sjabloon(new THREE.PlaneGeometry(1,1).translate(0,.5,0));         /* een zeil: om de mast heen */
  V.driehoek=sjabloon((()=>{ const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3)); return g; })());
  V.schijf=sjabloon(new THREE.CircleGeometry(1,14).rotateX(-Math.PI/2));
  return V;
}

/* ---- de verzamelbak: alles van één soort materiaal achter elkaar ---- */
class Bak{
  constructor(dobber){ this.p=[]; this.n=[]; this.c=[]; this.d=dobber?[]:null; }
  voeg(s,m,nm,kleur,dob){
    const P=s.p, Nn=s.n, e=m.elements, f=nm.elements;
    for(let i=0;i<P.length;i+=3){
      const x=P[i], y=P[i+1], z=P[i+2];
      this.p.push(e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]);
      const a=Nn[i], b=Nn[i+1], c=Nn[i+2];
      let nx=f[0]*a+f[3]*b+f[6]*c, ny=f[1]*a+f[4]*b+f[7]*c, nz=f[2]*a+f[5]*b+f[8]*c;
      const l=Math.hypot(nx,ny,nz)||1; this.n.push(nx/l,ny/l,nz/l);
      this.c.push(kleur.r,kleur.g,kleur.b);
      if(this.d)this.d.push(dob[0],dob[1],dob[2],dob[3]);
    }
  }
  geo(){
    if(!this.p.length)return null;
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute("normal",new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute("color",new THREE.Float32BufferAttribute(this.c,3));
    if(this.d)g.setAttribute("aDobber",new THREE.Float32BufferAttribute(this.d,4));
    g.computeBoundingSphere();
    return g;
  }
}

/* ======================= bouwstijlen per land =======================
   muur/dak: kleuren van gewone huizen; steen: kastelen en stadsmuren;
   torendak: de spitsen; huis: de vorm van een huis; kasteel: het soort
   burcht; schip: wat er in de haven ligt; kantelen: de vorm op de muur. */
const STIJLEN={
  /* Araluen: Engels platteland — witgekalkte muren met vakwerk, riet en
     rode pannen; kastelen van grijze steen met leien spitsen */
  araluen:{muur:["#EDE5D0","#E5DABF","#DCCEAE","#F0EADA"],dak:["#B39A5C","#A88E52","#9C4834","#8A3F2C","#9A8450"],balk:"#5B4532",
    steen:["#B9B3A3","#AEA898","#C4BEAF"],torendak:["#3F5167","#46586E","#4A5A6E"],huis:"zadel",kasteel:"araluen",schip:"kogge",kantelen:"blok",vlag:"#2F5D3A"},
  /* Hibernia: lage witte stenen huisjes met riet, ronde torens */
  hibernia:{muur:["#F1EEE6","#E8E4DA","#DDD8CC"],dak:["#A99258","#9E8A55","#8D7A4C"],balk:"#4E4A44",
    steen:["#A6A49C","#9A988F","#B3B0A6"],torendak:["#55606A","#4C565F"],huis:"zadel",kasteel:"hibernia",schip:"kogge",kantelen:"blok",vlag:"#3E6B3A"},
  /* Picta: ruw grijs steen, lage huizen met plaggendaken */
  picta:{muur:["#8F8C84","#9A968C","#85827A"],dak:["#6E7246","#7A7A4E","#5E6640"],balk:"#4A4238",
    steen:["#8A877F","#7E7B73"],torendak:["#5A5A52"],huis:"plag",kasteel:"broch",schip:"kogge",kantelen:"blok",vlag:"#2D3E6B"},
  /* Skandia: donker hout, lange huizen met plaggen of houten schindels */
  skandia:{muur:["#86684A","#7A5E42","#917252","#80634A"],dak:["#6E7A48","#62703F","#6A5440","#5E4A38"],balk:"#3E2E20",
    steen:["#8C8478","#7D766B"],torendak:["#3E3226"],huis:"lang",kasteel:"skandia",schip:"wolf",kantelen:null,vlag:"#8E2B2B"},
  /* Teutlandt: vakwerk met steile rode daken */
  teutlandt:{muur:["#EFE6D2","#E8DDC4","#F2ECDF"],dak:["#8E3A2A","#7E3326","#9A4430"],balk:"#4A3426",
    steen:["#A9A193","#9C9486"],torendak:["#7E3326","#3E4A5A"],huis:"steil",kasteel:"teutlandt",schip:"kogge",kantelen:"blok",vlag:"#C9A94A"},
  /* Gallica: kalksteen, leien daken, kastelen met puntige ronde torens */
  gallica:{muur:["#E9E1CF","#E1D7C1","#EDE6D7","#D9CEB6"],dak:["#56606C","#4D5662","#5E6874","#8A4A36"],balk:"#5A4A3A",
    steen:["#D8CFBC","#CEC4AE","#E2DACA"],torendak:["#4A5460","#424C58"],huis:"steil",kasteel:"gallica",schip:"kogge",kantelen:"blok",vlag:"#2B4C7E"},
  /* Iberion: witte muren, rode pannen, laag */
  iberion:{muur:["#F2EFE6","#EDE7D8","#E6DCC4"],dak:["#B5603A","#A85532","#C06C42"],balk:"#5A4632",
    steen:["#D9CDB0","#CFC2A3"],torendak:["#A85532"],huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"blok",vlag:"#B8862E"},
  /* Toscana: oker en terracotta, lage pannendaken, torens met zwaluwstaarten */
  toscana:{muur:["#E3C08A","#D9A86C","#EBD3A6","#D7B27C","#E8DCC0"],dak:["#B5562F","#A84E2B","#C0643A","#9E4A2A"],balk:"#5A4030",
    steen:["#D8C9A8","#CDBB96","#E0D3B6"],torendak:["#B5562F"],huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"zwaluw",vlag:"#8E2B2B"},
  /* Helleno: wit, met zuilen */
  helleno:{muur:["#F3F1EA","#ECE8DD"],dak:["#B86A42","#A85E3A"],balk:"#5A4632",
    steen:["#E6E1D4","#DAD4C4"],torendak:["#B86A42"],huis:"pan",kasteel:"toscana",schip:"galei",kantelen:"blok",vlag:"#2B5A9E"},
  /* Arrida: leem en kalk, platte daken, koepels en minaretten, palmen */
  arrida:{muur:["#E0CDA2","#D6BF8E","#EDE3CC","#CDB083","#F2EDE0"],dak:["#D6BF8E"],balk:"#6A5440",
    steen:["#D2B98A","#C8AC7A","#DCC79C"],torendak:["#E8E2D2","#3E8C84","#D6BF8E"],huis:"plat",kasteel:"arrida",schip:"dhow",kantelen:"driehoek",vlag:"#2E7A5E"},
  /* Indus: roze zandsteen, uienkoepels */
  indus:{muur:["#D9A27E","#CF9672","#E3B391","#EADBC8"],dak:["#B8735A"],balk:"#5A4030",
    steen:["#C98F6B","#BF8463","#D4A07E"],torendak:["#EDE5D6","#C98F6B"],huis:"plat",kasteel:"arrida",schip:"dhow",kantelen:"driehoek",vlag:"#D08A2E"},
  /* Nihon-Ja: wit pleister en donker hout, donkere pannen met opkrullende hoeken */
  "nihon-ja":{muur:["#EDE8DC","#E4DED0","#6B5642","#5E4A38"],dak:["#3E4448","#464C50","#383E42"],balk:"#3A2E24",
    steen:["#9C978C","#8E897E"],torendak:["#3E4448"],huis:"japans",kasteel:"nihon",schip:"jonk",kantelen:null,vlag:"#B8302A"},
  /* de Oostelijke Steppen: ronde tenten van vilt */
  steppen:{muur:["#E6DCC4","#DCCFB0","#D2C4A2"],dak:["#C9B98F"],balk:"#6A5440",
    steen:["#B8AE96"],torendak:["#8E2B2B"],huis:"joert",kasteel:"skandia",schip:"kogge",kantelen:null,vlag:"#8E2B2B"}
};
const STIJL_VAN={araluen:"araluen",hibernia:"hibernia",picta:"picta",celtica:"picta","mountains-of-rain-and-night":"picta",
  skandia:"skandia",skorghijl:"skandia",sonderland:"skandia",teutlandt:"teutlandt",alpina:"teutlandt",ursali:"teutlandt",aslava:"teutlandt",
  gallica:"gallica",iberion:"iberion",toscana:"toscana",santorillos:"helleno",helleno:"helleno",baralat:"arrida",
  arrida:"arrida",indus:"indus","nihon-ja":"nihon-ja","eastern-steps":"steppen","middle-kingdoms":"steppen"};

/* ======================= de bouwer van één plaats ======================= */
export function maakBouwer(omg){
  const S=vormen();
  const {X,Z,yOp,hNorm,opLand,hash2}=omg;
  const bakken={vast:new Bak(),doek:new Bak(),schip:new Bak(true),plas:new Bak()};
  const lampjes=[], bomen=[];
  const m4=new THREE.Matrix4(), nm=new THREE.Matrix3(), q=new THREE.Quaternion(), e=new THREE.Euler(), sv=new THREE.Vector3(), pv=new THREE.Vector3();
  const kl=new THREE.Color();

  /* b: een bouwer rond kaartpunt (cx,cy), gedraaid over rot */
  function rond(cx,cy,rot,zaad){
    const co=Math.cos(rot), si=Math.sin(rot);
    let teller=0;
    const b={cx,cy,rot,top:0,straal:.5,
      /* toeval dat bij deze plaats hoort: elke keer laden hetzelfde */
      r:(i)=>hash2((cx*131+i*17+zaad)|0,(cy*71+i*29)|0),
      w:(u,v)=>[cx+u*co-v*si,cy+u*si+v*co],
      grond:(u,v)=>{ const [x,y]=b.w(u,v); return yOp(x,y); },
      land:(u,v)=>{ const [x,y]=b.w(u,v); return opLand(x,y); },
      diep:(u,v)=>{ const [x,y]=b.w(u,v); return hNorm(x,y); },
      /* de laagste grond onder een voetafdruk: daar begint de voet */
      voet:(u,v,ru,rv,r=0)=>{
        let m=b.grond(u,v); const c=Math.cos(r),s=Math.sin(r);
        for(const [a,d] of [[-ru,-rv],[ru,-rv],[ru,rv],[-ru,rv]])m=Math.min(m,b.grond(u+a*c-d*s,v+a*s+d*c));
        return Math.max(m,.02);
      }
    };
    const kleurVan=(k,var_)=>{ kl.set(k); if(var_){ const f=1+(b.r(teller++)-.5)*var_; kl.r*=f; kl.g*=f; kl.b*=f; } return kl; };
    /* één stuk neerzetten: vorm s, plek (u,y,v) lokaal, maat, draaiing r (lokaal) */
    b.stuk=(bak,s,u,y,v,sx,sy,sz,r,kleur,o={})=>{
      const [x,yy]=b.w(u,v);
      m4.compose(pv.set(X(x),y,Z(yy)),q.setFromEuler(e.set(o.rx||0,-(rot+(r||0)),o.rz||0,"YXZ")),sv.set(sx,sy,sz));
      nm.getNormalMatrix(m4);
      bakken[bak].voeg(s,m4,nm,kleurVan(kleur,o.var??.08),o.dob);
      b.top=Math.max(b.top,y+sy);
    };
    /* een blok op de grond: voet bx×bz, hoogte h boven de grond (y: eigen voet) */
    b.blok=(u,v,bx,bz,h,kleur,o={})=>{
      const y0=o.y??b.voet(u,v,bx/2,bz/2,o.r||0)-.02, top=o.y!=null?o.y+h:b.grond(u,v)+h;
      b.stuk(o.bak||"vast",S.blok,u,y0,v,bx,Math.max(.005,top-y0),bz,o.r||0,kleur,o);
      return top;
    };
    b.cil=(u,v,rad,h,kleur,o={})=>{
      const y0=o.y??b.voet(u,v,rad*.7,rad*.7)-.02, top=o.y!=null?o.y+h:b.grond(u,v)+h;
      b.stuk(o.bak||"vast",o.zes?S.cil6:S.cil,u,y0,v,rad,top-y0,rad,o.r||0,kleur,o);
      return top;
    };
    /* vormen die ergens bovenop komen: y is waar ze beginnen */
    b.kegel=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",o.zes?S.kegel6:S.kegel,u,y,v,rad,h,rad,o.r||0,kleur,o);
    b.pir=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.pir,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.zadel=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.zadel,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.schild=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.schild,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.pagode=(u,v,y,bx,bz,h,kleur,o={})=>b.stuk(o.bak||"vast",S.pagode,u,y,v,bx,h,bz,o.r||0,kleur,o);
    b.koepel=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",S.koepel,u,y,v,rad,h,rad,0,kleur,o);
    b.ui=(u,v,y,rad,h,kleur,o={})=>b.stuk(o.bak||"vast",S.ui,u,y,v,rad,h,rad,0,kleur,o);
    b.bol=(u,v,y,rad,kleur,o={})=>b.stuk(o.bak||"vast",S.bol,u,y,v,rad,o.h??rad,rad,0,kleur,o);
    b.lamp=(u,y,v)=>{ const [x,yy]=b.w(u,v); lampjes.push(X(x),y,Z(yy)); };
    b.boom=(u,v,soort,maat=1)=>{ const [x,y]=b.w(u,v); if(opLand(x,y))bomen.push(x,y,soort,maat); };
    /* een paal met een vlag (het doek wappert niet, maar hangt wel aan de goede kant) */
    b.vlag=(u,v,y,h,kleur,o={})=>{
      b.stuk("vast",S.cil6,u,y,v,.0045,h,.0045,0,"#4A3A2A");
      b.stuk("doek",S.vlak,u,y+h-.055*(o.maat||1),v,.09*(o.maat||1),.05*(o.maat||1),1,o.r??.6,kleur);
    };
    /* een muur van (u0,v0) naar (u1,v1), met kantelen erop */
    b.muur=(u0,v0,u1,v1,h,dik,kleur,o={})=>{
      const lang=Math.hypot(u1-u0,v1-v0), r=Math.atan2(v1-v0,u1-u0), mu=(u0+u1)/2, mv=(v0+v1)/2;
      /* op een helling loopt een muur in stukken met de grond mee, anders
         wordt het een wig die boven het laagste punt uittorent */
      if(o.y==null&&lang>.2){
        const verval=Math.abs(b.grond(u0,v0)-b.grond(u1,v1))+Math.abs(b.grond(mu,mv)-(b.grond(u0,v0)+b.grond(u1,v1))/2);
        if(verval>h*.4){
          const n=Math.ceil(lang/.12); let top=0;
          for(let i=0;i<n;i++)top=Math.max(top,b.muur(u0+(u1-u0)*i/n,v0+(v1-v0)*i/n,u0+(u1-u0)*(i+1)/n+(u1-u0)/n*.08,v0+(v1-v0)*(i+1)/n+(v1-v0)/n*.08,h,dik,kleur,o));
          return top;
        }
      }
      const y0=o.y??Math.min(b.voet(u0,v0,dik,dik),b.voet(mu,mv,dik,dik),b.voet(u1,v1,dik,dik))-.03;
      const top=o.top??Math.max(b.grond(u0,v0),b.grond(mu,mv),b.grond(u1,v1))+h;
      b.stuk("vast",S.blok,mu,y0,mv,lang,top-y0,dik,r,kleur,o);
      const k=o.kantelen===undefined?"blok":o.kantelen;
      if(k){
        const n=Math.max(1,Math.round(lang/(dik*1.6)));
        for(let i=0;i<n;i++){
          const t=(i+.5)/n-.5, cu=mu+Math.cos(r)*t*lang, cv=mv+Math.sin(r)*t*lang, w=lang/n*.55;
          if(k==="driehoek")b.stuk("vast",S.pir,cu,top,cv,w,dik*1.25,dik*.9,r,kleur,o);
          else if(k==="zwaluw"){ b.stuk("vast",S.blok,cu,top,cv,w,dik*.6,dik*1.02,r,kleur,o); b.stuk("vast",S.zadel,cu,top+dik*.6,cv,dik*1.02,dik*.5,w,r+Math.PI/2,kleur,{...o,rx:Math.PI}); }
          else b.stuk("vast",S.blok,cu,top,cv,w,dik*.75,dik*1.02,r,kleur,o);
        }
      }
      return top;
    };
    /* een muur rond een veelhoek van punten */
    b.ring=(punten,h,dik,kleur,o={})=>{ for(let i=0;i<punten.length;i++){ const a=punten[i], c=punten[(i+1)%punten.length]; if(o.open&&o.open.includes(i))continue; b.muur(a[0],a[1],c[0],c[1],h,dik,kleur,o); } };
    /* een toren: rond of vierkant, met een dak naar keuze */
    b.toren=(u,v,rad,h,kleur,o={})=>{
      const top=o.vierkant?b.blok(u,v,rad*2,rad*2,h,kleur,{...o,r:o.r||0}):b.cil(u,v,rad,h,kleur,o);
      const dk=o.dakKleur||kleur, dh=o.dakH??rad*2.4;
      const over=o.overstek??1.18;
      switch(o.dak||"kegel"){
        case "kegel": if(o.vierkant)b.pir(u,v,top,rad*2*over,rad*2*over,dh,dk,{r:o.r||0}); else b.kegel(u,v,top,rad*over,dh,dk); break;
        case "plat": b.kantelRing(u,v,top,rad,kleur,o); break;
        case "koepel": b.koepel(u,v,top,rad*1.02,rad*1.1,dk); break;
        case "ui": b.ui(u,v,top,rad*1.15,rad*2.2,dk); b.stuk("vast",S.kegel6,u,top+rad*2.2,v,.004,.04,.004,0,"#C9A94A"); break;
        case "pagode": for(let i=0;i<(o.lagen||3);i++){ const s=1-i*.22; b.pagode(u,v,top+i*rad*.9,rad*3*s,rad*3*s,rad*1.1,dk,{r:o.r||0}); } break;
      }
      if(o.vlag)b.vlag(u,v,top+(o.dak==="plat"?0:dh*.85),.14,o.vlag);
      return top+(o.dak==="plat"?rad*.4:dh);
    };
    /* kantelen in een kring (of vierkant) bovenop een toren */
    b.kantelRing=(u,v,y,rad,kleur,o={})=>{
      if(o.vierkant){
        for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]])for(let i=0;i<3;i++){
          const t=(i-1)*.62*rad; const pu=u+(a===c?t*a:rad*a), pv2=v+(a===c?rad*c:t*c);
          b.stuk("vast",S.blok,pu,y,pv2,rad*.3,rad*.35,rad*.3,o.r||0,kleur);
        }
        return;
      }
      const n=Math.max(5,Math.round(rad*60));
      for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; b.stuk("vast",S.blok,u+Math.cos(a)*rad*.92,y,v+Math.sin(a)*rad*.92,rad*.32,rad*.38,rad*.22,a,kleur); }
    };
    /* een rond poortje in een muur is te fijn; een poortgebouw wel */
    b.poort=(u,v,r,breed,h,kleur,dak)=>{
      for(const z of [-1,1]){ const pu=u-Math.sin(r)*z*breed*.45, pv2=v+Math.cos(r)*z*breed*.45; b.toren(pu,pv2,breed*.24,h,kleur,{dak:dak?"kegel":"plat",dakKleur:dak,dakH:breed*.5}); }
      b.blok(u,v,breed*.5,breed*.7,h*.82,kleur,{r});
      b.blok(u+Math.cos(r)*breed*.36,v+Math.sin(r)*breed*.36,.012,breed*.28,h*.5,"#2A231D",{r,var:0});
    };
    /* een tent: rond (kegel) of met een nok */
    b.tent=(u,v,rad,h,kleur,o={})=>{
      const y=b.voet(u,v,rad*.7,rad*.7)-.01;
      if(o.nok)b.stuk("doek",S.zadel,u,y,v,rad*2.2,h,rad*1.6,o.r||0,kleur);
      else b.stuk("doek",S.kegel6,u,y,v,rad,h,rad,o.r||0,kleur);
      if(o.vlag)b.vlag(u,v,y+h*.9,.08,o.vlag,{maat:.6});
    };
    /* een plas, vijver of gracht: een vlakke schijf water */
    b.plas=(u,v,ru,rv,y,o={})=>b.stuk("plas",S.schijf,u,y,v,ru,1,rv,o.r||0,o.kleur||"#4E7E8C",{var:0});
    /* een rots (voor kliffen, pasjes, steenhopen) */
    b.rots=(u,v,rad,kleur="#8A8579",o={})=>{ const y=b.voet(u,v,rad*.5,rad*.5)-rad*.3; b.stuk("vast",S.bol,u,y,v,rad,rad*(o.plat??.7),rad*(.8+b.r(teller+7)*.4),b.r(teller+3)*6,kleur,{var:.15}); };
    return b;
  }

  /* ---- huizen ----
     Eén huis in de stijl van zijn land, op de laagste grond onder zijn
     voetafdruk (op een helling zakt de muur dan iets het land in, liever dan
     dat het huis zweeft). maat 1 is een gewoon huis, een tiende
     kaarteenheid breed. */
  function huis(b,u,v,stijl,o={}){
    const st=STIJLEN[stijl]||STIJLEN.araluen, r=o.r||0, m=o.maat||1, n=o.nr||0;
    const kies=(lijst,i)=>lijst[Math.floor(b.r(n*7+i)*lijst.length)%lijst.length];
    const muur=o.muur||kies(st.muur,1), dak=o.dak||kies(st.dak,2);
    const bx=(.075+b.r(n*3+4)*.04)*m, bz=(.055+b.r(n*5+6)*.022)*m, bh=(.045+b.r(n*11+8)*.025)*m*(o.hoog||1);
    if(!b.land(u,v))return 0;
    const vorm=o.vorm||st.huis;
    let top;
    switch(vorm){
      case "zadel": case "steil": {
        top=b.blok(u,v,bx,bz,bh,muur,{r});
        const s=vorm==="steil"?1.35:1;
        b.zadel(u,v,top-.002,bx*1.1,bz*1.18,bz*.62*s,dak,{r});
        if(stijl==="araluen"&&b.r(n+40)<.5)b.blok(u+Math.cos(r)*bx*.38,v+Math.sin(r)*bx*.38,.012,.012,bh+bz*.55*s,"#8A7C6A",{r});   /* schoorsteen */
        top+=bz*.62*s; break;
      }
      case "lang": {   /* Skandisch langhuis: lage wanden, groot dak tot bijna op de grond */
        const L=bx*1.6;
        top=b.blok(u,v,L,bz*1.05,bh*.55,muur,{r});
        b.zadel(u,v,top-.004,L*1.04,bz*1.35,bz*.85,dak,{r});
        top+=bz*.85; break;
      }
      case "plag": {   /* Pictisch: laag, dik, plaggendak */
        top=b.blok(u,v,bx*.9,bz,bh*.7,muur,{r});
        b.schild(u,v,top-.003,bx*.98,bz*1.12,bz*.5,dak,{r});
        top+=bz*.5; break;
      }
      case "pan": {    /* Toscaans: twee lagen soms, een laag pannendak */
        const hoog=b.r(n+21)<.35?1.6:1;
        top=b.blok(u,v,bx,bz,bh*hoog,muur,{r});
        b.schild(u,v,top-.002,bx*1.08,bz*1.12,bz*.32,dak,{r});
        top+=bz*.32; break;
      }
      case "plat": {   /* Arridisch: een blok met een randje, soms een koepeltje */
        const hoog=b.r(n+23)<.3?1.5:1;
        top=b.blok(u,v,bx*.95,bz*1.05,bh*hoog,muur,{r});
        b.blok(u,v,bx*.95,bz*1.05,.006,muur,{r,y:top});
        if(b.r(n+29)<.18){ b.koepel(u,v,top,bz*.36,bz*.38,b.r(n+31)<.5?"#F2EDE0":muur); top+=bz*.38; }
        break;
      }
      case "japans": { /* hout op een stenen voet, een donker dak dat uitwaaiert */
        const v0=b.blok(u,v,bx,bz,.012,"#8E897E",{r});
        top=b.blok(u,v,bx*.92,bz*.9,bh,kies(st.muur,3),{r,y:v0});
        b.pagode(u,v,top-.004,bx*1.25,bz*1.35,bz*.55,dak,{r});
        top+=bz*.55; break;
      }
      case "joert": {
        top=b.cil(u,v,bz*.55,bh*.6,muur,{zes:true});
        b.kegel(u,v,top,bz*.6,bz*.32,dak,{zes:true});
        top+=bz*.3; break;
      }
    }
    /* licht achter de ramen, net boven het dak (in het huis zou de muur het verbergen) */
    if(b.r(n*13+17)<.6)b.lamp(u,top+.012,v);
    return top;
  }

  /* ---- de plaats van een stad: waar huizen kunnen staan ----
     Een raster rond het midden, met een kleine afwijking, alleen op land en
     niet te steil; het dichtst bij het midden eerst. Huizen staan in het
     gelid langs een paar straten. */
  function plekkenVoorHuizen(b,R,o={}){
    const kand=[], stap=o.stap||.13;
    for(let gv=-R;gv<=R;gv+=stap)for(let gu=-R;gu<=R;gu+=stap){
      const i=Math.round(gu*71+gv*13+400), u=gu+(b.r(i)-.5)*stap*.5, v=gv+(b.r(i+700)-.5)*stap*.5;
      const d=Math.hypot(u*(o.rek||1),v); if(d>R)continue;
      if(!b.land(u,v)||!b.land(u+.05,v)||!b.land(u-.05,v)||!b.land(u,v+.05)||!b.land(u,v-.05))continue;
      if(o.weg&&o.weg(u,v))continue;
      const g=b.grond(u,v), s=Math.abs(b.grond(u+.1,v)-g)+Math.abs(b.grond(u,v+.1)-g);
      if(s>.12)continue;
      kand.push([u,v,d+b.r(i+900)*R*.35]);
    }
    kand.sort((a,c)=>a[2]-c[2]);
    return kand;
  }
  function stadje(b,stijl,o={}){
    const R=o.straal||.7, aantal=o.aantal||24;
    const kand=plekkenVoorHuizen(b,R,o);
    let i=0;
    for(const [u,v] of kand.slice(0,aantal)){
      /* in het gelid: de straten lopen langs de as van de plaats, of eromheen */
      const a=o.richting!=null?o.richting:o.rond?Math.atan2(v,u)+Math.PI/2:Math.round(Math.atan2(v,u)/(Math.PI/2))*(Math.PI/2);
      const t=huis(b,u,v,stijl,{r:a+(b.r(i*5+3)-.5)*(o.los??.25),nr:i,maat:o.maat||1});
      b.top=Math.max(b.top,t); i++;
    }
    return kand;
  }

  /* ---- schepen ----
     Een romp uit spanten, smal aan de punten, met een zeeg (hoger aan
     voor- en achtersteven). Daarop wat bij het soort hoort: het vierkante
     gestreepte zeil en de schildenrij van een wolfschip, de driehoekszeilen
     van de Reiger, het latijnzeil van een dhow, de latten van een jonk. */
  function romp(bak,b,L,B,diep,zeeg,steven,kleur,plek,dob){
    const st=9, ring=[];
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
    const s={p:g.getAttribute("position").array,n:g.getAttribute("normal").array};
    const [mx,my,richting]=plek;
    m4.compose(pv.set(X(mx),0,Z(my)),q.setFromEuler(e.set(0,-richting,0)),sv.set(1,1,1));
    nm.getNormalMatrix(m4);
    kl.set(kleur); bakken[bak].voeg(s,m4,nm,kl,dob);
  }
  function schip(soort,mx,my,richting,zaad,o={}){
    const dob=[X(mx),Z(my),zaad*7.3,1];
    const b=rond(mx,my,richting,zaad);
    const sk=(s,u,y,v,sx,sy,sz,r,k,oo={})=>b.stuk("schip",s,u,y,v,sx,sy,sz,r,k,{...oo,dob,var:.05});
    const m=o.maat||1;
    switch(soort){
      case "wolf": case "reiger": {
        const L=.34*m, B=.075*m;
        romp("schip",b,L,B,.02*m,.018*m,.04*m,o.romp||"#5B4330",[mx,my,richting],dob);
        /* de schilden langs de boord */
        if(soort==="wolf")for(let i=-4;i<=4;i++)for(const z of [-1,1])sk(S.cil6,i*L*.085,.006,z*B*.47,.012*m,.004,.012*m,0,["#A33A2A","#E0D6BC","#2E4E7A","#C9A94A"][(i+5+(z>0?1:0)+zaad)%4],{rx:Math.PI/2});
        sk(S.cil6,0,0,0,.004*m,.24*m,.004*m,0,"#4A3826");
        if(soort==="wolf"){
          /* het vierkante zeil, gestreept */
          const str=o.zeil||["#A83A2C","#EDE4CF"];
          for(let i=0;i<4;i++)sk(S.doek,0,.08*m+i*.032*m,0,.13*m,.032*m,1,Math.PI/2,str[i%2]);
        }else{
          /* de Reiger: twee driehoekige windzeilen, Hals eigen ontwerp */
          sk(S.driehoek,.0,.03*m,0,.13*m,.2*m,1,Math.PI,"#EFE8D6");
          sk(S.driehoek,-.09*m,.03*m,0,.1*m,.16*m,1,Math.PI,"#E4DCC6");
        }
        break;
      }
      case "kogge": {
        const L=.22*m, B=.09*m;
        romp("schip",b,L,B,.03*m,.016*m,.02*m,o.romp||"#6A4E36",[mx,my,richting],dob);
        sk(S.blok,-L*.36,.012*m,0,.05*m,.035*m,B*.8,0,"#5E4430");   /* achterkasteel */
        sk(S.cil6,0,0,0,.004*m,.22*m,.004*m,0,"#4A3826");
        sk(S.doek,0,.07*m,0,.1*m,.11*m,1,Math.PI/2,o.zeil||"#EDE4CF");
        break;
      }
      case "galei": {
        const L=.3*m, B=.06*m;
        romp("schip",b,L,B,.018*m,.012*m,.02*m,o.romp||"#4E3A2A",[mx,my,richting],dob);
        for(let i=-5;i<=5;i++)for(const z of [-1,1])sk(S.blok,i*L*.07,-.002,z*B*.9,.003,.003,.05*m,0,"#3E2E20");  /* riemen */
        sk(S.cil6,.03*m,0,0,.004*m,.2*m,.004*m,0,"#4A3826");
        sk(S.driehoek,.12*m,.03*m,0,-.24*m,.17*m,1,0,o.zeil||"#E8DFC8");
        break;
      }
      case "dhow": {
        const L=.2*m, B=.07*m;
        romp("schip",b,L,B,.025*m,.022*m,.03*m,o.romp||"#7A5A3C",[mx,my,richting],dob);
        sk(S.cil6,.02*m,0,0,.004*m,.17*m,.004*m,0,"#4A3826");
        sk(S.driehoek,.1*m,.03*m,0,-.2*m,.15*m,1,0,o.zeil||"#F0EADA");
        break;
      }
      case "jonk": {
        const L=.2*m, B=.08*m;
        romp("schip",b,L,B,.025*m,.012*m,.035*m,o.romp||"#5E4632",[mx,my,richting],dob);
        sk(S.blok,-L*.38,.01*m,0,.05*m,.04*m,B*.85,0,"#4E3A28");
        for(const [u,h] of [[.03,.19],[-.04,.15]]){
          sk(S.cil6,u*m,0,0,.004*m,h*m,.004*m,0,"#3E2E20");
          for(let i=0;i<4;i++)sk(S.doek,u*m,.05*m+i*.028*m,0,.08*m,.026*m,1,Math.PI/2,i%2?"#A0522D":"#B5653A");
        }
        break;
      }
      default: {  /* een vissersbootje */
        romp("schip",b,.09*m,.035*m,.012*m,.008*m,.008*m,o.romp||"#6B5038",[mx,my,richting],dob);
        if(o.zeil!==false){ sk(S.cil6,.005,0,0,.0025,.07*m,.0025,0,"#4A3826"); sk(S.driehoek,.005,.015*m,0,-.045*m,.05*m,1,0,o.zeil||"#E8DFC8"); }
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
    if(hNorm(cx,cy)<0){ while(t>-max&&hNorm(cx+dx*t,cy+dy*t)<0)t-=.04; return t; }
    while(t<max&&hNorm(cx+dx*t,cy+dy*t)>=0)t+=.04;
    return t;
  }
  /* schepen op het water voor een haven: waar het diep genoeg is, niet op elkaar */
  function vloot(cx,cy,a,soort,aantal,zaad,o={}){
    const gelegd=[];
    for(let k=0;k<aantal*30&&gelegd.length<aantal;k++){
      const hk=hash2((cx*31+k*7+zaad)|0,(cy*17+k*13)|0), hk2=hash2((cy*29+k*5)|0,(cx*11+k*19+zaad)|0);
      const hoek=a+(hk-.5)*(o.spreid??1.6), d=(o.van??.5)+hk2*(o.tot??1.4);
      const x=cx+Math.cos(hoek)*d, y=cy+Math.sin(hoek)*d;
      if(hNorm(x,y)>(o.ondiep??-.03))continue;
      if(hNorm(x+.15,y)>-.01||hNorm(x-.15,y)>-.01||hNorm(x,y+.15)>-.01||hNorm(x,y-.15)>-.01)continue;
      if(gelegd.some(([gx,gy])=>Math.hypot(gx-x,gy-y)<(o.ruimte??.32)))continue;
      gelegd.push([x,y]);
      const r=o.richting!=null?o.richting+(hk2-.5)*.4:hk*Math.PI*2;
      schip(Array.isArray(soort)?soort[gelegd.length%soort.length]:soort,x,y,r,zaad+k,o);
    }
    return gelegd;
  }
  /* een steiger vanaf de waterlijn het water in */
  function steiger(b,cx,cy,a,lang=.7,kleur="#6B5138"){
    const t=waterlijn(cx,cy,a), dx=Math.cos(a), dy=Math.sin(a);
    const x0=cx+dx*(t-.12), y0=cy+dy*(t-.12);
    const c=rond(x0,y0,a,7);
    c.stuk("vast",V.blok,lang/2,.012,0,lang,.012,.05,0,kleur);
    for(let i=0;i<=Math.floor(lang/.1);i++)for(const z of [-1,1])c.stuk("vast",V.cil6,i*.1,-.2,z*.022,.004,.235,.004,0,"#4E3A28");
    return [x0+dx*lang,y0+dy*lang];
  }

  return {rond,huis,stadje,plekkenVoorHuizen,schip,vloot,steiger,zeeRichting,waterlijn,bakken,lampjes,bomen,S};
}

/* ======================= generieke modellen per soort ======================= */

/* Een kasteel in de stijl van zijn land: een ringmuur met torens, een
   donjon, en een poort aan de kant van de grootste ruimte. */
function kasteel(B,b,stijl,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  const steen=o.steen||st.steen[Math.floor(b.r(1)*st.steen.length)];
  const dak=o.dak||st.torendak[Math.floor(b.r(2)*st.torendak.length)];
  const S=o.maat||.8, hw=S/2, mh=o.muurH||.15, dik=.045;
  const soort=o.soort||st.kasteel;
  const kant=o.kantelen??st.kantelen;
  const hoeken=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
  const basis=b.voet(0,0,hw,hw);
  /* een voet tot onder de grond, zodat het kasteel nergens zweeft */
  if(soort==="hibernia"||soort==="broch"||soort==="skandia")b.stuk("vast",B.S.cil,0,basis-.6,0,hw*1.1,.62,hw*1.1,0,steen);
  else b.stuk("vast",B.S.blok,0,basis-.6,0,S+.1,.62,S+.1,0,steen);
  switch(soort){
    case "gallica": {   /* een château: ronde torens met hoge puntige leien spitsen */
      b.ring(hoeken,mh,dik,steen,{kantelen:"blok",y:basis-.02,top:basis+mh});
      for(const [u,v] of hoeken)b.toren(u,v,.075,mh+.13,steen,{dak:"kegel",dakKleur:dak,dakH:.24,y:basis-.02});
      b.blok(-.06,-.05,.36,.26,.32,steen,{y:basis});
      b.schild(-.06,-.05,basis+.32,.4,.3,.2,dak);
      b.toren(.14,.1,.06,.5,steen,{dak:"kegel",dakKleur:dak,dakH:.26,vlag:o.vlag||st.vlag,y:basis});
      b.toren(-.22,.12,.045,.4,steen,{dak:"kegel",dakKleur:dak,dakH:.2,y:basis});
      b.poort(0,hw,Math.PI/2,.18,mh+.05,steen,dak);
      break;
    }
    case "hibernia": {  /* een ringfort (dun) met een woontoren en een slanke ronde toren */
      const n=16, rr=hw*1.05, pts=[];
      for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; pts.push([Math.cos(a)*rr,Math.sin(a)*rr]); }
      b.ring(pts,mh*.85,dik,steen,{kantelen:"blok",open:[4]});
      b.blok(-.04,-.04,.24,.2,.42,steen,{y:basis});
      b.kantelRing(-.04,-.04,basis+.42,.12,steen,{vierkant:true});
      b.toren(.16,.08,.032,.62,steen,{dak:"kegel",dakKleur:dak,dakH:.11,y:basis});
      b.vlag(-.04,-.04,basis+.42,.16,o.vlag||st.vlag);
      break;
    }
    case "teutlandt": {
      b.ring(hoeken,mh,dik,steen,{kantelen:"blok",y:basis-.02,top:basis+mh});
      for(const [u,v] of hoeken)b.toren(u,v,.065,mh+.1,steen,{vierkant:true,dak:"kegel",dakKleur:dak,dakH:.2,y:basis-.02});
      b.blok(0,-.05,.26,.24,.5,steen,{y:basis});
      b.pir(0,-.05,basis+.5,.3,.28,.32,dak);
      b.poort(0,hw,Math.PI/2,.17,mh+.04,steen,dak);
      break;
    }
    case "toscana": {   /* rocca: vierkante torens, zwaluwstaartkantelen, een hoge campanile */
      b.ring(hoeken,mh,dik,steen,{kantelen:kant,y:basis-.02,top:basis+mh});
      for(const [u,v] of hoeken)b.toren(u,v,.065,mh+.1,steen,{vierkant:true,dak:"plat",y:basis-.02});
      b.blok(-.08,-.06,.3,.26,.26,steen,{y:basis});
      b.schild(-.08,-.06,basis+.26,.32,.28,.06,st.dak[0]);
      b.toren(.16,-.12,.05,.6,steen,{vierkant:true,dak:"plat",vlag:o.vlag||st.vlag,y:basis});
      b.poort(0,hw,Math.PI/2,.17,mh+.04,steen,null);
      break;
    }
    case "arrida": {    /* kasba: dikke leemmuren, taps toelopende torens, driehoekige kantelen */
      b.ring(hoeken,mh*1.2,dik*1.4,steen,{kantelen:"driehoek",y:basis-.02,top:basis+mh*1.2});
      for(const [u,v] of hoeken){ b.toren(u,v,.07,mh*1.2+.1,steen,{vierkant:true,dak:"plat",y:basis-.02}); }
      b.blok(-.05,-.05,.34,.3,.26,steen,{y:basis});
      b.koepel(-.05,-.05,basis+.26,.1,.1,st.torendak[0]);
      b.toren(.18,.15,.03,.55,st.muur[2],{dak:"koepel",dakKleur:st.torendak[0],y:basis});
      b.poort(0,hw,Math.PI/2,.18,mh*1.2+.04,steen,null);
      break;
    }
    case "nihon": {     /* een Japanse burcht: schuine stenen voet, witte muren, een getrapte toren */
      b.ring(hoeken,mh*.8,dik*.8,"#EDE8DC",{kantelen:null,y:basis-.02,top:basis+mh*.8});
      b.blok(0,-.04,.38,.34,.1,"#9C978C",{y:basis});
      let y=basis+.1;
      for(let i=0;i<4;i++){
        const s=1-i*.2;
        b.blok(0,-.04,.28*s,.25*s,.08,"#EDE8DC",{y});
        b.pagode(0,-.04,y+.075,.36*s,.33*s,.07,"#3E4448");
        y+=.11;
      }
      b.lamp(0,y-.1,-.04);
      for(const [u,v] of [[-hw,-hw],[hw,hw]])b.toren(u,v,.06,mh*.8+.06,"#EDE8DC",{vierkant:true,dak:"pagode",dakKleur:"#3E4448",lagen:1,y:basis});
      b.top=Math.max(b.top,y);
      break;
    }
    case "skandia": {   /* een houten hal achter een palissade */
      const pts=[]; for(let i=0;i<14;i++){ const a=i/14*Math.PI*2; pts.push([Math.cos(a)*hw,Math.sin(a)*hw*.8]); }
      for(let i=0;i<pts.length;i++){ const [u,v]=pts[i]; b.cil(u,v,.012,.12+b.r(i)*.02,"#6B5038",{zes:true}); }
      b.ring(pts,.09,.02,"#6B5038",{kantelen:null});
      B.huis(b,0,0,"skandia",{maat:2.2,r:0,nr:3});
      break;
    }
    case "broch": {     /* een broch: een ronde, taps toelopende toren van droge steen */
      b.stuk("vast",B.S.kegel,0,basis-.02,0,.1,.5,.1,0,steen);
      b.cil(0,0,.072,.24,steen,{y:basis-.02});
      b.cil(0,0,.068,.02,"#5E5A52",{y:basis+.22});
      for(let i=0;i<5;i++){ const a=i/5*Math.PI*2+.4; B.huis(b,Math.cos(a)*.34,Math.sin(a)*.34,"picta",{r:a,nr:i}); }
      break;
    }
    default: {          /* Araluen: ringmuur, ronde hoektorens, een vierkante donjon en een hoge toren */
      b.ring(hoeken,mh,dik,steen,{kantelen:"blok",y:basis-.02,top:basis+mh});
      for(const [u,v] of hoeken)b.toren(u,v,.07,mh+.12,steen,{dak:"kegel",dakKleur:dak,dakH:.17,y:basis-.02});
      b.blok(-.08,-.06,.3,.26,.4,steen,{y:basis});
      b.kantelRing(-.08,-.06,basis+.4,.15,steen,{vierkant:true});
      b.toren(.14,.08,.06,.6,steen,{dak:"kegel",dakKleur:dak,dakH:.2,vlag:o.vlag||st.vlag,y:basis});
      b.poort(0,hw,Math.PI/2,.17,mh+.05,steen,dak);
    }
  }
  b.lamp(.14,basis+.42,.1); b.lamp(-.08,basis+.3,-.06); b.lamp(0,basis+mh+.03,hw+.05);
  b.straal=hw*1.3;
}

/* een stad of dorp: huizen rond een plein, met wat erbij hoort */
function stad(B,b,stijl,o={}){
  B.stadje(b,stijl,{straal:o.straal||.65,aantal:o.aantal||22,...o});
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  /* een gebouw op het plein: kerk, hal, moskee of tempel */
  const [pu,pv]=o.plein||[0,0];
  if(o.geenPlein)return;
  const g=b.voet(pu,pv,.1,.1);
  switch(st.huis){
    case "plat": {
      b.blok(pu,pv,.16,.16,.09,st.muur[4]||st.muur[0],{y:g-.02});
      b.koepel(pu,pv,g+.07,.07,.08,st.torendak[1]||"#3E8C84");
      b.toren(pu+.11,pv-.08,.018,.3,st.muur[4]||st.muur[0],{dak:"koepel",dakKleur:st.torendak[0],y:g});
      b.lamp(pu,g+.1,pv);
      break;
    }
    case "japans": {
      b.blok(pu,pv,.14,.12,.06,"#6B5642",{y:g});
      b.pagode(pu,pv,g+.06,.2,.18,.08,"#3E4448");
      break;
    }
    case "lang": B.huis(b,pu,pv,stijl,{maat:1.7,nr:99}); break;
    default: {
      const muur=st.huis==="pan"?st.muur[0]:"#D8D0BC", toren=st.huis==="pan";
      b.blok(pu,pv,.19,.09,.12,muur,{y:g-.02});
      b.zadel(pu,pv,g+.1,.2,.1,.07,st.dak[2]||st.dak[0]);
      if(toren)b.toren(pu-.13,pv,.028,.32,muur,{vierkant:true,dak:"kegel",dakKleur:st.dak[0],dakH:.06,y:g});
      else b.toren(pu-.12,pv,.03,.3,muur,{vierkant:true,dak:"kegel",dakKleur:st.torendak[0],dakH:.14,y:g});
      b.lamp(pu-.12,g+.22,pv);
    }
  }
}

/* een haven: de stad landinwaarts, een kade of steiger, en schepen */
function haven(B,b,stijl,p,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  const a=B.zeeRichting(b.cx,b.cy,2.2)??B.zeeRichting(b.cx,b.cy,5);
  if(a==null){ stad(B,b,stijl,o); return; }
  const t=B.waterlijn(b.cx,b.cy,a,6);
  if(t>1.3){
    /* het water ligt een eind verderop: de stad blijft waar de kaart hem
       zet, en aan de kust ligt een haventje met een steiger en schepen */
    stad(B,b,stijl,o);
    const kx=b.cx+Math.cos(a)*(t-.32), ky=b.cy+Math.sin(a)*(t-.32);
    const k=B.rond(kx,ky,a+Math.PI/2,b.r(6)*99|0);
    B.stadje(k,stijl,{straal:.26,aantal:5,maat:.9});
    B.steiger(k,kx,ky,a,o.steiger||.6);
    B.vloot(kx,ky,a,o.schip||st.schip,o.schepen??3,b.r(9)*999|0,{richting:a+Math.PI/2,...(o.vloot||{})});
    b.top=Math.max(b.top,k.top);
    return;
  }
  /* de stad ligt aan het water en groeit dus alleen landinwaarts: het midden
     schuift wat van de waterlijn af */
  const mx=b.cx+Math.cos(a)*(t-.45), my=b.cy+Math.sin(a)*(t-.45);
  const c=B.rond(mx,my,a+Math.PI/2,b.r(5)*99|0);
  stad(B,c,stijl,{...o,plein:o.plein||[0,.18]});
  B.steiger(c,mx,my,a,o.steiger||.6);
  if(o.tweedeSteiger)B.steiger(c,mx,my,a+.5,.45);
  B.vloot(mx,my,a,o.schip||st.schip,o.schepen??3,b.r(9)*999|0,{richting:a+Math.PI/2,...(o.vloot||{})});
  b.top=Math.max(b.top,c.top); b.straal=(o.straal||.65)+.2;
}

function ruine(B,b,stijl,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  const steen=o.steen||"#8F8A7A", S=o.maat||.7, hw=S/2;
  const basis=b.voet(0,0,hw*.6,hw*.6);
  /* afgebrokkelde muren: stukken van ongelijke hoogte, met gaten */
  const hoeken=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
  for(let i=0;i<4;i++){
    const [u0,v0]=hoeken[i], [u1,v1]=hoeken[(i+1)%4];
    for(let k=0;k<4;k++){
      if(b.r(i*9+k)<.3)continue;
      const t0=k/4, t1=(k+1)/4-.04;
      b.muur(u0+(u1-u0)*t0,v0+(v1-v0)*t0,u0+(u1-u0)*t1,v0+(v1-v0)*t1,.04+b.r(i*5+k)*.12,.04,steen,{kantelen:null});
    }
  }
  /* de stomp van de donjon, en een half ingestorte toren */
  b.blok(-.05,-.05,.26,.22,.12+b.r(30)*.1,steen,{y:basis-.02});
  b.cil(hw,-hw,.07,.32,steen,{});
  b.cil(-hw,hw,.06,.14,steen,{});
  /* puin */
  for(let i=0;i<14;i++){ const u=(b.r(40+i)-.5)*S*1.3, v=(b.r(60+i)-.5)*S*1.3; b.rots(u,v,.025+b.r(80+i)*.025,o.puin||"#86806F"); }
  b.straal=hw*1.2;
}

function slagveld(B,b,stijl,o={}){
  const st=STIJLEN[stijl]||STIJLEN.araluen;
  /* een gedenksteen, een grafheuvel, vlaggen, en de tenten van het kamp */
  const g=b.voet(0,0,.05,.05);
  b.blok(0,0,.05,.04,.18,"#A7A190",{y:g-.02});
  b.pir(0,0,g+.16,.05,.04,.04,"#A7A190");
  for(let i=0;i<(o.tenten??5);i++){ const a=b.r(i+20)*Math.PI*2, d=.35+b.r(i+25)*.35; b.tent(Math.cos(a)*d,Math.sin(a)*d,.05,.07,["#E2D8BE","#D9CFB4","#CDBF9F"][i%3],{vlag:i%2?null:o.vlag||st.vlag}); }
  for(let i=0;i<4;i++){ const a=b.r(i)*Math.PI*2, d=.15+b.r(i+5)*.25; b.vlag(Math.cos(a)*d,Math.sin(a)*d,b.grond(Math.cos(a)*d,Math.sin(a)*d),.22,(o.vlaggen||["#8E2B2B","#2B4C7E","#C9A94A"])[i%3]); }
  b.straal=.75;
}

/* ======================= de plaatsen zelf =======================
   Per plaats: wat de boeken zeggen, en hoe dat hier gebouwd wordt. info
   zegt hoe breed de grond eronder vlak moet (vlak: [binnen, buiten, kracht])
   en hoe groot de open plek in het bos eromheen is (open). */
export const BOUWERS={
  /* Kasteel Redmont — "het rode kasteel van baron Arald": rode zandsteen,
     op de heuvel boven Wensley, met een Krijgsschool op het binnenplein. Even
     buiten de muren, aan de rand van het bos, de hut van de Grijze Jager. */
  redmont:{info:{vlak:[.5,1.1,1],open:1.1},
  /* de poort kijkt naar Wensley, onder aan de heuvel */
  draai:(POS)=>POS.wensley?Math.atan2(POS.wensley[1]-POS.redmont[1],POS.wensley[0]-POS.redmont[0])-Math.PI/2:0,
  bouw(B,b){
    const rood="#A65A44", dak="#4A4F5E";
    kasteel(B,b,"araluen",{steen:rood,dak,maat:.62,muurH:.13,vlag:"#8E2B2B"});
    /* de oefenplaats van de Krijgsschool: een omheind veld met een paal */
    const c=B.rond(b.cx-.78,b.cy-.15,0,3);
    for(let i=0;i<6;i++)c.cil(-.12+i*.05,.09,.004,.03,"#6B5138",{zes:true});
    /* de hut van Halt, aan de bosrand richting het Westwoud */
    const h=B.rond(b.cx-.95,b.cy+.85,-.4,4);
    const top=h.blok(0,0,.07,.05,.04,"#7A5E44");
    h.zadel(0,0,top-.002,.08,.065,.035,"#8C7A52");
    h.blok(.03,0,.012,.012,.07,"#8A8170");
    h.lamp(0,top+.03,0);
  }},
  /* Wensley — het dorp onder aan de heuvel: herberg, markt, akkers */
  wensley:{info:{vlak:[.35,.8,.6],open:1.2},bouw(B,b){
    B.stadje(b,"araluen",{straal:.42,aantal:13,maat:.9,stap:.11});
    /* de herberg: een groter huis met een uithangbord */
    huisVan(B,b,"araluen",.0,.0,{maat:1.5,nr:50});
    b.cil(.12,.05,.012,.03,"#8A8170");   /* de put op de markt */
  }},
  /* Kasteel Araluen — de koninklijke burcht: slanke witte torens,
     uitgestrekte tuinen, de zetel van koning Duncan */
  "kasteel-araluen":{info:{vlak:[.7,1.5,1],open:2.4},bouw(B,b){
    const wit="#ECE8DE", blauw="#3D5A80", hw=.42;
    const basis=b.voet(0,0,hw,hw);
    b.stuk("vast",B.S.blok,0,basis-.6,0,hw*2+.1,.62,hw*2+.1,0,wit);
    const hoeken=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
    b.ring(hoeken,.16,.04,wit,{y:basis-.02,top:basis+.16});
    for(const [u,v] of hoeken)b.toren(u,v,.055,.36,wit,{dak:"kegel",dakKleur:blauw,dakH:.22,y:basis-.02});
    /* tussentorens halverwege de muren */
    for(const [u,v] of [[0,-hw],[hw,0],[-hw,0]])b.toren(u,v,.04,.28,wit,{dak:"kegel",dakKleur:blauw,dakH:.16,y:basis-.02});
    /* het paleis met zijn slanke torens */
    b.blok(0,-.06,.36,.24,.34,wit,{y:basis});
    b.schild(0,-.06,basis+.34,.38,.26,.12,blauw);
    for(const [u,v,h] of [[-.17,-.17,.72],[.17,-.17,.66],[-.17,.06,.58],[.17,.06,.62],[0,-.06,.86]])
      b.toren(u,v,.034,h,wit,{dak:"kegel",dakKleur:blauw,dakH:.2,y:basis,vlag:h>.8?"#2F5D3A":null});
    b.poort(0,hw,Math.PI/2,.18,.2,wit,blauw);
    b.lamp(0,basis+.4,-.06); b.lamp(-.17,basis+.6,-.17); b.lamp(.17,basis+.55,.06);
    /* de tuinen: perken omzoomd met heggen, grindpaden ertussen, hier en
       daar een geschoren boompje, en in het midden een vijver met fontein */
    for(let i=-2;i<=2;i++)for(let k=0;k<3;k++){
      const u=i*.2, v=hw+.2+k*.2;
      if(!b.land(u,v)||(i===0&&k===1))continue;
      const g=b.grond(u,v);
      b.blok(u,v,.2,.2,.004,"#D2CBB6",{y:g-.002,var:0});                 /* grind */
      b.blok(u,v,.15,.15,.006,(i+k)%2?"#6E9446":"#7FA452",{y:g,var:.04});  /* gazon */
      for(const [du,dv,lu,lv] of [[0,-.075,.15,.012],[0,.075,.15,.012],[-.075,0,.012,.15],[.075,0,.012,.15]])
        b.blok(u+du,v+dv,lu,lv,.018,"#3E5E2E",{y:g,var:.05});            /* heg */
      if((i+k)%2===0)b.kegel(u,v,g,.018,.06,"#3E5E2E");                    /* geschoren boompje */
    }
    { const u=0,v=hw+.4, g=b.grond(u,v);
      b.cil(u,v,.07,.012,"#D8D2C2",{y:g}); b.plas(u,v,.06,.06,g+.013); b.cil(u,v,.008,.04,"#D8D2C2",{y:g}); }
    for(let i=0;i<6;i++)b.boom(-.55+i*.22,hw+.85,2,.8);
    b.straal=.62;
  }},
  /* Kasteel Macindaw — een grensvesting tegen de Scotti: zwaar, grijs,
     vierkant, met een droge gracht. Hier speelde Will de jongleur. */
  macindaw:{info:{vlak:[.5,1.1,1],open:1.0},bouw(B,b){
    const steen="#8E8B82", hw=.33;
    const basis=b.voet(0,0,hw,hw);
    b.stuk("vast",B.S.blok,0,basis-.6,0,hw*2+.08,.62,hw*2+.08,0,steen);
    const hoeken=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
    b.ring(hoeken,.17,.05,steen,{y:basis-.02,top:basis+.17});
    for(const [u,v] of hoeken)b.toren(u,v,.07,.3,steen,{vierkant:true,dak:"plat",y:basis-.02});
    b.blok(0,-.05,.26,.24,.5,steen,{y:basis});
    b.kantelRing(0,-.05,basis+.5,.13,steen,{vierkant:true});
    b.vlag(0,-.05,basis+.5,.16,"#2F5D3A");
    b.poort(0,hw,Math.PI/2,.16,.2,steen,null);
    /* de droge gracht: een donkere ring om de muren */
    const g=b.grond(0,0);
    for(const [u,v,bx,bz] of [[0,-hw-.12,hw*2+.3,.07],[0,hw+.12,hw*2+.3,.07],[-hw-.12,0,.07,hw*2+.1],[hw+.12,0,.07,hw*2+.1]])
      b.blok(u,v,bx,bz,.004,"#4E5A3A",{y:g-.01,var:0});
    b.lamp(0,basis+.4,-.05);
  }},
  /* Noordam (Norgate) — het leen aan de noordgrens */
  noordam:{info:{vlak:[.5,1.1,1],open:1.0},bouw(B,b){ kasteel(B,b,"araluen",{maat:.7,steen:"#A9A497"}); stad(B,B.rond(b.cx+.9,b.cy+.5,.3,8),"araluen",{straal:.35,aantal:9,geenPlein:true}); }},
  /* Karwij (Caraway) — een leen met een eigen Krijgsschool */
  karwij:{info:{vlak:[.5,1.1,1],open:1.0},bouw(B,b){ kasteel(B,b,"araluen",{maat:.72,steen:"#BDB6A6"}); stad(B,B.rond(b.cx-.9,b.cy+.4,-.3,9),"araluen",{straal:.35,aantal:8,geenPlein:true}); }},
  /* Gorlan — Morgaraths kasteel, sinds zijn nederlaag een ruïne die de boeren
     mijden; en het toernooiveld waar het allemaal begon */
  gorlan:{info:{vlak:[.45,1,.8],open:1.2},bouw(B,b){
    ruine(B,b,"araluen",{maat:.85,steen:"#77736A",puin:"#6E6A60"});
    const c=B.rond(b.cx+.95,b.cy+.3,.2,5), g=c.grond(0,0);
    c.blok(0,0,.5,.24,.005,"#8E8A6A",{y:g-.002,var:0});
    for(const z of [-1,1])c.blok(0,z*.13,.5,.008,.02,"#5E4A38",{y:g});
  }},
  /* Zeeklif (Seacliff) — een klein eilandleen: Wills eerste standplaats */
  zeeklif:{info:{vlak:[.3,.7,.8],open:.8},bouw(B,b){
    kasteel(B,b,"araluen",{maat:.42,muurH:.1,steen:"#B3AD9E"});
    const a=B.zeeRichting(b.cx,b.cy,2); if(a!=null){ B.steiger(b,b.cx,b.cy,a,.35); B.vloot(b.cx,b.cy,a,"boot",2,11,{van:.4,tot:.6}); }
  }},
  /* De Vlakte van Uthal — waar het leger van Araluen de Wargals opving */
  uthal:{info:{open:1.4},bouw(B,b){ slagveld(B,b,"araluen",{tenten:8,vlaggen:["#2F5D3A","#8E2B2B","#E2D8BE"]}); }},
  /* De Heckingse Heide — het slagveld van de eerste oorlog: grafheuvels en
     een gedenksteen, waar Wills vader Daniel viel */
  heckingse:{info:{open:1.2},bouw(B,b){
    const g=b.voet(0,0,.05,.05);
    b.blok(0,0,.04,.03,.14,"#9A9585",{y:g-.02}); b.pir(0,0,g+.12,.04,.03,.03,"#9A9585");
    for(let i=0;i<5;i++){ const a=i/5*Math.PI*2+b.r(i), d=.3+b.r(i+9)*.2; const u=Math.cos(a)*d, v=Math.sin(a)*d; b.bol(u,v,b.grond(u,v)-.01,.07,"#7E8456",{h:.03}); }
    b.straal=.5;
  }},
  /* Het Grimsdell Woud — mistig en verwrongen: dode, kromme bomen tussen het naaldbos */
  grimsdell:{info:{},bouw(B,b){ for(let i=0;i<14;i++){ const a=b.r(i)*Math.PI*2, d=1+b.r(i+20)*5; b.boom(Math.cos(a)*d,Math.sin(a)*d,5,1.1); } b.straal=0; }},
  /* Het Open Veld van de Heler — Malcolms gehucht diep in Grimsdell, met het ven */
  healersclearing:{info:{vlak:[.25,.6,.5],open:.75},bouw(B,b){
    for(let i=0;i<7;i++){ const a=i/7*Math.PI*2+.3, d=.26+b.r(i)*.1; huisVan(B,b,"araluen",Math.cos(a)*d,Math.sin(a)*d,{r:a,maat:.75,nr:i,dak:"#8C7A52"}); }
    huisVan(B,b,"araluen",0,-.05,{maat:1.2,nr:20,dak:"#7A6A48"});
    b.plas(.18,.22,.09,.06,b.grond(.18,.22)+.003);
    b.straal=.45;
  }},
  /* De Grafheuvels — oeroude heuvels op een kale rug, waar het zou spoken */
  grafheuvels:{info:{open:.8},bouw(B,b){
    for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+b.r(i), d=.12+b.r(i+9)*.3; const u=Math.cos(a)*d, v=Math.sin(a)*d; b.bol(u,v,b.grond(u,v)-.015,.08+b.r(i+3)*.05,"#8E9462",{h:.03}); }
    for(let i=0;i<5;i++){ const a=i/5*Math.PI*2, u=Math.cos(a)*.42, v=Math.sin(a)*.42; b.blok(u,v,.025,.018,.05+b.r(i+30)*.03,"#8A877F",{r:a}); }
    b.straal=.5;
  }},
  /* Cresthaven — de baai waar de Reiger als plichtschip lag */
  cresthaven:{info:{vlak:[.3,.8,.6],open:1.2},bouw(B,b,p){
    haven(B,b,"araluen",p,{straal:.38,aantal:9,schepen:2,schip:["reiger","boot"]});
  }},
  /* Selsey — een vissersdorp aan de westkust, onder geen leen */
  selsey:{info:{vlak:[.3,.8,.6],open:1.1},bouw(B,b,p){ haven(B,b,"araluen",p,{straal:.42,aantal:12,schepen:3,schip:"boot"}); }},
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
    const c=B.rond(bx,by,langs+Math.PI/2,6), L=k.breed*1.6;
    const y=Math.max(c.grond(-L,0),c.grond(L,0))+.02;
    const n2=14;
    for(let i=0;i<n2;i++){
      const u=-L+(i+.5)*2*L/n2, t=i/n2;
      if(t>.5&&t<.68)continue;
      c.blok(u,0,2*L/n2*.9,.06,.01,t>.36&&t<.82?"#2E2620":"#6B5138",{y,var:.2});
    }
    for(const u of [-L*.95,-L*.3,L*.3,L*.95])c.cil(u,0,.007,y+.02-c.grond(u,0)+.02,"#4E3A28",{y:c.grond(u,0)-.02});
    b.straal=.35;
  }},
  /* De Driestappas — drie steile treden in de rots: wie hem houdt, sluit het gebergte af */
  driestappas:{info:{},bouw(B,b){
    for(let i=0;i<3;i++){ const u=(i-1)*.18; b.blok(u,0,.16,.22,.06+i*.05,"#8A8579",{r:.1,var:.12}); }
    for(let i=0;i<8;i++){ const u=(b.r(i)-.5)*.8, v=(b.r(i+9)-.5)*.6+(i%2?.25:-.25); b.rots(u,v,.04+b.r(i+20)*.04); }
    b.straal=.4;
  }},
  /* Morgaraths Hoogvlakte — het kale plateau waar de Wargals verzamelden */
  hoogvlakte:{info:{},bouw(B,b){
    for(let i=0;i<10;i++){ const a=b.r(i)*Math.PI*2, d=.2+b.r(i+5)*.6, u=Math.cos(a)*d, v=Math.sin(a)*d; b.tent(u,v,.045,.05,"#3E3830",{}); }
    b.vlag(0,0,b.grond(0,0),.25,"#1E1E22"); b.vlag(.2,.1,b.grond(.2,.1),.2,"#5A1E1E");
    b.straal=.8;
  }},
  /* De Veenlanden — drassig laagland: plassen en riet */
  veenlanden:{info:{},bouw(B,b){
    for(let i=0;i<9;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*4, u=Math.cos(a)*d, v=Math.sin(a)*d; if(b.land(u,v))b.plas(u,v,.1+b.r(i+9)*.15,.07+b.r(i+11)*.1,b.grond(u,v)+.006,{r:a,kleur:"#5E7E78"}); }
    b.straal=0;
  }},
  /* De Vlakte der Eenzamen — leeg en moerassig: een paar plassen en een dode boom */
  eenzamen:{info:{},bouw(B,b){
    for(let i=0;i<5;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*3, u=Math.cos(a)*d, v=Math.sin(a)*d; if(b.land(u,v))b.plas(u,v,.08+b.r(i+9)*.1,.06+b.r(i+11)*.06,b.grond(u,v)+.006,{r:a,kleur:"#62807A"}); }
    b.boom(.3,.2,5,1); b.boom(-1.2,.8,5,.9);
    b.straal=0;
  }},

  /* ---- Hibernia ---- */
  /* Dun Kilty — de hoofdstad van Clonmel, van koning Ferris: een ringfort
     (dun) met een woontoren en een slanke ronde toren */
  dunkilty:{info:{vlak:[.45,1,1],open:1.0},bouw(B,b){
    kasteel(B,b,"hibernia",{maat:.66});
    stad(B,B.rond(b.cx+.75,b.cy-.4,.4,12),"hibernia",{straal:.32,aantal:8,geenPlein:true});
  }},
  /* Craikennis — een dorp in Clonmel, verdedigd door Halt, Will en Arnaut */
  craikennis:{info:{vlak:[.35,.8,.6],open:1.0},bouw(B,b){
    stad(B,b,"hibernia",{straal:.45,aantal:14,rond:true});
    /* het lage stenen muurtje waarachter het dorp zich verdedigde */
    const pts=[]; for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; pts.push([Math.cos(a)*.55,Math.sin(a)*.55]); }
    b.ring(pts,.03,.02,"#9A988F",{kantelen:null,open:[2,8]});
  }},
  /* Mountshannon — het dorp dat níet betaalde: niets heel gelaten */
  mountshannon:{info:{vlak:[.3,.7,.5],open:.9},bouw(B,b){
    const kand=B.plekkenVoorHuizen(b,.4);
    let i=0;
    for(const [u,v] of kand.slice(0,9)){
      /* zwartgeblakerde muren zonder dak */
      const r=Math.round(Math.atan2(v,u)/(Math.PI/2))*(Math.PI/2), bx=.075, bz=.055, h=.02+b.r(i)*.03;
      for(const [du,dv,lu,lv] of [[0,-bz/2,bx,.008],[0,bz/2,bx,.008],[-bx/2,0,.008,bz],[bx/2,0,.008,bz]]){
        if(b.r(i*4+du*99)<.25)continue;
        b.blok(u+du*Math.cos(r)-dv*Math.sin(r),v+du*Math.sin(r)+dv*Math.cos(r),lu,lv,h,"#4A4642",{r,var:.25});
      }
      b.rots(u,v,.02,"#2E2A26",{plat:.4}); i++;
    }
    b.straal=.45;
  }},
  /* Port Cael — een smokkelaarshaven van Black O'Malley */
  portcael:{info:{vlak:[.3,.8,.6],open:1.0},bouw(B,b,p){ haven(B,b,"hibernia",p,{straal:.42,aantal:11,schepen:2,schip:["kogge","boot"],vloot:{zeil:"#3A3A3A"}}); }},
  /* De Mull van Linkeith — de landtong waar Tennyson aan land werd gezet:
     een strand, een broch op de kaap en het smokkelschip voor de kust */
  mulllinkeith:{info:{vlak:[.3,.7,.6],open:.8},bouw(B,b,p){
    const a=B.zeeRichting(b.cx,b.cy,2.5);
    kasteel(B,b,"picta",{});
    if(a!=null)B.vloot(b.cx,b.cy,a,"kogge",1,21,{van:.8,tot:.8,zeil:"#3A3A3A"});
  }},

  /* ---- Skandia ---- */
  /* Hallasholm — de hoofdstad aan de Stormwitte Zee: een houten Grote Zaal,
     een haven vol wolfschepen en een strand waar de Broederbandtraining
     begint */
  hallasholm:{info:{vlak:[.55,1.3,.7],open:1.8},bouw(B,b){
    const a=B.zeeRichting(b.cx,b.cy,2.5)??Math.PI/2;
    const t=B.waterlijn(b.cx,b.cy,a);
    /* het midden ligt een eindje van de waterlijn: daartussen het strand */
    const mx=b.cx+Math.cos(a)*(t-.75), my=b.cy+Math.sin(a)*(t-.75);
    const c=B.rond(mx,my,a+Math.PI/2,31);
    /* de Grote Zaal: lang, hoog, van hout, met gekruiste drakenkoppen op de
       nokken en een trap ervoor */
    const g=c.voet(0,0,.25,.1);
    c.blok(0,0,.5,.2,.03,"#8C8478",{y:g-.03});
    c.blok(0,0,.46,.15,.085,"#8A6A48",{y:g});
    c.zadel(0,0,g+.08,.5,.22,.13,"#5A4834");
    for(const u of [-.25,.25])for(const rz of [.55,-.55])c.stuk("vast",B.S.blok,u,g+.19,0,.006,.06,.025,0,"#4A3828",{rz});
    c.blok(0,-.11,.08,.04,.015,"#8C8478",{y:g-.01});
    c.lamp(0,g+.22,0); c.lamp(.14,g+.11,-.08); c.lamp(-.14,g+.11,-.08);
    c.vlag(.27,-.06,g,.24,"#8E2B2B");
    /* de langhuizen: in rijen achter de zaal, evenwijdig aan de kust */
    B.stadje(c,"skandia",{straal:.78,aantal:24,stap:.17,richting:0,los:.18,maat:.85,
      weg:(u,v)=>(Math.abs(u)<.34&&Math.abs(v)<.16)||v<-.38});
    /* het strand, met wolfschepen op het zand getrokken (de boeg naar het land) */
    for(let i=0;i<4;i++){
      const u=-.6+i*.36; let v=-.3;
      while(v>-1.4&&c.land(u,v-.04))v-=.04;
      if(v<=-1.4)continue;
      const [x,y]=c.w(u,v+.1);
      B.schip("wolf",x,y,a+Math.PI+(c.r(i)-.5)*.25,40+i,{maat:.85});
    }
    B.steiger(c,mx,my,a,.75);
    B.vloot(mx,my,a,"wolf",5,51,{richting:a+Math.PI/2,van:1,tot:1.4,ruimte:.38});
    b.top=c.top; b.straal=1;
  }},
  /* De jachthut in het hoogland — waar Will en Evanlyn de winter doorkwamen */
  berghut:{info:{vlak:[.12,.3,.6],open:.25},bouw(B,b){
    const top=b.blok(0,0,.08,.055,.04,"#5E4630");
    b.zadel(0,0,top-.002,.09,.075,.04,"#4A3A2A");
    b.blok(.035,0,.014,.014,.075,"#7E786C");
    b.blok(-.07,.01,.04,.025,.02,"#6B5138",{r:.3});   /* houtstapel */
    b.lamp(0,top+.03,0);
    b.straal=.15;
  }},
  /* De bergpas boven Hallasholm — waar Skandiërs en Araluanen samen de
     Temujai tegenhielden: een wal dwars door de pas, puntpalen, vlaggen */
  pas:{info:{open:.8},bouw(B,b){
    b.muur(-.5,0,.5,0,.06,.05,"#7E786C",{kantelen:null});
    for(let i=0;i<14;i++){ const u=-.6+i*.09, v=-.18-b.r(i)*.06; b.stuk("vast",B.S.kegel6,u,b.grond(u,v)-.01,v,.008,.07,.008,0,"#5E4A38",{rx:-.5}); }
    for(let i=0;i<3;i++)b.vlag(-.3+i*.3,.06,b.grond(-.3+i*.3,.06),.18,"#8E2B2B");
    for(let i=0;i<6;i++){ const a=b.r(i+30)*Math.PI, u=Math.cos(a)*.5, v=-.6-Math.sin(a)*.3; b.tent(u,v,.035,.045,"#B8A888",{}); }
    b.straal=.6;
  }},
  /* Limmat — een welvarende handelsstad die leeft van haar smaragdmijn;
     Zavac en de Raaf vielen haar aan */
  limmat:{info:{vlak:[.45,1,.7],open:1.2},bouw(B,b,p){
    haven(B,b,"teutlandt",p,{straal:.55,aantal:18,schepen:2,schip:["kogge","wolf"]});
    /* de stadsmuur aan de landkant */
    const pts=[]; for(let i=0;i<10;i++){ const a=i/10*Math.PI*2; pts.push([Math.cos(a)*.7,Math.sin(a)*.7]); }
    for(let i=0;i<pts.length;i++){ const [u,v]=pts[i], [u2,v2]=pts[(i+1)%pts.length]; if(b.land(u,v)&&b.land(u2,v2))b.muur(u,v,u2,v2,.1,.035,"#A9A193",{}); }
    for(const [u,v] of pts)if(b.land(u,v))b.toren(u,v,.04,.15,"#A9A193",{dak:"kegel",dakKleur:"#7E3326",dakH:.08});
    /* de mijn: een donkere ingang in de heuvel, met een houten bok erboven */
    const m=B.rond(b.cx+1.2,b.cy-.6,.5,13), g=m.grond(0,0);
    m.blok(0,0,.05,.03,.04,"#1E1A16",{y:g-.01});
    for(const u of [-.03,.03])m.cil(u,.03,.005,.12,"#5E4A38",{zes:true});
    m.blok(0,.03,.07,.01,.01,"#5E4A38",{y:g+.11});
  }},
  /* Skorghijl — een kaal, mistig rotseiland met een beschutte kraterhaven */
  skorghijl:{info:{},bouw(B,b){ B.vloot(b.cx,b.cy,0,"wolf",3,61,{van:1.5,tot:4,spreid:6.3}); b.straal=0; }},

  /* ---- Gallica ---- */
  /* La Rivage — de havenstad waar Halt en Arnaut aan land gingen */
  larivage:{info:{vlak:[.4,.9,.7],open:1.1},bouw(B,b,p){ haven(B,b,"gallica",p,{straal:.55,aantal:20,schepen:3,schip:"kogge",tweedeSteiger:true}); }},
  /* Les Sourges — een rivierstadje met een houten brug en een veerpont */
  lessourges:{info:{vlak:[.35,.8,.6],open:1.1},bouw(B,b){
    stad(B,b,"gallica",{straal:.48,aantal:14,weg:(u,v)=>rivierBij(B,b,u,v)});
    brugOver(B,b,"#6B5138");
  }},
  /* Château Montsombre — het zwarte kasteel van Deparnieux, die zijn
     gevangenen in kooien langs de weg liet sterven */
  montsombre:{info:{vlak:[.5,1.2,1],open:1.4},bouw(B,b){
    const zwart="#3B3836", dak="#26262A";
    kasteel(B,b,"gallica",{steen:zwart,dak,maat:.7,vlag:"#1E1E22"});
    /* de kooien: palen met een kooi eraan, langs de weg naar de poort */
    for(let i=0;i<7;i++){
      const v=.5+i*.16, u=(i%2?.1:-.1);
      const g=b.grond(u,v);
      b.cil(u,v,.005,.13,"#3E2E20",{zes:true});
      b.blok(u+(i%2?.03:-.03),v,.035,.035,.045,"#2A2A2A",{y:g+.06,var:0});
    }
    b.lamp(0,b.top-.1,0);
  }},
  /* Château La Lumière — de hoofdstad van koning Philippe: ondanks de naam
     een zwaar bewapende vesting, met de stad eromheen */
  lalumiere:{info:{vlak:[.6,1.4,1],open:1.6},bouw(B,b){
    kasteel(B,b,"gallica",{maat:.82,muurH:.17,steen:"#E6DCC6",vlag:"#2B4C7E"});
    /* een tweede, lagere ringmuur met torens */
    const hw=.62, pts=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]];
    b.ring(pts,.1,.035,"#DDD2BA",{open:[2]});
    for(const [u,v] of pts)b.toren(u,v,.05,.17,"#DDD2BA",{dak:"kegel",dakKleur:"#4A5460",dakH:.14});
    stad(B,B.rond(b.cx+1.1,b.cy+.6,.4,14),"gallica",{straal:.45,aantal:16,geenPlein:true});
  }},
  /* Château des Falaises — het kustbolwerk van baron Joubert */
  falaises:{info:{vlak:[.5,1.1,1],open:1.2},bouw(B,b){ kasteel(B,b,"gallica",{maat:.72,muurH:.18,steen:"#CFC6B2",vlag:"#5A1E1E"}); }},

  /* ---- Arrida ---- */
  /* Tabork — havenstad aan de Arridische kust */
  tabork:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){ haven(B,b,"arrida",p,{straal:.6,aantal:22,schepen:3,steiger:1.2}); palmen(B,b,8,.9); }},
  /* Socorro — de havenstad van de slavenmarkt */
  socorro:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){
    haven(B,b,"arrida",p,{straal:.6,aantal:22,schepen:3});
    /* de markt: een open plein met een verhoogd podium */
    const g=b.grond(0,0); b.blok(0,0,.14,.1,.025,"#B89A6A",{y:g-.01});
    palmen(B,b,6,.9);
  }},
  /* Al Shabah — de stad van wakir Selethen: ommuurd, met een fort */
  alshabah:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){ woestijnstad(B,b,{straal:.55,aantal:22,kasba:true}); }},
  /* Mararoc — de hoofdstad van Arrida, waar de emir zetelt */
  mararoc:{info:{vlak:[.6,1.3,.8],open:1},bouw(B,b){
    woestijnstad(B,b,{straal:.75,aantal:32});
    /* het paleis van de emir: koepels en minaretten */
    const g=b.voet(0,-.1,.15,.12);
    b.blok(0,-.1,.3,.22,.12,"#F2EDE0",{y:g-.02});
    b.koepel(0,-.1,g+.1,.1,.12,"#3E8C84");
    for(const u of [-.13,.13])b.koepel(u,-.1,g+.1,.04,.05,"#3E8C84");
    for(const [u,v] of [[-.18,-.22],[.18,-.22],[-.18,.02],[.18,.02]])b.toren(u,v,.016,.34,"#F2EDE0",{dak:"koepel",dakKleur:"#3E8C84",y:g});
    b.lamp(0,g+.2,-.1);
  }},
  /* Maashava — de ommuurde stad van de Tualaghi, de blauwgesluierde rovers */
  maashava:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){ woestijnstad(B,b,{straal:.55,aantal:24,kasba:true,muur:"#B8956A",hoog:.14}); }},
  /* Schorpioenberg — het rotsheiligdom van de Schorpioensekte */
  schorpioenberg:{info:{},bouw(B,b){
    for(let i=0;i<16;i++){ const a=b.r(i)*Math.PI*2, d=b.r(i+5)*.5, u=Math.cos(a)*d, v=Math.sin(a)*d; b.rots(u,v,.08+b.r(i+9)*.1,"#9A7E5E",{plat:1.1}); }
    /* de gevel van de tempel, in de rots uitgehouwen */
    const g=b.grond(0,.55);
    b.blok(0,.55,.22,.04,.14,"#B8996E",{y:g-.02});
    for(let i=0;i<4;i++)b.cil(-.075+i*.05,.585,.008,.1,"#C9AA7E",{zes:true,y:g});
    b.blok(0,.58,.04,.01,.06,"#1E1814",{y:g,var:0});
    b.pir(0,.55,g+.12,.24,.05,.04,"#B8996E");
    b.straal=.6;
  }},
  /* Het gebied van de Bedullin — nomaden met zwarte tenten en snelle paarden */
  bedullin:{info:{},bouw(B,b){
    for(let i=0;i<9;i++){ const a=i/9*Math.PI*2+b.r(i), d=.25+b.r(i+5)*.35, u=Math.cos(a)*d, v=Math.sin(a)*d; b.tent(u,v,.05,.035,"#2E2824",{nok:true,r:a}); }
    b.cil(0,0,.02,.02,"#9A8A6A");
    palmen(B,b,5,.5);
    b.straal=.7;
  }},

  /* ---- Nihon-Ja ---- */
  /* Ito — de hoofdstad met het winterpaleis van keizer Shigeru */
  ito:{info:{vlak:[.8,1.8,1],open:1.6},bouw(B,b){
    kasteel(B,b,"nihon-ja",{maat:.78});
    /* de gracht, in stukjes op de grond */
    for(let i=0;i<24;i++){ const z=i%4, t=(Math.floor(i/4)+.5)/6-.5, u=z<2?t*1.1:(z===2?-.52:.52), v=z<2?(z?.52:-.52):t*1.1;
      b.plas(u,v,z<2?.1:.04,z<2?.04:.1,b.grond(u,v)+.006); }
    stad(B,B.rond(b.cx+1.2,b.cy+.6,.2,17),"nihon-ja",{straal:.5,aantal:16});
  }},
  /* Iwanai — de haven waar het gezelschap op zoek naar Arnaut aan land ging */
  iwanai:{info:{vlak:[.4,.9,.7],open:1.1},bouw(B,b,p){ haven(B,b,"nihon-ja",p,{straal:.5,aantal:16,schepen:3,steiger:1}); torii(B,b,.0,.55); }},
  /* Ran-Koshi — een vergeten vesting in een bergdal, met een smalle toegang
     tussen steile rotswanden */
  rankoshi:{info:{vlak:[.4,.9,.8],open:1},bouw(B,b){
    /* een hoge houten palissade dwars door het dal, met een poorttoren */
    for(let i=0;i<22;i++){ const u=-.55+i*.05; b.cil(u,.3,.013,.15,"#5E4A38",{zes:true}); }
    b.muur(-.55,.3,.55,.3,.12,.025,"#5E4A38",{kantelen:null});
    b.toren(0,.3,.05,.2,"#6B5642",{vierkant:true,dak:"pagode",dakKleur:"#3E4448",lagen:1});
    for(let i=0;i<5;i++){ const u=-.3+i*.15; B.huis(b,u,-.05,"nihon-ja",{nr:i,r:0,maat:1.1}); }
    b.blok(0,-.25,.22,.14,.08,"#EDE8DC");
    b.pagode(0,-.25,b.grond(0,-.25)+.08,.3,.2,.08,"#3E4448");
    b.straal=.6;
  }},
  /* Het Zomerpaleis — hout en papier, licht en open, met schuifwanden en tuinen */
  zomerpaleis:{info:{vlak:[.5,1.1,1],open:1.3},bouw(B,b){
    const g=b.voet(0,0,.3,.2);
    for(const [u,v,bx,bz] of [[0,0,.36,.2],[-.3,.12,.18,.14],[.3,.12,.18,.14]]){
      b.blok(u,v,bx,bz,.012,"#9C978C",{y:g-.01});
      b.blok(u,v,bx*.9,bz*.85,.05,"#F2EEE4",{y:g});
      b.pagode(u,v,g+.048,bx*1.3,bz*1.45,.07,"#4E4A44");
      b.lamp(u,g+.08,v);
    }
    /* de tuin met een vijver en een brugje */
    b.plas(0,.38,.18,.1,b.grond(0,.38)+.004);
    b.blok(0,.38,.04,.24,.012,"#A0302A",{y:b.grond(0,.38)+.01});
    for(let i=0;i<6;i++){ const a=b.r(i)*Math.PI*2; b.boom(Math.cos(a)*.55,Math.sin(a)*.4+.2,6,.7); }
    b.straal=.6;
  }},
  /* Kawagishi — een vissersdorp waar de boten op het strand liggen en het hout
     uit het bergland wordt verscheept */
  kawagishi:{info:{vlak:[.35,.8,.6],open:1},bouw(B,b,p){
    haven(B,b,"nihon-ja",p,{straal:.45,aantal:13,schepen:3,schip:"boot"});
    for(let i=0;i<4;i++)b.blok(.3+i*.03,-.3,.02,.14,.02,"#8A6E50",{r:.1});   /* stapels stammen */
  }},
  /* Mizu Umi Bakudai — het uitgestrekte bergmeer (zie het meer in 3d-grond.js) */
  "mizu-umi-bakudai":{info:{meer:{r:5.5,diepte:.5}},bouw(B,b){ b.straal=0; }},

  /* ---- Toscana ---- */
  /* Raguza — een wetteloze havenstad, bestuurd door piratenkapiteins; schepen
     betalen tien procent tol */
  raguza:{info:{vlak:[.45,1,.7],open:1},bouw(B,b,p){
    haven(B,b,"toscana",p,{straal:.62,aantal:26,schepen:5,schip:["galei","kogge"],vloot:{zeil:"#3A3530"},tweedeSteiger:true});
    const a=B.zeeRichting(b.cx,b.cy,2.2);
    if(a!=null){ const t=B.waterlijn(b.cx,b.cy,a), c=B.rond(b.cx+Math.cos(a)*t,b.cy+Math.sin(a)*t,a,4); c.toren(-.05,.45,.05,.3,"#D8C9A8",{vierkant:true,dak:"plat"}); }
  }},
  /* Krall — een nederzetting aan de bovenloop van de Dan */
  krall:{info:{vlak:[.3,.8,.6],open:1},bouw(B,b,p){ haven(B,b,"toscana",p,{straal:.38,aantal:10,schepen:1,schip:"boot"}); }},
  /* Bayrath — een grote stad, bijna een metropool, aan de Dan; de corrupte
     Gatmeister liet de Reigers gevangenzetten */
  bayrath:{info:{vlak:[.7,1.5,.8],open:1.4},bouw(B,b){
    stad(B,b,"toscana",{straal:.85,aantal:44,stap:.12});
    const pts=[]; for(let i=0;i<14;i++){ const a=i/14*Math.PI*2; pts.push([Math.cos(a)*.98,Math.sin(a)*.98]); }
    b.ring(pts,.12,.035,"#CDBB96",{kantelen:"zwaluw",open:[3,10]});
    for(const [u,v] of pts.filter((_,i)=>i%2===0))b.toren(u,v,.045,.18,"#CDBB96",{vierkant:true,dak:"plat"});
    /* het stadhuis van de Gatmeister, met een belforttoren */
    const g=b.voet(.15,.1,.1,.08);
    b.blok(.15,.1,.2,.14,.13,"#E8DCC0",{y:g-.02});
    b.schild(.15,.1,g+.11,.22,.16,.05,"#B5562F");
    b.toren(.28,.1,.03,.42,"#E8DCC0",{vierkant:true,dak:"kegel",dakKleur:"#B5562F",dakH:.08,vlag:"#C9A94A"});
  }},
  /* Byzantos — een jonge stadstaat aan de Gouden Reikwijdte, aan drie kanten
     door water beschermd en met dikke muren */
  byzantos:{info:{vlak:[.6,1.3,.8],open:1.2},bouw(B,b,p){
    haven(B,b,"helleno",p,{straal:.72,aantal:34,schepen:4,schip:"galei",plein:[.05,-.3]});
    const a=B.zeeRichting(b.cx,b.cy,2.2)??0;
    const t=B.waterlijn(b.cx,b.cy,a), c=B.rond(b.cx+Math.cos(a)*(t-.45),b.cy+Math.sin(a)*(t-.45),a+Math.PI/2,8);
    /* de dikke landmuur, met torens */
    c.muur(-.85,-.75,.85,-.75,.16,.06,"#D8CFBC",{kantelen:"blok"});
    for(let i=0;i<5;i++)c.toren(-.85+i*.425,-.75,.06,.24,"#D8CFBC",{vierkant:true,dak:"plat"});
    /* de grote koepelkerk van de keizerin */
    const g=c.voet(0,-.3,.12,.12);
    c.blok(0,-.3,.24,.24,.12,"#EDE6D6",{y:g-.02});
    c.koepel(0,-.3,g+.11,.12,.12,"#B8A07A");
    for(const [u,v] of [[-.12,-.42],[.12,-.42],[-.12,-.18],[.12,-.18]])c.koepel(u,v,g+.1,.04,.04,"#B8A07A");
    c.lamp(0,g+.18,-.3);
  }},
  /* Sorato — een vallei in het noorden van Toscana, waar Will en Maddie de
     Temujai in een hinderlaag lieten lopen */
  sorato:{info:{vlak:[.3,.8,.6],open:1},bouw(B,b){
    stad(B,b,"toscana",{straal:.4,aantal:10,geenPlein:true});
    b.toren(.2,-.2,.04,.3,"#D8C9A8",{vierkant:true,dak:"plat",vlag:"#8E2B2B"});
    for(let i=0;i<10;i++){ const u=-.6+i*.12; b.stuk("vast",B.S.kegel6,u,b.grond(u,.6)-.01,.6,.008,.06,.008,0,"#5E4A38",{rx:.5}); }
  }},
  /* Genovesa — een Toscaanse stadstaat, berucht om zijn huurmoordenaars: een
     stad van hoge woontorens */
  genovesa:{info:{vlak:[.5,1.1,.8],open:1.1},bouw(B,b,p){
    haven(B,b,"toscana",p,{straal:.6,aantal:24,schepen:2,schip:"galei"});
    const a=B.zeeRichting(b.cx,b.cy,2.2)??0, t=B.waterlijn(b.cx,b.cy,a);
    const c=B.rond(b.cx+Math.cos(a)*(t-.5),b.cy+Math.sin(a)*(t-.5),a,19);
    for(let i=0;i<9;i++){ const u=(c.r(i)-.5)*.7, v=-(c.r(i+9))*.5; if(c.land(u,v))c.toren(u,v,.025,.22+c.r(i+20)*.18,"#D9C49C",{vierkant:true,dak:"plat"}); }
  }},
  /* Palladio — een grote kuststad in het zuiden van Toscana */
  palladio:{info:{vlak:[.55,1.2,.7],open:1.1},bouw(B,b,p){
    haven(B,b,"toscana",p,{straal:.7,aantal:32,schepen:3,schip:["galei","kogge"]});
    const a=B.zeeRichting(b.cx,b.cy,2.2)??0, t=B.waterlijn(b.cx,b.cy,a);
    const c=B.rond(b.cx+Math.cos(a)*(t-.55),b.cy+Math.sin(a)*(t-.55),a,23);
    const g=c.voet(-.2,0,.08,.08);
    c.blok(-.2,0,.16,.12,.1,"#EDE0C4",{y:g-.02}); c.koepel(-.2,0,g+.09,.06,.08,"#B5562F");
    c.toren(-.2,.12,.025,.3,"#EDE0C4",{vierkant:true,dak:"kegel",dakKleur:"#B5562F",dakH:.06});
  }},
  /* Rovo — de hoofdstad van het oude Rovo-rijk (keizer Coltonus de Grote):
     een tempel met losse zuilen, een half ingestort amfitheater, een stuk
     aquaduct */
  rovo:{info:{vlak:[.5,1.1,.8],open:1},bouw(B,b){
    const marmer="#DCD6C6", g=b.voet(0,0,.2,.2);
    /* de tempel */
    b.blok(-.3,0,.3,.18,.03,marmer,{y:g-.02});
    for(let i=0;i<6;i++)for(const z of [-1,1]){ if(b.r(i*3+z)<.25)continue; b.cil(-.42+i*.048,z*.07,.011,.11+(b.r(i+z*7)<.3?-.05:0),marmer,{y:g+.01}); }
    b.blok(-.36,0,.17,.17,.02,marmer,{y:g+.12});
    /* het amfitheater: een ovale ring van bogen, aan één kant ingestort */
    const n=22;
    for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2, u=.25+Math.cos(a)*.26, v=Math.sin(a)*.2;
      const h=(a>2.2&&a<3.6)?.03+b.r(i)*.03:.11;
      b.blok(u,v,.07,.03,h,"#CFC6B0",{r:a+Math.PI/2,var:.12});
    }
    /* het aquaduct */
    for(let i=0;i<7;i++){ const u=-.6+i*.11; b.blok(u,-.45,.025,.025,.12,marmer,{}); }
    b.blok(-.27,-.45,.69,.03,.02,marmer,{y:b.grond(-.27,-.45)+.12});
    for(let i=0;i<10;i++){ const u=(b.r(i+40)-.5)*1.1, v=(b.r(i+60)-.5)*.9; b.rots(u,v,.02,"#C9C2B0"); }
    for(let i=0;i<5;i++)b.boom(-.7+i*.32,.5,7,.9);
    b.straal=.75;
  }},
  /* Santorillos — een vulkaaneiland met een bijna onneembare vesting op de
     rand van een uitgedoofde krater; de schuilplaats van de kaper Myrgos */
  santorina:{info:{vlak:[.35,.8,.7],open:1},bouw(B,b){
    kasteel(B,b,"helleno",{maat:.5,muurH:.15,steen:"#E6E1D4",soort:"toscana",kantelen:"blok",vlag:"#1E1E22"});
    stad(B,B.rond(b.cx-.6,b.cy+.4,0,27),"helleno",{straal:.35,aantal:10,geenPlein:true});
    B.vloot(b.cx,b.cy,0,"galei",1,77,{spreid:6.3,van:1,tot:1.2,zeil:"#2A2A2A"});
  }},

  /* ---- Indus ---- */
  /* Indus — het meest oostelijke land van de Silasische Raad */
  "indus-haven":{info:{vlak:[.5,1.1,.7],open:1.1},bouw(B,b,p){
    haven(B,b,"indus",p,{straal:.6,aantal:24,schepen:3,steiger:1});
    const a=B.zeeRichting(b.cx,b.cy,2.5)??0, t=B.waterlijn(b.cx,b.cy,a);
    const c=B.rond(b.cx+Math.cos(a)*(t-.5),b.cy+Math.sin(a)*(t-.5),a,29);
    const g=c.voet(-.25,0,.1,.1);
    c.blok(-.25,0,.2,.2,.08,"#EADBC8",{y:g-.02}); c.ui(-.25,0,g+.07,.07,.13,"#EDE5D6");
    for(const [u,v] of [[-.33,-.08],[-.17,-.08],[-.33,.08],[-.17,.08]])c.ui(u,v,g+.07,.025,.05,"#EDE5D6");
    palmen(B,c,8,.8);
  }}
};

/* ---- kleine onderdelen die meer dan eens terugkomen ---- */
function huisVan(B,b,stijl,u,v,o){ return B.huis(b,u,v,stijl,o); }
function palmen(B,b,n,R){ for(let i=0;i<n;i++){ const a=b.r(i+70)*Math.PI*2, d=R*(.6+b.r(i+80)*.6); b.boom(Math.cos(a)*d,Math.sin(a)*d,4,.95); } }
function torii(B,b,u,v){
  const g=b.grond(u,v);
  for(const z of [-.04,.04])b.cil(u+z,v,.006,.07,"#B8302A",{zes:true,y:g});
  b.blok(u,v,.11,.012,.01,"#2A2A2A",{y:g+.07}); b.blok(u,v,.09,.01,.008,"#B8302A",{y:g+.055});
}
/* een woestijnstad: lemen huizen met platte daken binnen een muur met
   driehoekige kantelen, palmen, en een kasba als dat er is */
function woestijnstad(B,b,o){
  stad(B,b,"arrida",{straal:o.straal,aantal:o.aantal,stap:.11,los:.1});
  const R=o.straal+.12, pts=[]; for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; pts.push([Math.cos(a)*R,Math.sin(a)*R]); }
  const muur=o.muur||"#C8AC7A";
  b.ring(pts,o.hoog||.1,.04,muur,{kantelen:"driehoek",open:[0]});
  for(const [u,v] of pts.filter((_,i)=>i%3===0))b.toren(u,v,.05,(o.hoog||.1)+.07,muur,{vierkant:true,dak:"plat"});
  if(o.kasba){ const c=B.rond(b.cx+R*.5,b.cy-R*.4,0,33); kasteel(B,c,"arrida",{maat:.36,muurH:.12,steen:muur}); b.top=Math.max(b.top,c.top); }
  palmen(B,b,10,R*1.25);
  b.straal=R+.1;
}
/* bij de rivier? (dan geen huis) */
function rivierBij(B,b,u,v){ const [x,y]=b.w(u,v); return B.rivierOp?B.rivierOp(x,y)>40:false; }
/* een brug over de rivier die het dichtst bij het midden langs loopt */
function brugOver(B,b,kleur){
  if(!B.rivierOp)return;
  let best=null;
  for(let i=0;i<30;i++){ const a=i/30*Math.PI*2; for(let d=.05;d<.9;d+=.05){ const [x,y]=b.w(Math.cos(a)*d,Math.sin(a)*d); if(B.rivierOp(x,y)>100){ if(!best||d<best.d)best={a,d,x,y}; break; } } }
  if(!best)return;
  /* de richting van de rivier: waar het water verder loopt */
  let ra=0, rb=-1;
  for(let i=0;i<16;i++){ const a=i/16*Math.PI; const w=B.rivierOp(best.x+Math.cos(a)*.25,best.y+Math.sin(a)*.25)+B.rivierOp(best.x-Math.cos(a)*.25,best.y-Math.sin(a)*.25); if(w>rb){rb=w;ra=a;} }
  const c=B.rond(best.x,best.y,ra+Math.PI/2,37), g=c.grond(0,0)+.04;
  c.blok(0,0,.32,.05,.012,kleur,{y:g});
  for(const u of [-.12,0,.12])c.cil(u,0,.008,.08,"#4E3A28",{y:g-.07});
  /* de veerpont, een eindje stroomafwaarts */
  const [fx,fy]=[best.x+Math.cos(ra)*.45,best.y+Math.sin(ra)*.45];
  const f=B.rond(fx,fy,ra,38); f.blok(0,0,.08,.05,.01,"#7A5E44",{y:f.grond(0,0)+.01});
}

/* ======================= de standaard per soort ======================= */
export const SOORTEN={
  kasteel:{info:{vlak:[.5,1.1,1],open:1.1},bouw(B,b,p,stijl){ kasteel(B,b,stijl,{}); }},
  stad:{info:{vlak:[.45,1,.8],open:1.2},bouw(B,b,p,stijl){ if(stijl==="arrida")woestijnstad(B,b,{straal:.5,aantal:20}); else stad(B,b,stijl,{}); }},
  haven:{info:{vlak:[.45,1,.7],open:1.1},bouw(B,b,p,stijl){ haven(B,b,stijl,p,{}); }},
  ruine:{info:{vlak:[.4,.9,.8],open:.9},bouw(B,b,p,stijl){ ruine(B,b,stijl,{}); }},
  slagveld:{info:{open:1.2},bouw(B,b,p,stijl){ slagveld(B,b,stijl,{}); }}
};
export const stijlVan=gebied=>STIJL_VAN[gebied]||"araluen";
/* wat de grond moet doen rond deze plaats (voor 3d-grond.js) */
export function modelInfo(p){ return (BOUWERS[p.id]||SOORTEN[p.soort]||{}).info||{}; }

/* ======================= alles bouwen =======================
   omg: X, Z, yOp, hNorm, opLand, hash2, rivierOp, en de plaatsen. Geeft de
   vormen terug (stevig, doek, schepen, water), de lampjes, de losse bomen,
   en per plaats de hoogte van zijn top (voor het naambordje) en zijn straal. */
export function bouwModellen(omg){
  const B=maakBouwer(omg);
  B.rivierOp=omg.rivierOp; B.kloven=omg.kloven;
  const boven={}, plekken=[];
  for(const p of omg.PLAATSEN){
    const pos=omg.POS[p.id]; if(!pos)continue;
    const def=BOUWERS[p.id]||SOORTEN[p.soort];
    const [cx,cy]=pos;
    const rot=def&&def.draai?def.draai(omg.POS):omg.hash2((cx*131)|0,(cy*71)|0)*Math.PI*2;
    const b=B.rond(cx,cy,rot,p.id.length*13);
    b.top=Math.max(omg.yOp(cx,cy),0)+.18;
    if(def){
      try{ def.bouw(B,b,p,stijlVan(p.gebied)); }
      catch(e){ console.warn("3D-model van",p.id,e); }
    }else b.straal=0;
    boven[p.id]=b.top+.06;
    if(b.straal)plekken.push([cx,cy,b.straal]);
  }
  return {vast:B.bakken.vast.geo(),doek:B.bakken.doek.geo(),schepen:B.bakken.schip.geo(),plas:B.bakken.plas.geo(),
    lampjes:new Float32Array(B.lampjes),bomen:B.bomen,boven,plekken};
}
