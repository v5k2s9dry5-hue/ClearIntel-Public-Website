/* Static NASA geographic texture, projected with the same orthographic view as map pins.
   This is a 2004 composite, not live satellite imagery. No WebGL or third-party scripts. */
'use strict';
window.ClearIntelGlobeSurface = (() => {
  const SIZE=320, TW=1024, TH=512, RAD=Math.PI/180;
  const surface=document.createElement('canvas');
  surface.width=SIZE;surface.height=SIZE;
  const paint=surface.getContext('2d');
  const frame=paint?.createImageData(SIZE,SIZE);
  const col=new Int16Array(SIZE*SIZE), row=new Int32Array(SIZE*SIZE), light=new Float32Array(SIZE*SIZE);
  let texture=null, lastTilt=NaN, lastRot=NaN, loading=false;
  function load(onReady){
    if(!frame||loading||texture)return;
    loading=true;
    const image=new Image();
    image.decoding='async';
    image.onload=()=>{
      if(image.naturalWidth<256||image.naturalHeight<128||Math.abs(image.naturalWidth/image.naturalHeight-2)>.02)return;
      const tmp=document.createElement('canvas');tmp.width=TW;tmp.height=TH;
      const ctx=tmp.getContext('2d',{willReadFrequently:true});
      if(!ctx)return;
      try{
        ctx.drawImage(image,0,0,TW,TH);
        texture=ctx.getImageData(0,0,TW,TH).data;
        onReady();
      }catch{/* Existing vector globe remains available. */}
    };
    image.src='/globe-texture.jpg';
  }
  function geometry(tilt){
    row.fill(-1);
    const t=tilt*RAD, ct=Math.cos(t), st=Math.sin(t);
    for(let y=0;y<SIZE;y++){
      const ny=1-(y+.5)*2/SIZE;
      for(let x=0;x<SIZE;x++){
        const nx=(x+.5)*2/SIZE-1, zz=1-nx*nx-ny*ny;
        if(zz<=0)continue;
        const z=Math.sqrt(zz), i=y*SIZE+x;
        const lat=Math.asin(Math.max(-1,Math.min(1,ny*ct+z*st)));
        const lon=Math.atan2(nx,z*ct-ny*st);
        col[i]=Math.floor((lon/(2*Math.PI)+.5)*TW);
        row[i]=Math.min(TH-1,Math.max(0,Math.floor((.5-lat/Math.PI)*TH)))*TW;
        // Fixed studio lighting; not a daylight or weather simulation.
        light[i]=.43+.57*Math.max(0,Math.min(1,-.42*nx+.45*ny+.78*z));
      }
    }
    lastTilt=tilt;lastRot=NaN;
  }
  function draw(ctx,cx,cy,r,rot,tilt){
    if(!texture||!frame)return false;
    if(tilt!==lastTilt)geometry(tilt);
    const shift=Math.round(rot/360*TW);
    if(shift!==lastRot){
      const pixels=frame.data;
      for(let i=0;i<row.length;i++){
        const p=i*4;
        if(row[i]<0){pixels[p+3]=0;continue;}
        const u=((col[i]+shift)%TW+TW)%TW, q=(row[i]+u)*4, shade=light[i];
        pixels[p]=texture[q]*shade*.78;
        pixels[p+1]=texture[q+1]*shade*.95+8;
        pixels[p+2]=texture[q+2]*shade*1.10+14;
        pixels[p+3]=255;
      }
      paint.putImageData(frame,0,0);
      lastRot=shift;
    }
    ctx.drawImage(surface,cx-r,cy-r,r*2,r*2);
    return true;
  }
  return {load,draw};
})();
