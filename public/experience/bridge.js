/* Public catalog, anonymous aggregate events, and receipt-protected inquiry replies.
   This adapter never writes listings and carries no management credential. */
(function () {
  const config = window.__SITE_BACKEND__ || {};
  const url = String(config.url || '').replace(/\/$/, '');
  const key = String(config.key || '');
  const headers = { apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json' };
  let repliesAt = 0, listingsRequest = null;
  if (!url || !key) {
    State.listingsLoading=false;State.listingsError=true;
    State.listingsErrorMessage='网站数据服务尚未连接，请联系网站管理员。';
    State.listingsErrorCode='CONFIG_MISSING';Api.db.listings=[];render();return;
  }
  // Only retry catalog GETs. Submission/reply RPCs must not be replayed here.
  async function read(path,body,options={}) {
    const attempts=body===undefined?(options.attempts||1):1;
    for(let attempt=0;attempt<attempts;attempt++) {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),options.timeout||10000);
      try {
        const response=await fetch(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,cache:'no-store',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
        if(!response.ok) {
          const error=new Error('HTTP '+response.status);error.status=response.status;throw error;
        }
        const result=await response.json();
        if(options.array&&!Array.isArray(result)) {
          const error=new Error('Invalid catalog response');error.code='INVALID_RESPONSE';throw error;
        }
        return result;
      }catch(error) {
        const retryable=!error.status||error.status===408||error.status===429||error.status>=500;
        if(attempt+1>=attempts||!retryable)throw error;
      }finally{clearTimeout(timer);}
      await new Promise(resolve=>setTimeout(resolve,600*(attempt+1)+Math.random()*250));
    }
  }
  function syncParks() {
    // Legacy filter key "park" now represents a public region, never a real park.
    Api.db.parks=PUBLIC_REGIONS.map(name=>({name,addr:'',lat:0,lon:0,x:50,y:50,precise:false}));
    if(State.filters?.park&&State.filters.park!=='全部'&&!PUBLIC_REGIONS.includes(State.filters.park))State.filters.park='全部';
  }
  async function catalog() {
    const results=await Promise.allSettled([read('site_settings?select=*&id=eq.true',undefined,{array:true})]);
    if(results[0].status==='fulfilled'&&results[0].value[0]) {
      const setting=results[0].value[0],st=Api.db.settings;
      st.siteName=setting.platform_name||st.siteName;st.hotline=setting.hotline||'';
      st.share={...st.share,title:setting.share_title||st.siteName,desc:setting.share_description||'',img:setting.share_image||''};
      if(typeof updateSiteHeader==='function')updateSiteHeader();
      if(typeof applyShareMeta==='function')applyShareMeta();
    }
    syncParks();
    // Metadata never blocks or changes the success state of the listing request.
    if(!State.listingsLoading&&['home','map'].includes(State.view))render();
  }
  const mapRow = row => ({
    id:row.id,listingCode:window.SiteListingCodes.parse(row.listing_code),title:row.title||'',region:PUBLIC_REGIONS.includes(row.region)?row.region:null,parkName:PUBLIC_REGIONS.includes(row.region)?row.region:'',building:'',room:'',floor:row.floor||'',legacyUnit:'',
    area:Number(row.area)||0,orientation:row.facing||'待补充',decoration:row.decoration||'待补充',layout:row.layout||'待补充',
    rent:row.price==null?null:Number(row.price),propertyFee:row.fee==null?null:Number(row.fee),
    photos:Array.isArray(row.images)?row.images:[],photosLoaded:true,videos:Array.isArray(row.videos)?row.videos:[],status:'online',usage:row.category||'写字楼',
    contact:row.contact_name||'招商顾问',phone:row.contact_phone||Api.db.settings.hotline||'',address:'',desc:row.description||'',tag:row.tag||'',views:Number(row.views)||0,
    agentFee:typeof row.has_agent_fee==='boolean'?row.has_agent_fee:null,wechat:row.wechat||'',videoChannel:row.video_channel||'',
    paymentTerms:row.payment_terms||'',freeRentPeriod:row.free_rent_period||'',facilities:row.supporting_facilities||'',
    industrialFields:[['适配行业',row.compatible_industries],['层高',row.factory_height],['承重',row.factory_load],['配电',row.factory_power],['消防',row.fire_rating],['环评',row.environmental_requirements],['行车支撑（牛角）',row.has_crane_support],['货梯载重',row.freight_elevator_load],['货梯尺寸',row.freight_elevator_size],['客梯',row.has_passenger_elevator],['上下水',row.has_water]].filter(([,value])=>value!=null&&value!=='').map(([label,value])=>[label,typeof value==='boolean'?(value?'有':'无'):value]),
    lat:0,lng:0,firstPublishedAt:row.first_published_at||null,createdAt:row.created_at||new Date().toISOString(),updatedAt:row.updated_at||row.created_at||new Date().toISOString()
  });
  function refreshListings() {
    if(listingsRequest)return listingsRequest;
    State.listingsLoading=true;State.listingsError=false;
    State.listingsErrorMessage='';State.listingsErrorCode='';Api.db.listings=[];
    render();
    listingsRequest=(async()=>{
      try {
        const rows=await read('public_listings?select=*&order=created_at.desc',undefined,{attempts:3,array:true});
        Api.db.listings=rows.map(mapRow);syncParks();
        State.listingsLoading=false;State.listingsError=false;
        if(State.deepPending) {
          const item=findListing(State.deepPending);State.deepPending=null;
          if(item){State.params.id=item.id;setView('detail',false);}else render();
        }else render();
        if(State.view==='detail')window.SiteTelemetry?.view(State.params.id);
      }catch(error) {
        State.listingsLoading=false;State.listingsError=true;Api.db.listings=[];
        State.listingsErrorCode=error.status?'HTTP_'+error.status:error.name==='AbortError'?'TIMEOUT':error.code||'NETWORK';
        State.listingsErrorMessage=error.status===401||error.status===403
          ?'房源服务配置异常，请联系网站管理员。'
          :error.status===429?'访问较多，请稍后点击重新加载。'
          :'暂时无法连接房源服务，已自动重试。请切换网络后重新加载。';
        console.error('读取已发布房源失败：'+State.listingsErrorCode);render();
      }
    })().finally(()=>{listingsRequest=null;});
    return listingsRequest;
  }
  let visitor,session;
  try {
    visitor=localStorage.getItem('site_metrics_visitor');if(!visitor){visitor=crypto.randomUUID();localStorage.setItem('site_metrics_visitor',visitor);}
    session=sessionStorage.getItem('site_metrics_session');if(!session){session=crypto.randomUUID();sessionStorage.setItem('site_metrics_session',session);}
  }catch(_){visitor=crypto.randomUUID();session=crypto.randomUUID();}
  const sent=new Set();
  async function record(kind,listingId) {
    if(navigator.doNotTrack==='1')return;
    const event=kind+':'+(listingId||'');if(sent.has(event))return;sent.add(event);
    try {await read('rpc/record_site_event',{p_visitor:visitor,p_session:session,p_kind:kind,p_listing:listingId||null});}
    catch(_){sent.delete(event);}
  }
  window.SiteTelemetry={view:id=>{if(id)void record('listing_view',id);}};
  window.refreshSiteReplies=async function () {
    if(Date.now()-repliesAt<15000)return;repliesAt=Date.now();
    const messages=(Api.db.messages||[]).filter(x=>x.receipt&&x.visitorId===State.session.visitor?.id).slice(-100);
    const results=await Promise.allSettled(messages.map(async item=>{
      const result=await read('rpc/read_site_reply',{p_receipt:item.receipt});
      if(result?.withdrawn){
        Api.db.messages=Api.db.messages.filter(m=>m.id!==item.id);
        const profile=curVisitor();
        if(profile?.companyReceipt===item.receipt){delete profile.companyReceipt;delete profile.companyAt;}
        if(profile)profile.needs=(profile.needs||[]).filter(n=>n.nid!==item.id);
      }else if(result){item.status=result.status||'pending';item.reply=result.reply||'';item.repliedAt=result.replied_at||'';}
    }));
    if(results.some(x=>x.status==='fulfilled')){try{Api.save();saveSession();}catch(_){}if(State.view==='message')render();}
  };
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&State.view==='message')void window.refreshSiteReplies();});
  setInterval(()=>{if(document.visibilityState==='visible'&&State.view==='message')void window.refreshSiteReplies();},30000);
  window.refreshSiteListings=refreshListings;
  window.addEventListener('online',()=>{if(State.listingsError)void refreshListings();});
  void record('visit',null);void refreshListings();
  void catalog().catch(()=>{/* Optional metadata must never hide published listings. */});
})();
