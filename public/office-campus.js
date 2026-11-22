/* Virtual Office campus artwork. Procedural pixel art; extends the MIT scene engine. */
(function () {
  'use strict';
  const O=window.MDOffice, T=16, ink='#302c37';
  const rect=(g,x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
  const box=(g,x,y,w,h,c,edge=ink)=>{rect(g,x,y,w,h,edge);rect(g,x+1,y+1,w-2,h-2,c);};
  const shadow=(g,x,y,w,h)=>rect(g,x+2,y+3,w,h,'#302c3730');
  function seed(n){return ()=>{n=(Math.imul(n,1664525)+1013904223)|0;return (n>>>0)/4294967296;};}
  // Source rectangles point into the user-supplied reference, kept unchanged on disk.
  function stamp(g,src,x,y,w,h){g.imageSmoothingEnabled=false;g.drawImage(O.campusArt,...src,Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  function fit(g,src,x,y,w,h){const scale=Math.min(w/src[2],h/src[3]);const dw=src[2]*scale,dh=src[3]*scale;stamp(g,src,x+(w-dw)/2,y+h-dh,dw,dh);}
  function texture(g,src,x,y,w,h,scale=1/3){const tw=src[2]*scale,th=src[3]*scale;g.save();g.beginPath();g.rect(x,y,w,h);g.clip();for(let yy=y;yy<y+h;yy+=th)for(let xx=x;xx<x+w;xx+=tw)stamp(g,src,xx,yy,tw,th);g.restore();}
  function grass(g,x,y,w,h){texture(g,[100,2,120,48],x,y,w,h);}
  function plant(g,x,y){fit(g,[465,114,77,100],x-4,y-22,25,34);}
  function cup(g,x,y){box(g,x,y,5,6,'#f9f1df');rect(g,x+1,y+1,3,1,'#8b6044');box(g,x+4,y+1,3,3,'#fff');}
  function pizza(g,x,y){box(g,x,y,14,13,'#f4e4b5');box(g,x+2,y+2,10,9,'#fff8e3','#bfa77e');for(let i=0;i<6;i++)rect(g,x+3+(i%3)*3,y+3+Math.floor(i/3)*4,2,3,'#d64b3c');}
  function screen(g,x,y,on=true){box(g,x,y,15,10,'#414659');rect(g,x+2,y+2,11,6,on?'#748dcc':'#303442');if(on){rect(g,x+3,y+3,8,1,'#afc4ec');rect(g,x+3,y+5,5,1,'#93a9d8');}box(g,x-1,y+10,17,4,'#a5a5b5');rect(g,x+2,y+11,10,1,'#656d84');}
  function board(g,x,y,w){shadow(g,x,y,w,24);box(g,x,y,w,23,'#e5e8ec');box(g,x+2,y+2,w-4,18,'#f7f6ee','#a2a8b5');rect(g,x+3,y+23,2,5,ink);rect(g,x+w-5,y+23,2,5,ink);
    rect(g,x+w/2,y+7,1,8,'#7183a6');rect(g,x+10,y+13,w-20,1,'#7183a6');[[w/2-4,4],[7,13],[w-15,13]].forEach(([a,b])=>box(g,x+a,y+b,9,6,'#f3f5fa','#7b8dae'));}
  function chair(g,x,y){shadow(g,x,y,13,10);box(g,x,y,13,10,'#484b5f');rect(g,x+2,y+2,9,2,'#747b90');rect(g,x+5,y+10,3,3,ink);rect(g,x+1,y+12,11,1,ink);}
  function table(g,x,y,w,h){shadow(g,x,y,w,h);box(g,x,y,w,h,'#edb969');rect(g,x+2,y+2,w-4,2,'#ffe2a0');rect(g,x+2,y+h-4,w-4,3,'#bc8047');rect(g,x+2,y+h,3,5,ink);rect(g,x+w-5,y+h,3,5,ink);}
  function tileFloor(g,x,y,w,h,colors){for(let j=0;j<h;j+=8)for(let i=0;i<w;i+=8){rect(g,x+i,y+j,8,8,colors[(i/8+j/8)%2]);rect(g,x+i,y+j,8,1,'#c6bcae');rect(g,x+i,y+j,1,8,'#c6bcae');}}
  function wall(g,r){let x=r.x*T,y=r.y*T,w=r.w*T,h=r.h*T;shadow(g,x,y,w,h);box(g,x,y,w,h,'#d4ad83');rect(g,x+2,y+2,w-4,3,'#ffe2ae');rect(g,x+2,y+h-4,w-4,3,'#927360');if(w>h)rect(g,x+2,y+6,w-4,h-10,'#e9c498');else rect(g,x+3,y+3,3,h-7,'#e9c498');}
  function windowStrip(g,x,y,w){box(g,x,y,w,10,'#6594b5');rect(g,x+2,y+2,w-4,6,'#a2d8ec');rect(g,x+w/2,y+1,1,8,'#edf6ed');for(let i=4;i<w-3;i+=13){rect(g,x+i,y+5,5,1,'#d4eff1');rect(g,x+i+2,y+4,4,1,'#d4eff1');}}
  function furniture(g,p){const x=p.x*T,y=p.y*T,w=p.w*T,h=p.h*T;
    const art={
      kitchen:[48,112,279,127], dining:[150,246,179,165], bath:[48,452,197,128],
      bed:[47,629,78,148], lounge:[324,534,467,301], board:[708,112,191,139],
      server:[1058,87,111,174], shelf:[1662,148,168,108], storage:[1813,308,68,300],
      car:[1669,531,148,243], coffee:[1355,143,173,108], bike:[1638,237,165,84], meeting:[150,246,179,165]
    };
    if(p.k==='plant')return plant(g,x,y+5);
    if(p.k==='lounge'){stamp(g,art.lounge,x,y,w,h);return;}
    if(p.k==='dining'||p.k==='meeting'){fit(g,art[p.k],x,y-12,w,h+27);return;}
    if(art[p.k])fit(g,art[p.k],x,y,w,h);
  }
  O.THEMES.campus={...O.THEMES.office,P:{...O.THEMES.office.P,top:'#e8b86e',topHi:'#ffe2a1',front:'#bc804a',frontLo:'#955f3b'}};
  const proto=O.Scene.prototype, oldPaint=proto.paint,oldWalk=proto.buildWalk,oldWindows=proto.drawWindows;
  proto.paint=function(name){if(this.layoutName!=='campus')return oldPaint.call(this,name);
    const c=document.createElement('canvas');c.width=this.W;c.height=this.H;const g=c.getContext('2d'),L=this.L,rnd=seed(19);
    grass(g,0,0,this.W,this.H);
    // Exterior pavement and arrival path.
    rect(g,0,26*T,this.W,2*T,'#b4b9b2');for(let x=0;x<this.W;x+=24){rect(g,x,26*T,1,32,'#89998a');rect(g,x+2,26*T,21,2,'#d7d6c4');}rect(g,22*T,24*T,2*T,4*T,'#d2d1be');rect(g,39*T,24*T,7*T,4*T,'#9296a0');
    // Warm plank floor and cooler service-room surfaces.
    texture(g,[1050,580,96,48],2*T,3*T,44*T,21*T);
    texture(g,[332,120,60,60],2*T,3*T,8*T,8*T);
    texture(g,[186,494,50,50],2*T,12*T,8*T,4*T);
    texture(g,[1690,354,96,96],39*T,3*T,7*T,21*T);
    L.walls.forEach(w=>wall(g,w));
    [3,12,19,31,40,44].forEach(x=>windowStrip(g,x*T,2*T+3,2*T));[4,12,17,28,34].forEach(x=>windowStrip(g,x*T,24*T+3,2*T));
    L.props.forEach(p=>furniture(g,p));
    // Entrance, garage shutter and garden shrubs.
    box(g,22*T,24*T,2*T,T,'#9a633e');rect(g,22*T+4,24*T+4,24,3,'#c69762');rect(g,23*T+8,24*T+10,2,2,'#edcb73');
    rect(g,40*T,24*T,6*T,3,'#c5ccd1');rect(g,40*T,24*T+4,6*T,2,'#515866');
    [7,10,14,18,26,30,34,37].forEach(x=>fit(g,[284,886,64,65],x*T,25*T,20,21));
    return c;
  };
  proto.buildWalk=function(){if(this.layoutName!=='campus')return oldWalk.call(this);
    const L=this.L,grid=Array.from({length:L.rows},(_,y)=>Array.from({length:L.cols},(_,x)=>x>=2&&x<46&&y>=3&&y<24?1:0));
    const block=(x,y,w,h)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)if(grid[j]&&grid[j][i]!==undefined)grid[j][i]=0;};
    L.walls.forEach(p=>block(p.x,p.y,p.w,p.h));L.props.forEach(p=>{if(p.k==='lounge'){[[11,19,1,4],[13,19,2,4],[15,20,2,3],[18,19,2,2],[18,22,2,2]].forEach(r=>block(...r));}else block(p.x,p.y,p.w,p.h);});L.desks.forEach(d=>block(d.x,d.y,2,1));
    return grid;
  };
  proto.drawWindows=function(g,sky,night){if(this.layoutName!=='campus')return oldWindows.call(this,g,sky,night);
    // Digital clock is drawn separately so it continues ticking over the cached background.
    const now=new Date(),label=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),digits=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];
    const x=29*T,y=3*T+2;box(g,x,y,25,11,'#28333a');for(let i=0;i<label.length;i++){const glyph=label[i]===':'?'000010000010000':digits[Number(label[i])];for(let n=0;n<15;n++)if(glyph[n]==='1')rect(g,x+3+i*4+n%3,y+3+Math.floor(n/3),1,1,'#c6e7aa');}
  };
  proto.drawCampusDesk=function(g,d,on){const x=d.x*T,y=d.y*T,source=d.seat==='n'?[612,271,94,70]:[612,339,94,75];
    stamp(g,source,x,y-2,32,25);
    // Inactive laptops use a dark screen while retaining the original laptop casing.
    if(!on){const sy=d.seat==='n'?y+2:y+6;rect(g,x+11,sy,10,6,'#303545');}
  };
  proto.drawCampusChair=function(g,d,front){const x=d.x*T,y=d.y*T;
    if(front)stamp(g,[642,402,45,59],x+9,y+20,15,20);
    else stamp(g,[640,234,45,39],x+9,y-14,15,13);
  };
  O.paintCampusSurroundings=function(cv,width,height,stageWidth,stageHeight){
    cv.width=Math.max(1,Math.round(width));cv.height=Math.max(1,Math.round(height));const g=cv.getContext('2d');g.imageSmoothingEnabled=false;
    const scale=stageWidth/(48*T),left=(width-stageWidth)/2,top=(height-stageHeight)/2;
    g.save();g.translate(left,top);g.scale(scale,scale);
    grass(g,-left/scale,-top/scale,width/scale,height/scale);
    const roadY=26*T;texture(g,[80,992,330,36],-left/scale,roadY,width/scale,Math.max(32,(height-top)/scale-roadY));
    g.restore();
  };
})();
