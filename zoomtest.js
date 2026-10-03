new Promise(function(res){
  var uit=[];
  var boeken=['1','2','5','7','10'];
  var i=0;
  function volgende(){
    if(i>=boeken.length){ res(JSON.stringify(uit,null,1)); return; }
    var nr=boeken[i++];
    var b=[...document.querySelectorAll('button')].find(function(x){return x.textContent.trim()===nr;});
    if(!b){ uit.push({boek:nr,fout:'geen knop'}); return volgende(); }
    b.click();
    setTimeout(function(){
      var svg=document.querySelector('svg');
      var vb=svg.viewBox.baseVal;
      // lees de huidige zoom uit de wereldtransform
      var w=document.querySelector('#world')||svg.querySelector('g');
      var tr=w.getAttribute('transform')||'';
      var m=tr.match(/scale\(([\d.]+)\)/);
      uit.push({boek:nr, transform:tr.slice(0,60), zoom:m?+m[1]:null});
      volgende();
    },1400);
  }
  volgende();
})
