/* Public motion and image viewer. No data writes and no animation dependency. */
(() => {
  const reduce = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  const animate = (el, frames, options) => { if (el?.animate && !reduce()) el.animate(frames, options); };
  let positions = new Map(), scrollTop = 0;
  const home=document.getElementById('view-home'),mobile=matchMedia('(max-width:899px)'),motion=matchMedia('(prefers-reduced-motion:reduce)');
  let focusFrame=0,focusCards=[];
  function updateCenterFocus(){
    focusFrame=0;
    if(!home?.classList.contains('active')||!mobile.matches||motion.matches){
      if(home?.classList.contains('center-focus'))home.classList.remove('center-focus');return;
    }
    if(!home.classList.contains('center-focus'))home.classList.add('center-focus');
    const bounds=home.getBoundingClientRect(),bar=document.getElementById('tabbar');
    const bottom=bar&&!bar.classList.contains('hide')?Math.min(bounds.bottom,bar.getBoundingClientRect().top):bounds.bottom;
    const center=(bounds.top+bottom)/2,span=Math.max(150,(bottom-bounds.top)*.55);
    focusCards.forEach(card=>{
      // offsetTop/height are not affected by the visual scale (no feedback loop).
      const middle=bounds.top+card.offsetTop-home.scrollTop+card.offsetHeight/2;
      const distance=Math.min(1,Math.abs(middle-center)/span),weight=1-distance*distance;
      card.style.setProperty('--focus-scale',(0.956+0.044*weight).toFixed(4));
      card.style.setProperty('--focus-opacity',(0.83+0.17*weight).toFixed(3));
      card.style.setProperty('--focus-shadow',(0.025+0.065*weight).toFixed(3));
    });
  }
  function scheduleFocus(){if(!focusFrame)focusFrame=requestAnimationFrame(updateCenterFocus);}
  home?.addEventListener('scroll',scheduleFocus,{passive:true});
  window.addEventListener('resize',scheduleFocus);mobile.addEventListener('change',scheduleFocus);motion.addEventListener('change',scheduleFocus);
  if(home)new MutationObserver(()=>{focusCards=Array.from(home.querySelectorAll('.listing-list>.lcard'));scheduleFocus();}).observe(home,{childList:true,attributes:true,attributeFilter:['class']});
  window.SiteMotion = {
    beforeRender(el) {
      scrollTop = el?.scrollTop || 0;
      positions = new Map(Array.from(el?.querySelectorAll('.lcard[data-id]') || []).map(card => [card.dataset.id, card.getBoundingClientRect()]));
    },
    afterRender(el) {
      if (el) el.scrollTop = scrollTop;
      let n = 0;
      el?.querySelectorAll('.lcard[data-id]').forEach(card => {
        const old = positions.get(card.dataset.id), now = card.getBoundingClientRect();
        const visible = now.top < innerHeight + 80 && now.bottom > 0;
        if (!visible) return;
        if (old && Math.abs(old.left-now.left)+Math.abs(old.top-now.top) > 2) animate(card,[{transform:`translate(${old.left-now.left}px,${old.top-now.top}px)`},{transform:'translate(0,0)'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
        else if (!old) animate(card,[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,delay:Math.min(n++*35,140),easing:'cubic-bezier(.22,1,.36,1)'});
      });
      positions.clear();
      if(el===home){focusCards=Array.from(home.querySelectorAll('.listing-list>.lcard'));scheduleFocus();}
    },
    async saveProfile(button,persist){
      if(button.disabled)return false;
      const sheet=button.closest('.sheet'),status=sheet.querySelector('.profile-save-status');
      const controls=Array.from(sheet.querySelectorAll('button,input')).map(el=>[el,el.disabled]);
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      controls.forEach(([el])=>el.disabled=true);button.dataset.pending='true';button.setAttribute('aria-busy','true');button.setAttribute('aria-label','正在保存客户资料');
      button.classList.add('saving');status.textContent='正在保存客户资料';
      let saved=false;
      try{
        await wait(reduce()?0:740);
        await persist();
        button.classList.add('saved');button.setAttribute('aria-busy','false');button.setAttribute('aria-label','客户资料已保存');status.textContent='客户资料已保存';
        await wait(reduce()?250:1100);
        // Keep the check visible while the button gently returns to its slot.
        button.classList.add('settling');
        await wait(reduce()?0:480);
        saved=true;
      }catch(failure){
        const error=document.createElement('div');error.className='inline-field-error';error.setAttribute('role','alert');error.textContent=failure?.message==='profile_storage_failed'?'云端已保存，本机保存失败。请检查浏览器空间或隐私设置后重试，原编号会保留。':failure?.message||'资料未能保存，填写内容已保留，请稍后重试。';
        sheet.querySelector('.sheet-body').append(error);status.textContent='保存失败，填写内容已保留';
      }finally{
        if(!saved){button.classList.remove('saving','saved','settling');button.removeAttribute('aria-label');}
        button.removeAttribute('aria-busy');delete button.dataset.pending;
        controls.forEach(([el,disabled])=>el.disabled=disabled);
        if(saved)button.disabled=true;
      }
      return saved;
    },
    fieldError(id, text) {
      const field = document.getElementById(id); if (!field) return;
      this.clearErrors();
      const note = document.createElement('div'); note.className='inline-field-error'; note.id=id+'Error'; note.setAttribute('role','alert'); note.textContent=text;
      field.setAttribute('aria-invalid','true'); field.setAttribute('aria-describedby',note.id); field.after(note); field.focus({preventScroll:true}); field.scrollIntoView({block:'nearest',behavior:reduce()?'auto':'smooth'});
    },
    clearErrors() {
      document.querySelectorAll('.inline-field-error').forEach(el=>el.remove());
      document.querySelectorAll('[aria-invalid=true]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');});
    },
    success(text) {
      document.querySelector('.success-toast')?.remove();
      const el=document.createElement('div'); el.className='success-toast'; el.setAttribute('role','status');
      el.innerHTML='<svg class="success-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-opacity=".2"/><path d="m6 12 4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const label=document.createElement('span');label.textContent=text;el.append(label);document.body.append(el);
      setTimeout(()=>el.remove(),3200);
    },
    openPhoto(index) { openPhoto(index); }
  };
  document.addEventListener('input',event=>{
    const field=event.target;
    if (field.hasAttribute?.('aria-invalid')) { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); document.getElementById(field.id+'Error')?.remove(); }
  });

  function openPhoto(start) {
    if (document.querySelector('.photo-viewer[open]')) return;
    const originals=Array.from(document.querySelectorAll('#galleryTrack > :not([data-gallery-clone]) img'));
    const photos=originals.map(img=>({src:img.currentSrc || img.src,alt:img.alt}));
    if (!photos.length) return;
    const opener=document.activeElement;
    let index=Math.max(0,Math.min(photos.length-1,start)), zoom=1,x=0,y=0,gesture=null;
    const pointers=new Map();
    const viewer=document.createElement('dialog');viewer.className='photo-viewer';viewer.setAttribute('aria-label','房源照片大图');
    viewer.innerHTML='<div class="photo-toolbar"><strong class="photo-counter" aria-live="polite"></strong><button type="button" data-photo="out" aria-label="缩小照片">−</button><button type="button" data-photo="in" aria-label="放大照片">＋</button><button type="button" data-photo="reset" aria-label="恢复原始大小">适应</button><button type="button" data-photo="close" aria-label="关闭大图">✕</button></div><div class="photo-stage media-frame"><img draggable="false"></div><div class="photo-bottom"><button class="photo-arrow" type="button" data-photo="prev" aria-label="上一张大图">‹</button><span>左右滑动切图 · 双指或双击缩放<br>放大后可拖动查看</span><button class="photo-arrow" type="button" data-photo="next" aria-label="下一张大图">›</button></div>';
    const stage=viewer.querySelector('.photo-stage'),image=stage.querySelector('img'),counter=viewer.querySelector('.photo-counter');
    function clampPan() {
      const fit=Math.min(stage.clientWidth/(image.naturalWidth||1),stage.clientHeight/(image.naturalHeight||1));
      const maxX=Math.max(0,((image.naturalWidth||0)*fit*zoom-stage.clientWidth)/2),maxY=Math.max(0,((image.naturalHeight||0)*fit*zoom-stage.clientHeight)/2);
      x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));
    }
    function paint() { clampPan();image.style.transform=`translate(${x}px,${y}px) scale(${zoom})`; stage.style.cursor=zoom>1?'grab':'zoom-in';viewer.querySelector('[data-photo="out"]').disabled=zoom<=1;viewer.querySelector('[data-photo="in"]').disabled=zoom>=4; }
    function setZoom(value) { zoom=Math.max(1,Math.min(4,value));if(zoom===1){x=0;y=0;}paint(); }
    function showPhoto(value) {
      index=(value+photos.length)%photos.length;zoom=1;x=0;y=0;pointers.clear();gesture=null;
      stage.classList.remove('media-ready','media-error');stage.setAttribute('aria-busy','true');
      counter.textContent=`房源实拍 · ${index+1} / ${photos.length}`;
      image.alt=photos[index].alt;image.src=photos[index].src;paint();
      if(image.complete)settled();
      animate(image,[{opacity:.5},{opacity:1}],{duration:180});
    }
    function settled(){stage.removeAttribute('aria-busy');stage.classList.toggle('media-ready',image.naturalWidth>0);stage.classList.toggle('media-error',!image.naturalWidth);paint();}
    image.addEventListener('load',settled);image.addEventListener('error',settled);
    viewer.addEventListener('click',event=>{
      const action=event.target.closest('[data-photo]')?.dataset.photo;
      if(action==='close')viewer.close();if(action==='prev')showPhoto(index-1);if(action==='next')showPhoto(index+1);
      if(action==='in')setZoom(zoom+.5);if(action==='out')setZoom(zoom-.5);if(action==='reset')setZoom(1);
    });
    viewer.addEventListener('keydown',event=>{
      if(event.key==='ArrowLeft'){event.preventDefault();showPhoto(index-1);}
      if(event.key==='ArrowRight'){event.preventDefault();showPhoto(index+1);}
    });
    stage.addEventListener('dblclick',()=>setZoom(zoom===1?2:1));
    function beginGesture() {
      const points=[...pointers.values()]; if(!points.length){gesture=null;return;}
      gesture={start:points[0],x,y,zoom,distance:points.length>1?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0,pinch:points.length>1};
    }
    stage.addEventListener('pointerdown',event=>{if(event.button>0)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});stage.setPointerCapture(event.pointerId);beginGesture();});
    stage.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId)||!gesture)return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.values()];
      if(points.length>1&&gesture.distance){zoom=Math.max(1,Math.min(4,gesture.zoom*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/gesture.distance));paint();}
      else if(zoom>1){x=gesture.x+event.clientX-gesture.start.x;y=gesture.y+event.clientY-gesture.start.y;paint();}
    });
    function end(event){
      const current=gesture,had=pointers.has(event.pointerId);pointers.delete(event.pointerId);
      if(had&&event.type==='pointerup'&&current&&!current.pinch&&zoom===1){const dx=event.clientX-current.start.x,dy=event.clientY-current.start.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.4)showPhoto(index+(dx<0?1:-1));}
      beginGesture();
    }
    stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
    stage.addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();setZoom(zoom+(event.deltaY<0?.15:-.15));}},{passive:false});
    const resize=()=>paint();window.addEventListener('resize',resize);
    viewer.addEventListener('close',()=>{window.removeEventListener('resize',resize);window.DetailGallery?.go(index,false);viewer.remove();if(opener?.isConnected)opener.focus({preventScroll:true});},{once:true});
    document.body.append(viewer);viewer.showModal();showPhoto(index);viewer.querySelector('[data-photo="close"]').focus({preventScroll:true});
  }
})();
