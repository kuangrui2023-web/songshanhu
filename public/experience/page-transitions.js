/* Mobile drill-in / swipe-back. The actual previous DOM stays underneath,
   so its scroll position is visible throughout a reversible gesture. */
(() => {
  const viewport=document.getElementById('viewport');
  if(!viewport)return;
  const mobile=matchMedia('(max-width:899px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const drillViews=['detail','resources'];
  const excluded='button,a,input,textarea,select,label,video,audio,[contenteditable],.gallery,.gallery-track,.amap-container,#detailMap,[role="slider"]';
  let running=null,gesture=null,blockedUntil=0;
  const view=name=>document.getElementById('view-'+name);
  function release(g){if(g?.front.hasPointerCapture(g.id))g.front.releasePointerCapture(g.id);}
  function clean(frame){
    if(!frame)return;
    frame.animations?.forEach(animation=>animation.cancel());
    [frame.front,frame.under].forEach(el=>{
      el.style.removeProperty('transform');
      el.classList.remove('page-moving','page-front','page-underlay');
    });
    frame.under.inert=frame.wasInert;
    if(frame.wasHidden===null)frame.under.removeAttribute('aria-hidden');else frame.under.setAttribute('aria-hidden',frame.wasHidden);
    viewport.classList.remove('page-transitioning','page-dragging','page-settling');
    if(running===frame)running=null;
  }
  function reset(){const old=gesture;gesture=null;release(old);if(running)clean(running);}
  function stage(front,under){
    const frame={front,under,wasInert:under.inert,wasHidden:under.getAttribute('aria-hidden'),animations:[]};
    running=frame;
    under.inert=true;under.setAttribute('aria-hidden','true');
    front.classList.add('page-moving','page-front');under.classList.add('page-moving','page-underlay');
    viewport.classList.add('page-transitioning');return frame;
  }
  function animate(frame,frontFrom,frontTo,underFrom,underTo,duration,done){
    viewport.classList.add('page-settling');
    const options={duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'};
    const translate=x=>`translate3d(${x}px,0,0)`;
    frame.animations=[frame.front.animate([{transform:translate(frontFrom)},{transform:translate(frontTo)}],options),frame.under.animate([{transform:translate(underFrom)},{transform:translate(underTo)}],options)];
    Promise.all(frame.animations.map(animation=>animation.finished)).then(()=>{
      if(running!==frame)return;
      clean(frame);done?.();
    }).catch(()=>{});
  }
  window.SitePages={
    prepare(from,to,push,navigation){
      reset();
      if(!mobile.matches||reduced.matches||navigation.gestureBack||from===to||!view(from)?.classList.contains('active'))return null;
      const forward=push&&drillViews.includes(to),backward=!push&&drillViews.includes(from);
      return forward||backward?{from: view(from),forward}:null;
    },
    enter(context,incoming){
      if(!incoming||!context.from.animate)return;
      const width=viewport.clientWidth;
      const frame=context.forward?stage(incoming,context.from):stage(context.from,incoming);
      animate(frame,context.forward?width:0,context.forward?0:width,context.forward?0:-width*.22,context.forward?-width*.22:0,320);
    }
  };
  viewport.addEventListener('pointerdown',event=>{
    if(!mobile.matches||reduced.matches||!event.isPrimary||event.button>0||running||gesture||!drillViews.includes(State.view)||!State.stack.length)return;
    if(document.querySelector('.sheet-mask.show,.dialog-mask.show,.poster-mask.show,dialog[open]')||event.target.closest(excluded))return;
    const front=view(State.view),under=view(State.stack[State.stack.length-1].v);
    const rect=viewport.getBoundingClientRect();
    // Leave the system edge gesture to Safari / WeChat. Gestures work on the
    // rest of the content, without capturing gallery, form or map gestures.
    if(!under?.hasChildNodes()||front===under||event.clientX<rect.left+24)return;
    gesture={id:event.pointerId,front,under,x:event.clientX,y:event.clientY,dx:0,width:rect.width,lastX:event.clientX,lastTime:performance.now(),velocity:0,engaged:false,scrollTop:front.scrollTop};
  });
  viewport.addEventListener('pointermove',event=>{
    const g=gesture;if(!g||g.id!==event.pointerId)return;
    const dx=event.clientX-g.x,dy=event.clientY-g.y;
    if(!g.engaged){
      if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*.85||dx < -10||Math.abs(g.front.scrollTop-g.scrollTop)>2){gesture=null;return;}
      if(dx<10||dx<Math.abs(dy)*1.4)return;
      g.frame=stage(g.front,g.under);g.engaged=true;
      viewport.classList.add('page-dragging');g.front.setPointerCapture(g.id);
    }
    event.preventDefault();
    const now=performance.now(),elapsed=now-g.lastTime;
    if(elapsed>0)g.velocity=(event.clientX-g.lastX)/elapsed;
    g.lastX=event.clientX;g.lastTime=now;g.dx=Math.min(g.width,Math.max(0,dx));
    g.front.style.transform=`translate3d(${g.dx}px,0,0)`;
    g.under.style.transform=`translate3d(${(g.dx-g.width)*.22}px,0,0)`;
  },{passive:false});
  function end(event){
    const g=gesture;if(!g||g.id!==event.pointerId)return;
    gesture=null;release(g);
    if(!g.engaged)return;
    blockedUntil=performance.now()+400;
    const velocity=performance.now()-g.lastTime<90?g.velocity:0;
    const commit=event.type==='pointerup'&&(g.dx>g.width*.32||g.dx>55&&velocity>.5);
    animate(g.frame,g.dx,commit?g.width:0,(g.dx-g.width)*.22,commit?0:-g.width*.22,Math.max(130,Math.min(260,(commit?g.width-g.dx:g.dx)*.65)),commit?()=>back({gestureBack:true}):null);
  }
  viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
  viewport.addEventListener('lostpointercapture',event=>{if(gesture?.id===event.pointerId)end({...event,pointerId:event.pointerId,type:'pointercancel'});});
  viewport.addEventListener('click',event=>{if(event.detail!==0&&performance.now()<blockedUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('resize',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  mobile.addEventListener('change',reset);reduced.addEventListener('change',reset);
})();
