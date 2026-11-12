/* One photo index drives the main image and the following desktop previews. */
(() => {
  let cleanups=[],controller=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  function destroy(){cleanups.forEach(fn=>fn());cleanups=[];controller=null;}
  function bind(){
    destroy();
    const main=document.querySelector('#galleryTrack');
    if(!main)return;
    const tracks=[main,...document.querySelectorAll('.detail-preview-track')];
    const count=main.querySelectorAll(':scope > :not([data-gallery-clone])').length;
    if(!count)return;
    const mod=n=>((n%count)+count)%count;
    const dots=[...document.querySelectorAll('#galleryDots .gdot')],counter=document.querySelector('.gallery-count');
    let index=0,progress=0,frame=0,pointer=null,blockedUntil=0,wheelTimer=0;
    const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);cleanups.push(()=>node.removeEventListener(type,fn,options));};
    const paint=()=>{
      tracks.forEach(track=>{
        track.scrollLeft=(count+mod(index+Number(track.dataset.offset||0))+progress)*track.clientWidth;
      });
    };
    const announce=()=>{
      dots.forEach((dot,i)=>{dot.classList.toggle('on',i===index);dot.setAttribute('aria-current',i===index?'true':'false');});
      if(counter)counter.textContent=(index+1)+'/'+count;
      tracks.forEach(track=>{
        const visible=mod(index+Number(track.dataset.offset||0));
        track.querySelectorAll(':scope > button').forEach(button=>{button.tabIndex=!button.hasAttribute('data-gallery-clone')&&Number(button.dataset.v)===visible?0:-1;});
      });
    };
    const cancel=()=>{cancelAnimationFrame(frame);frame=0;clearTimeout(wheelTimer);};
    function settle(delta,smooth=true){
      cancel();
      const from=progress,start=performance.now(),duration=smooth&&!reduced()?420:0;
      function tick(now){
        const t=duration?Math.min(1,(now-start)/duration):1;
        progress=from+(delta-from)*(1-Math.pow(1-t,3));paint();
        if(t<1)frame=requestAnimationFrame(tick);
        else{frame=0;index=mod(index+delta);progress=0;paint();announce();}
      }
      if(duration)frame=requestAnimationFrame(tick);else tick(start);
    }
    controller={
      step(delta){if(count>1&&!pointer&&!frame)settle(delta<0?-1:1);},
      go(value,smooth=true){
        if(!Number.isFinite(value))return;
        pointer=null;
        let delta=mod(value)-index;
        if(delta>count/2)delta-=count;if(delta<-count/2)delta+=count;
        settle(delta,smooth);
      }
    };
    tracks.forEach(track=>{
      const originals=[...track.children];
      if(count>1){
        // A full cycle on both sides keeps every pane seamless at the last photo.
        const copy=()=>originals.map(button=>{
          const clone=button.cloneNode(true);clone.dataset.galleryClone='';clone.tabIndex=-1;clone.setAttribute('aria-hidden','true');return clone;
        });
        track.prepend(...copy());track.append(...copy());
      }
      const begin=(id,x,y,touch=false)=>{
        if(count<2)return;
        if(pointer){finishGesture(true);return;}
        // A fresh swipe can take over the current easing without jumping back.
        cancel();
        pointer={id,x,y,track,touch,dragged:false,from:progress,lastX:x,lastTime:performance.now(),velocity:0};
      };
      const move=(x,y,event)=>{
        const state=pointer;if(!state||state.track!==track)return;
        const dx=x-state.x,dy=y-state.y;
        if(!state.dragged){
          if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.2){pointer=null;if(progress)settle(0);return;}
          if(Math.abs(dx)<7||Math.abs(dx)<Math.abs(dy))return;
          state.dragged=true;
          if(!state.touch){try{track.setPointerCapture(state.id);}catch{/* Pointer may have ended. */}}
          tracks.forEach(item=>item.classList.add('is-dragging'));
        }
        if(event.cancelable)event.preventDefault();
        const now=performance.now(),dt=now-state.lastTime;
        if(dt>0)state.velocity=(x-state.lastX)/dt;
        state.lastX=x;state.lastTime=now;
        progress=Math.max(-1,Math.min(1,state.from-dx/(track.clientWidth||1)));paint();
      };
      function finishGesture(cancelled){
        const state=pointer;if(!state||state.track!==track)return;
        pointer=null;
        if(!state.touch&&track.hasPointerCapture(state.id))track.releasePointerCapture(state.id);
        tracks.forEach(item=>item.classList.remove('is-dragging'));
        if(!state.dragged){if(progress)settle(0);return;}
        blockedUntil=performance.now()+450;
        const flick=performance.now()-state.lastTime<110&&Math.abs(state.velocity)>.4&&Math.abs(state.lastX-state.x)>25;
        settle(cancelled?0:Math.abs(progress)>.16||flick?Math.sign(progress):0);
      }
      const down=e=>{
        // iOS webviews implicitly capture touch pointers on the photo button.
        // Use native touch events there, rather than transferring that capture.
        if(e.button>0||e.pointerType==='touch'&&'ontouchstart' in window)return;
        if(e.isPrimary===false){finishGesture(true);return;}
        begin(e.pointerId,e.clientX,e.clientY);
      };
      const drag=e=>{if(pointer&&!pointer.touch&&pointer.id===e.pointerId)move(e.clientX,e.clientY,e);};
      const finish=e=>{if(pointer&&!pointer.touch&&pointer.id===e.pointerId)finishGesture(e.type!=='pointerup');};
      listen(track,'pointerdown',down);listen(track,'pointermove',drag,{passive:false});
      listen(window,'pointerup',finish);listen(window,'pointercancel',finish);
      // Ignore a bubbled lost capture from the child photo button. It is not
      // a cancellation of the gesture now captured by the track itself.
      listen(track,'lostpointercapture',e=>{if(e.target===track)finish(e);});
      listen(track,'touchstart',e=>{
        if(e.touches.length!==1){finishGesture(true);return;}
        const touch=e.touches[0];begin(touch.identifier,touch.clientX,touch.clientY,true);
      },{passive:true});
      listen(track,'touchmove',e=>{
        if(!pointer?.touch||pointer.track!==track)return;
        if(e.touches.length!==1){finishGesture(true);return;}
        const touch=[...e.touches].find(item=>item.identifier===pointer.id);
        if(touch)move(touch.clientX,touch.clientY,e);
      },{passive:false});
      listen(track,'touchend',e=>{if(pointer?.touch&&[...e.changedTouches].some(item=>item.identifier===pointer.id))finishGesture(false);},{passive:true});
      listen(track,'touchcancel',()=>{if(pointer?.touch)finishGesture(true);},{passive:true});
      listen(track,'click',e=>{if(performance.now()<blockedUntil||frame){e.preventDefault();e.stopImmediatePropagation();}},true);
      listen(track,'dragstart',e=>e.preventDefault());
      listen(track,'keydown',e=>{
        if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();controller.step(e.key==='ArrowRight'?1:-1);}
      });
      listen(track,'wheel',e=>{
        if(count<2||e.ctrlKey||Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;
        e.preventDefault();if(frame||pointer)return;
        progress=Math.max(-1,Math.min(1,progress+e.deltaX/(track.clientWidth||1)));paint();
        blockedUntil=performance.now()+450;
        clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>settle(Math.abs(progress)>.12?Math.sign(progress):0),120);
      },{passive:false});
    });
    // Single images have no cloned cycles.
    if(count===1)tracks.forEach(track=>{track.scrollLeft=0;});else paint();
    announce();
    const observer=new ResizeObserver(()=>{if(count>1)paint();});tracks.forEach(track=>observer.observe(track));
    cleanups.push(()=>{cancel();observer.disconnect();tracks.forEach(track=>{track.classList.remove('is-dragging');track.querySelectorAll('[data-gallery-clone]').forEach(node=>node.remove());});});
  }
  window.DetailGallery={bind,destroy,step:delta=>controller?.step(delta),go:(value,smooth)=>controller?.go(value,smooth)};
})();
