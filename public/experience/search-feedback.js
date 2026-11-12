/* AiStatus interaction adapted from the user-provided Rare UI reference.
 * Status events come from the server; no artificial thinking/research timers. */
(() => {
  const home=document.getElementById('view-home');
  const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  let draft=null,run=null,serial=0,timer=0,before=null,selection=null,request=null,history=[];
  const labels={thinking:'正在理解需求',researching:'正在读取房源',analyzing:'正在匹配条件',writing:'正在整理结果',done:'匹配完成',error:'暂时未能完成'};
  const icons={
    thinking:'<path class="status-spark" d="M11 5Q12 12 19 13Q12 14 11 21Q10 14 3 13Q10 12 11 5Z" fill="currentColor"/><path class="status-twinkle" d="M18 2Q18.4 4.6 21 5Q18.4 5.4 18 8Q17.6 5.4 15 5Q17.6 4.6 18 2Z" fill="currentColor"/>',
    researching:'<g class="status-lens"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m14.75 14.75 4.25 4.25"/></g>',
    analyzing:'<path class="status-bar b1" d="M6 10v9"/><path class="status-bar b2" d="M12 5v14"/><path class="status-bar b3" d="M18 12v7"/>',
    writing:'<path class="status-ink" pathLength="1" d="M3 19c1.1-2.7 2.1-2.7 3.2 0s2.1 2.7 3.1 0 2.1-2.7 3.2 0"/><path class="status-pen" d="m10 13 7-7 3 3-7 7-4 1z"/>',
    done:'<path class="status-check" pathLength="1" d="m5 12.5 5 5 9-10.5"/>',
    error:'<path d="m7 7 10 10M17 7 7 17"/>'
  };
  const value=()=>draft===null?(State.filters.kw||''):draft;
  function markup(list){
    const active=run&&!['done','error'].includes(run.state);
    const currentCount=run?.state==='done'&&!State.listingsLoading&&!State.listingsError?applyFilters(list||[],State.filters).length:null;
    const message=run?.message||'';
    const shown=(run?.matches||[]).map(m=>({item:(list||[]).find(l=>l.id===m.id),reason:m.reason})).filter(m=>m.item&&applyFilters([m.item],State.filters).length);
    const known=(list||[]).map(l=>l.parkName).find(name=>name&&name!=='园区待补充');
    const examples=['厂房，3000平以上','写字楼，200–500平','月租10000元以内'];
    if(known)examples.push(known);
    return `<div class="searchbar search-conversation">
      <div class="search-heading"><h2>AI找房</h2></div>
      <div class="search-composer"><label class="sr-only" for="homeSearch">找房需求与补充条件</label><textarea id="homeSearch" rows="2" maxlength="240" enterkeyhint="send" placeholder="${history.length?'可以继续补充面积、预算、装修等要求，我帮你进一步筛选':'输入你想要的写字楼/厂房，我帮你找'}" aria-describedby="homeSearchPrivacy">${esc(value())}</textarea>
        <button type="button" class="search-send" data-act="search:submit" ${active||!String(value()).trim()?'disabled':''} aria-label="${active?'AI 正在找房':'发送找房需求'}" title="${active?'正在匹配房源':'发送找房需求'}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5m-5 5 5-5 5 5"/></svg></button>
      </div>
      <p class="search-disclosure" id="homeSearchPrivacy">描述需求即可由 AI 推荐，再补充条件继续筛选。使用 AI 时需求会发送至 AI 服务，请勿填写私人信息。</p>
      ${run?`<div class="search-exchange"><div class="search-question">${esc(run.query)}</div><div class="search-status" data-state="${run.state}" data-start="${run.started}" data-active="${active?'true':'false'}" role="status" aria-live="polite" aria-atomic="true"><span class="search-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[run.state]}</svg></span><div class="search-status-copy"><strong class="search-status-label">${labels[run.state]}</strong><span class="search-status-detail">${run.state==='done'?(Number(run.elapsed)<1?'不到 1 秒':`用时 ${run.elapsed} 秒`):'已发布房源'}</span><span class="search-status-timer" aria-hidden="true">${active?'0秒':''}</span></div></div>
        ${message?`<div class="search-response" ${run.state==='error'?'role="alert"':''}>${esc(message)}${run.criteria?.length?`<div class="search-recognized">${run.criteria.map(text=>`<span>${esc(text)}</span>`).join('')}</div>`:''}</div>`:''}
        ${run.state==='done'?`<div class="search-result-meta">${run.contactQuestion?'已查询公开招商资料':run.codeSearch?'编号精确查询':run.calledModel?'AI 已返回推荐':'已读取房源'} · 当前显示 ${currentCount??0} 套${!run.codeSearch&&Object.entries(State.filters).some(([k,v])=>!['kw','sort'].includes(k)&&v!=='全部')?'（同时应用已选筛选）':''}</div>${shown.length?`<div class="search-picks">${shown.slice(0,3).map(({item,reason})=>`<button type="button" data-act="open:listing" data-id="${esc(item.id)}"><strong>${esc(item.title||item.building)}</strong><span>${esc(reason)}</span><small>${item.area}㎡ · ${item.rent==null?'租金面议':item.rent+' 元/㎡·月'} · 查看详情 →</small></button>`).join('')}</div>`:''}${!run.codeSearch?'<div class="search-ai-note">AI 推荐仅供参考，房源条件及费用以招商顾问确认为准。</div>':''}`:''}
        <div class="search-response-actions">${run.state==='error'?'<button type="button" data-act="search:retry">重新匹配</button>':''}<button type="button" data-act="search:clear">清空搜索</button></div>
      </div>`:`<div class="search-hot search-suggestions">${examples.map(text=>`<button class="hot-chip" type="button" data-act="search:quick" data-v="${esc(text)}">${esc(text)}</button>`).join('')}</div>`}
    </div>`;
  }
  function paint(){if(State.view==='home')render();}
  async function submit(preset){
    if(run&&!['done','error'].includes(run.state))return;
    const query=String(preset??document.getElementById('homeSearch')?.value??value()).trim();
    if(!query)return toast('先输入面积、预算或房源关键词');
    draft='';document.getElementById('homeSearch')?.blur();
    const id=++serial;
    request=new AbortController();
    run={query,started:Date.now(),state:'researching',message:'',criteria:[],matches:[]};paint();
    try{
      const contactQuestion=window.SiteAI.isContactQuestion?.(query);
      if(!contactQuestion&&(State.listingsLoading||State.listingsError))await window.refreshSiteListings?.();
      if(id!==serial)return;
      if(!contactQuestion&&State.listingsError)throw new Error(State.listingsErrorMessage||'房源暂时无法读取，请稍后重试。');
      const code=window.SiteListingCodes.parse(query);
      if(code){
        const matches=onlineListings().filter(l=>l.listingCode===code);
        selection={query,ids:matches.map(l=>l.id)};State.filters={...State.filters,kw:query,usage:'全部',park:'全部',area:'全部',rent:'全部',orientation:'全部',decoration:'全部',layout:'全部'};
        run={...run,state:'done',codeSearch:true,calledModel:false,elapsed:((Date.now()-run.started)/1000).toFixed(1),message:matches.length?`已找到房源编号 ${code}，点击下方房源查看详情。`:`没有找到编号 ${code} 的在租房源，请核对编号，或联系招商顾问确认是否已下架。`,matches:matches.map(l=>({id:l.id,reason:'房源编号：'+code}))};
        paint();return;
      }
      const result=await window.SiteAI.search(query,{history,filters:State.filters,contextIds:selection?.ids||[],signal:request.signal,onStage:state=>{if(id===serial){run.state=state;paint();}}});
      if(id!==serial)return;
      if(result.intent==='contact'){
        run={...run,contactQuestion:true,calledModel:false,state:'done',elapsed:((Date.now()-run.started)/1000).toFixed(1),message:result.reply};
        paint();return;
      }
      selection={query,ids:result.ids.filter(id=>onlineListings().some(l=>l.id===id))};
      State.filters.kw=query;
      run.criteria=result.summary||[];run.matches=result.matches||[];run.calledModel=result.calledModel;
      run.state='done';run.elapsed=((Date.now()-run.started)/1000).toFixed(1);
      run.message=result.reply;history=[...history,query].slice(-3);
      paint();
    }catch(error){if(id!==serial)return;draft=query;run.state='error';run.elapsed=((Date.now()-run.started)/1000).toFixed(1);run.message=error.message||'匹配未完成，请稍后重试。';paint();}
  }
  function clear(){serial++;request?.abort();request=null;run=null;selection=null;history=[];draft='';State.filters.kw='';paint();}
  function fitInput(input){
    input.style.height='auto';
    const styles=getComputedStyle(input),min=parseFloat(styles.minHeight)||100,max=parseFloat(styles.maxHeight)||260;
    input.style.height=Math.min(max,Math.max(min,input.scrollHeight))+'px';
    input.style.overflowY=input.scrollHeight>max?'auto':'hidden';
  }
  function updateComposer(input){
    draft=input.value;fitInput(input);
    const button=home?.querySelector('.search-send');
    if(button)button.disabled=!input.value.trim()||Boolean(run&&!['done','error'].includes(run.state));
  }
  function fill(text){
    const input=document.getElementById('homeSearch');if(!input)return;
    input.value=String(text).slice(0,240);updateComposer(input);
    input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
  }
  function bind(){
    const input=document.getElementById('homeSearch');if(!input)return;
    fitInput(input);
    input.oninput=()=>updateComposer(input);
    input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void submit();}};
  }
  window.addEventListener('resize',()=>{const input=document.getElementById('homeSearch');if(input)fitInput(input);},{passive:true});
  function updateTimer(){
    const status=home?.querySelector('.search-status[data-active="true"]');
    if(!status){clearInterval(timer);timer=0;return;}
    const el=status.querySelector('.search-status-timer');if(el)el.textContent=Math.floor((Date.now()-Number(status.dataset.start))/1000)+'秒';
  }
  window.HomeSearch={markup,submit,fill,clear,retry:()=>submit(run?.query),bind,matchIds:query=>selection?.query===query?selection.ids:null,
    beforeRender(el){
      if(el!==home)return;
      const status=home.querySelector('.search-status-copy'),input=document.getElementById('homeSearch');
      before={width:status?.getBoundingClientRect().width||0,state:home.querySelector('.search-status')?.dataset.state,query:home.querySelector('.search-question')?.textContent,focused:document.activeElement===input,start:input?.selectionStart,end:input?.selectionEnd};
    },
    afterRender(el){
      if(el!==home)return;
      const status=home.querySelector('.search-status'),copy=status?.querySelector('.search-status-copy');
      const changed=status&&(before?.state!==status.dataset.state||before?.query!==run?.query);
      if(changed&&!reduced()){
        status.classList.add('search-status-changing');
        const width=copy.getBoundingClientRect().width;
        if(before?.width)copy.animate([{width:before.width+'px'},{width:width+'px'}],{duration:500,easing:'cubic-bezier(.22,1.12,.36,1)'});
        if(run?.state==='done')home.querySelector('.search-response')?.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:450,easing:'cubic-bezier(.22,1,.36,1)'});
      }
      if(before?.focused){const input=document.getElementById('homeSearch');input?.focus({preventScroll:true});input?.setSelectionRange(before.start,before.end);}
      if(status?.dataset.active==='true'&&!timer){updateTimer();timer=setInterval(updateTimer,1000);}else if(status?.dataset.active!=='true'){clearInterval(timer);timer=0;}
      before=null;
    }
  };
})();
