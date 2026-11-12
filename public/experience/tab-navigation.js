/* Glass navigation: tap, or hold and scrub to switch while the pointer is still down. */
(() => {
  const bar=document.getElementById('tabbar');
  if(!bar)return;
  const mobile=matchMedia('(max-width:899px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const keys=['home','message','mine'];
  let gesture=null,blockedUntil=0,resizeFrame=0,enterAnimation=null;
  const buttons=()=>Array.from(bar.querySelectorAll('.tab-item'));
  function geometry() {
    const rail=bar.querySelector('.tab-rail');
    if(!rail||!mobile.matches||!rail.clientWidth)return null;
    const rect=rail.getBoundingClientRect();
    return {rail,rect,items:buttons().map(button=>{
      const box=button.getBoundingClientRect();return {button,x:box.left-rect.left,width:box.width,center:box.left+box.width/2};
    })};
  }
  function paint(index,data=geometry(),x) {
    if(!data||index<0)return;
    const item=data.items[index];
    if(!item)return;
    data.rail.style.setProperty('--tab-pill-width',item.width+'px');
    data.rail.style.setProperty('--tab-pill-x',(x===undefined?item.x:x)+'px');
    data.items.forEach((it,i)=>it.button.classList.toggle('on',i===index));
  }
  function sync(){if(!gesture)paint(keys.indexOf(State.tab));}
  function cancel(restore=true) {
    const old=gesture;gesture=null;
    if(old){clearTimeout(old.holdTimer);old.rail.classList.remove('scrubbing');if(old.rail.hasPointerCapture(old.id))old.rail.releasePointerCapture(old.id);}
    if(restore)sync();
  }
  window.SiteTabs={
    sync,
    enter(from,to,view) {
      enterAnimation?.cancel();document.getElementById('viewport').classList.remove('tab-switching');
      const previous=keys.indexOf(from),next=keys.indexOf(to);
      if(!mobile.matches||reduced.matches||!view?.animate||previous<0||next<0||previous===next)return;
      const viewport=document.getElementById('viewport');viewport.classList.add('tab-switching');
      const animation=view.animate([{opacity:.75,transform:`translate3d(${next>previous?18:-18}px,0,0)`},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:gesture?.engaged?160:240,easing:'cubic-bezier(.22,1,.36,1)'});
      enterAnimation=animation;
      animation.finished.catch(()=>{}).finally(()=>{if(enterAnimation===animation){viewport.classList.remove('tab-switching');enterAnimation=null;}});
    }
  };
  function selectAt(g,clientX) {
    if(gesture!==g)return;
    // A small margin prevents jitter at a boundary without delaying selection.
    const localX=clientX-g.rect.left;
    let index=g.items.findIndex(item=>localX<item.x+item.width);
    if(index<0)index=keys.length-1;
    if(index>g.index&&localX<g.items[g.index].x+g.items[g.index].width+5)index=g.index;
    if(index<g.index&&localX>g.items[g.index].x-5)index=g.index;
    g.index=index;
    const x=Math.max(g.items[0].x,Math.min(g.items[g.items.length-1].x,localX-g.items[index].width/2));
    g.rail.style.setProperty('--glass-x',Math.max(0,Math.min(100,localX/g.rect.width*100))+'%');
    if(keys[index]!==State.tab)setView(keys[index],false);
    paint(index,g,x);
  }
  function engage(g) {
    if(gesture!==g||g.engaged)return;
    clearTimeout(g.holdTimer);g.engaged=true;
    g.rail.classList.add('scrubbing');g.rail.setPointerCapture(g.id);
    selectAt(g,g.lastX);
  }
  bar.addEventListener('pointerdown',event=>{
    if(!mobile.matches||!event.isPrimary||event.button>0||!event.target.closest('.tab-item'))return;
    cancel();const data=geometry();if(!data)return;
    const start=keys.indexOf(event.target.closest('.tab-item').dataset.v);
    const g={...data,id:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,index:start,engaged:false,holdTimer:0};
    gesture=g;
    g.holdTimer=setTimeout(()=>engage(g),240);
  });
  bar.addEventListener('pointermove',event=>{
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    g.lastX=event.clientX;
    const dx=event.clientX-g.startX,dy=event.clientY-g.startY;
    if(!g.engaged){
      if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.3){blockedUntil=performance.now()+350;cancel();return;}
      if(Math.abs(dx)<7)return;
      engage(g);
    }
    event.preventDefault();
    // Leaving the navigation band keeps the current page, rather than switching
    // accidentally while reaching for page content.
    if(event.clientY<g.rect.top-28||event.clientY>g.rect.bottom+28){paint(keys.indexOf(State.tab),g);return;}
    selectAt(g,event.clientX);
  },{passive:false});
  bar.addEventListener('pointerup',event=>{
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    if(!g.engaged){clearTimeout(g.holdTimer);gesture=null;return;}
    blockedUntil=performance.now()+350;
    // Selection was committed on hold/move, never deferred to release.
    cancel();
  });
  bar.addEventListener('contextmenu',event=>{if(event.target.closest('.tab-item'))event.preventDefault();});
  bar.addEventListener('pointercancel',()=>cancel());
  bar.addEventListener('lostpointercapture',()=>{if(gesture)cancel();});
  bar.addEventListener('click',event=>{
    if(event.detail!==0&&performance.now()<blockedUntil){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  bar.addEventListener('keydown',event=>{
    const button=event.target.closest('.tab-item');if(!button)return;
    const current=keys.indexOf(button.dataset.v);let index;
    if(event.key==='ArrowRight')index=(current+1)%keys.length;
    else if(event.key==='ArrowLeft')index=(current+keys.length-1)%keys.length;
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=keys.length-1;
    else return;
    event.preventDefault();setView(keys[index],false);buttons()[index]?.focus({preventScroll:true});
  });
  const resize=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{cancel();sync();});};
  if('ResizeObserver' in window)new ResizeObserver(resize).observe(bar);
  window.addEventListener('resize',resize);mobile.addEventListener('change',resize);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  reduced.addEventListener('change',()=>{if(reduced.matches){enterAnimation?.cancel();document.getElementById('viewport').classList.remove('tab-switching');}});
  sync();
})();
