/* Voluntary customer registration. The local receipt is a write capability,
   never a verified account, never synced into the public catalog or CSV. */
(function () {
  'use strict';
  const receiptKey='site_customer_receipt_v1';
  const avatarPattern=/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  let avatar='',reading=false,generation=0;
  const safeAvatar=value=>typeof value==='string'&&value.length<=44000&&avatarPattern.test(value)?value:'';
  function avatarHTML(value,name) {
    const image=safeAvatar(value);
    return image?`<img src="${image}" alt="自定义头像" width="64" height="64">`:esc((name||'游').slice(0,1));
  }
  function receipt() {
    let value=localStorage.getItem(receiptKey);
    if(!/^[a-f0-9]{64}$/.test(value||'')) {
      const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
      value=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(receiptKey,value);
    }
    if(localStorage.getItem(receiptKey)!==value)throw new Error('请允许浏览器保存本机资料后重试。');
    return value;
  }
  async function compress(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片；HEIC 请先转为 JPG。');
    if(file.size>10*1024*1024)throw new Error('请选择小于 10MB 的头像图片。');
    const url=URL.createObjectURL(file);
    try {
      const image=new Image();image.src=url;await image.decode();
      if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('图片尺寸过大，请换一张较小的图片。');
      const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
      const context=canvas.getContext('2d');
      if(!context)throw new Error('当前浏览器无法处理头像，请换用系统浏览器。');
      context.fillStyle='#fff';context.fillRect(0,0,192,192);
      const side=Math.min(image.naturalWidth,image.naturalHeight);
      context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,192,192);
      for(const quality of [.82,.65,.45]) {
        const data=canvas.toDataURL('image/jpeg',quality);
        if(safeAvatar(data))return data;
      }
      throw new Error('头像压缩后仍过大，请选择较简单的图片。');
    }finally{URL.revokeObjectURL(url);}
  }
  function mount(visitor) {
    avatar=safeAvatar(visitor?.avatar);reading=false;const version=++generation;
    const input=document.getElementById('lgAvatar'),preview=document.getElementById('lgAvatarPreview'),hint=document.getElementById('lgAvatarHint');
    const save=document.querySelector('[data-act="submit:visitorLogin"]'),remove=document.getElementById('lgAvatarRemove');
    remove.onclick=()=>{avatar='';preview.innerHTML=avatarHTML('',visitor?.nick);hint.textContent='保存后移除自定义头像';};
    input.onchange=async()=>{
      if(!input.files?.[0])return;
      reading=true;save.disabled=true;remove.disabled=true;hint.textContent='正在压缩头像…';
      try { const data=await compress(input.files[0]);if(version!==generation||!input.isConnected)return;avatar=data;preview.innerHTML=avatarHTML(avatar);hint.textContent='头像已压缩，保存资料后生效'; }
      catch(error){if(input.isConnected)hint.textContent=error.message||'图片读取失败，请重试。';}
      finally {if(version===generation){reading=false;if(save.isConnected)save.disabled=false;if(remove.isConnected)remove.disabled=false;}input.value='';}
    };
  }
  async function save(nick,phone,consent) {
    if(reading)throw new Error('头像正在处理，请稍候。');
    const config=window.__SITE_BACKEND__||{},secret=receipt();
    if(!config.url||!config.key)throw new Error('资料服务暂不可用，请稍后重试。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(config.url.replace(/\/$/,'')+'/rest/v1/rpc/save_site_customer_profile',{
        method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
        body:JSON.stringify({p_receipt:secret,p_nickname:nick,p_phone:phone,p_avatar:avatar,p_consent:consent}),signal:controller.signal
      });
      const result=await response.json();
      if(!response.ok)throw new Error(response.status===400?result.message:'云端资料暂未保存，请稍后重试。');
      if(!/^KH\d{8,}$/.test(result.code||''))throw new Error('云端结果尚未确认，请重试；不会重复生成编号。');
      return {customerCode:result.code,profileCreatedAt:result.created_at,profileUpdatedAt:result.updated_at,avatar};
    }catch(error){
      if(error.name==='AbortError'||error instanceof TypeError)throw new Error('连接超时或网络异常，结果尚未确认。请重试，系统会沿用原编号。');
      throw error;
    }finally{clearTimeout(timer);}
  }
  function clearErrors(){document.querySelectorAll('#sheet .inline-field-error').forEach(el=>el.remove());document.querySelectorAll('#sheet [aria-invalid]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');});}
  function fieldError(id,message){
    clearErrors();const input=document.getElementById(id),error=document.createElement('div');error.className='inline-field-error';error.id=id+'Error';error.setAttribute('role','alert');error.textContent=message;
    input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',error.id);input.after(error);input.focus();
  }
  async function saveWithFeedback(button,persist){
    if(window.SiteMotion?.saveProfile)return window.SiteMotion.saveProfile(button,persist);
    const sheet=button.closest('.sheet'),controls=[...sheet.querySelectorAll('button,input')].map(el=>[el,el.disabled]);
    controls.forEach(([el])=>el.disabled=true);button.dataset.pending='true';button.setAttribute('aria-busy','true');
    try{await persist();return true;}
    catch(error){const message=error?.message==='profile_storage_failed'?'云端已保存，本机保存失败。请检查浏览器存储后重试，原编号会保留。':error?.message||'保存未完成，请稍后重试。';fieldError('lgNick',message);return false;}
    finally{delete button.dataset.pending;button.removeAttribute('aria-busy');controls.forEach(([el,disabled])=>el.disabled=disabled);}
  }
  window.SiteCustomer={avatarHTML,mount,save,fieldError,clearErrors,saveWithFeedback,forget:()=>localStorage.removeItem(receiptKey)};
})();
