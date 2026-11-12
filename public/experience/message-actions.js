/* Visitor-owned messages: inline confirmation + receipt-protected withdrawal. */
(() => {
  let opened=null,busy=null,done=null,redo=null,error='',owner=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const own=id=>(Api.db.messages||[]).find(m=>m.id===id&&m.visitorId===State.session.visitor?.id);
  const widget=id=>Array.from(document.querySelectorAll('.message-delete')).find(el=>el.dataset.messageDelete===id);
  const check='<path d="m5 12 4 4L19 6"/>';
  function buttonHTML(m){
    if(owner!==State.session.visitor?.id){opened=null;redo=null;owner=State.session.visitor?.id;}
    const open=opened===m.id,pending=busy===m.id,success=done===m.id;
    const label=m.receipt?'删除并撤回留言':'移除本机记录';
    return `<div class="msg-delete-row"><p class="msg-delete-note${open?' visible':''}">${esc(m.receipt?'删除后将撤回后台待处理留言，可修改后重新提交。':'这条是仅本机记录，移除不会撤回后台信息。')}</p><div class="message-delete${open?' open':''}${pending?' pending':''}${success?' done':''}" data-message-delete="${esc(m.id)}">
      <button class="msg-delete-trigger" type="button" data-message-action="toggle" aria-label="${label}" aria-expanded="${open}"${pending||success?' disabled':''}><svg class="msg-bin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="bin-wall" d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><g class="bin-lid"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></g></svg><svg class="msg-delete-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${check}</svg><span class="msg-delete-spinner" aria-hidden="true"></span></button>
      <div class="msg-delete-panel"${open?'':' inert'}><button type="button" data-message-action="confirm" aria-label="确认${label}"${pending?' disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${check}</svg></button><button type="button" data-message-action="cancel" aria-label="取消删除"${pending?' disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      </div><span class="msg-delete-status${error&&open?' error':''}" role="status" aria-live="polite">${esc(open&&error?error:success?(m.receipt?'已撤回':'已移除'):pending?'正在撤回…':'')}</span></div>`;
  }
  function update(id){
    const el=widget(id);if(!el)return;
    const open=opened===id;
    el.classList.toggle('open',open);el.classList.toggle('pending',busy===id);el.classList.toggle('done',done===id);
    el.querySelector('.msg-delete-trigger').setAttribute('aria-expanded',String(open));
    el.querySelector('.msg-delete-panel').inert=!open;
    el.querySelectorAll('button').forEach(b=>b.disabled=busy===id||done===id);
    el.parentElement.querySelector('.msg-delete-note').classList.toggle('visible',open);
    const status=el.parentElement.querySelector('.msg-delete-status');
    status.textContent=error&&open?error:done===id?(own(id)?.receipt?'已撤回':'已移除'):busy===id?'正在撤回…':'';
    status.classList.toggle('error',!!error&&open);
  }
  function close(){if(!opened||busy)return;const id=opened;opened=null;error='';update(id);widget(id)?.querySelector('.msg-delete-trigger').focus({preventScroll:true});}
  async function withdraw(message){
    if(!message.receipt)return;
    const config=window.__SITE_BACKEND__||{};
    if(!config.url||!config.key)throw new Error('撤回服务未连接，请稍后重试');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(String(config.url).replace(/\/$/,'')+'/rest/v1/rpc/withdraw_site_inquiry',{
        method:'POST',signal:controller.signal,headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({p_id:message.id,p_receipt:message.receipt})
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(response.status===404?'撤回功能尚未就绪，请稍后重试':result?.message||'撤回未完成，请重试');
      if(!result?.withdrawn||result.id!==message.id)throw new Error('未收到撤回确认，请重试');
    }catch(e){if(e.name==='AbortError')throw new Error('等待超时，请重试确认撤回结果');throw e;}finally{clearTimeout(timer);}
  }
  async function confirm(id){
    const message=own(id);if(!message||busy||opened!==id)return;
    const visitor=State.session.visitor.id;
    busy=id;error='';update(id);
    try{
      await withdraw(message);
      if(State.session.visitor?.id!==visitor)return;
      opened=null;done=id;busy=null;update(id);
      await wait(reduced()?150:950);
      // Only discard the local receipt after the server confirmed withdrawal.
      Api.db.messages=Api.db.messages.filter(m=>!(m.id===id&&m.visitorId===visitor));
      if(message.requestSignature)intakeRequests.delete(message.requestSignature);
      const profile=curVisitor();
      if(profile?.companyReceipt===message.receipt){delete profile.companyReceipt;delete profile.companyAt;}
      if(profile)profile.needs=(profile.needs||[]).filter(n=>n.nid!==id);
      redo={...message};owner=visitor;
      try{Api.save();saveSession();}catch(_){/* The server withdrawal remains authoritative. */}
      const card=widget(id)?.closest('.msg-item');
      if(card?.animate&&!reduced())await card.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-8px)'}],{duration:280,easing:'ease-out',fill:'forwards'}).finished.catch(()=>{});
      done=null;
      if(State.session.visitor?.id===visitor){refresh();document.querySelector('[data-message-action="redo"]')?.focus({preventScroll:true});}
    }catch(e){error=e.message||'撤回失败，请稍后重试';}
    finally{busy=null;update(id);}
  }
  function redoHTML(){
    if(!redo||redo.visitorId!==State.session.visitor?.id)return '';
    return `<div class="message-redo" role="status"><div><b>${redo.receipt?'留言已删除并撤回':'本机记录已移除'}</b><p>可带回原文，改好后重新提交。</p></div><button type="button" class="op-btn pri" data-message-action="redo">修改后重新留言</button></div>`;
  }
  function editAgain(){
    if(!redo||redo.visitorId!==State.session.visitor?.id)return;
    if(redo.kind==='company'){
      sheetMyCompany();
      const fields={coName:'name',coIndustry:'industry',coProduct:'product',coIntro:'intro'};
      for(const [id,key] of Object.entries(fields))if(redo.details?.[key]!==undefined&&$('#'+id))$('#'+id).value=redo.details[key];
      if($('#intakeContact'))$('#intakeContact').value=redo.name||'';
      if($('#intakePhone'))$('#intakePhone').value=redo.phone||'';
      return;
    }
    if(redo.kind==='need'){
      sheetMyNeeds();
      const original=(curVisitor()?.needs||[]).find(n=>n.nid===redo.id),match=/^【([^】]+)】([\s\S]*)$/.exec(redo.content||'');
      const type=redo.details?.type||original?.type||match?.[1];
      if(type&&Array.from($('#ndType').options).some(o=>o.value===type))$('#ndType').value=type;
      $('#ndDesc').value=redo.details?.description||original?.desc||match?.[2]||redo.content||'';
      if($('#intakeContact'))$('#intakeContact').value=redo.name||'';
      if($('#intakePhone'))$('#intakePhone').value=redo.phone||'';
    }else{
      sheetInquiry(findListing(redo.listingId)?redo.listingId:null,redo.type,{name:redo.name,phone:redo.phone,content:redo.content,type:redo.type});
      if($('#inqName'))$('#inqName').value=redo.name||'';
      if($('#inqPhone'))$('#inqPhone').value=redo.phone||'';
    }
  }
  window.SiteMessageActions={buttonHTML,redoHTML};
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-message-action]');
    if(!action){if(opened&&!event.target.closest('.message-delete'))close();return;}
    const id=action.closest('[data-message-delete]')?.dataset.messageDelete;
    if(action.dataset.messageAction==='redo'){editAgain();return;}
    if(!own(id))return;
    if(action.dataset.messageAction==='confirm'){void confirm(id);return;}
    if(action.dataset.messageAction==='cancel'||opened===id){close();return;}
    if(busy)return;
    if(opened){const old=opened;opened=null;update(old);}
    opened=id;error='';update(id);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!busy){event.preventDefault();close();}});
})();
