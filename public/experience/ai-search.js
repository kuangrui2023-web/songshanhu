/* Only the public Supabase project key is sent by this client. */
(() => {
  const displayText=value=>String(value||'').replace(/deepseek/gi,'AI 服务');
  const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
  function isContactQuestion(query){
    const q=normalize(query);
    if(/不(?:要|用|需).{0,12}(?:联系|打电话)|别.*(?:打电话|联系)/.test(q))return false;
    return /联系方式|联系电话|电话号码|手机号|微信号|怎么联系|如何联系|联系谁|找谁|联系招商|联系顾问|电话多少|电话是|给.{0,10}电话|要.{0,10}电话|(?:招商|顾问|你们|负责人|房东|业主|房源联系人).{0,8}(?:电话|微信|联系)/.test(q);
  }
  async function contactAnswer(query,config,{signal,contextIds=[]}={}){
    const result=reply=>({intent:'contact',reply,ids:[],matches:[],summary:[],calledModel:false});
    if(/房东|业主|内部联系人|房源联系人|园区负责人/.test(query))return result('内部房源联系人和业主联系方式不公开。请联系房源详情中的公开招商顾问，由顾问协助对接。');
    const url=String(config.url).replace(/\/$/,''),headers={apikey:config.key,Authorization:'Bearer '+config.key};
    const read=async path=>{
      const response=await fetch(url+'/rest/v1/'+path,{headers,signal,cache:'no-store'});
      if(!response.ok)throw new Error('暂时无法读取公开招商联系方式，请稍后重试或打开房源详情查看招商联系。');
      const rows=await response.json();
      if(!Array.isArray(rows))throw new Error('公开联系资料暂时无法读取，请稍后重试。');
      return rows;
    };
    // Read only the already-public projection; never query management records.
    const q=normalize(query),code=q.match(/(?:^|[^\d])(\d{6})(?!\d)/)?.[1];
    const rows=await read('public_listings?select=id,listing_code,title,contact_name,contact_phone,wechat&order=created_at.desc&limit=201');
    let selected=code?rows.filter(row=>String(row.listing_code)===code):rows.filter(row=>normalize(row.title).length>=4&&q.includes(normalize(row.title)));
    const contextual=/这套|这间|这个房|刚才|上面|推荐|第[一二三123]/.test(q);
    if(!code&&!selected.length&&contextual){
      const ids=Array.isArray(contextIds)?contextIds:[];
      const ordinal=q.match(/第([一二三123])/),index=ordinal?{'一':0,'二':1,'三':2,'1':0,'2':1,'3':2}[ordinal[1]]:null;
      selected=rows.filter(row=>index===null?ids.includes(row.id):row.id===ids[index]);
    }
    if(code&&!selected.length)return result('没有找到编号 '+code+' 的在租房源，可能已下架。请核对编号，或通过留言咨询招商。');
    if(contextual&&!selected.length)return result('你想联系哪一套房源的招商顾问？请告诉我房源编号，或先选中一套房源。');
    const clean=value=>String(value||'').trim().slice(0,100);
    const contact=row=>({name:clean(row.contact_name)||'招商顾问',phone:clean(row.contact_phone),wechat:clean(row.wechat)});
    const format=c=>[c.name,c.phone?'电话：'+c.phone:'',c.wechat?'微信：'+c.wechat:''].filter(Boolean).join('，');
    if(selected.length){
      if(selected.length>3)return result('当前涉及多套房源，请告诉我具体房源编号，我帮你查询对应的公开招商联系方式。');
      const settings=selected.some(row=>!row.contact_phone)?await read('site_settings?select=hotline&id=eq.true'):[];
      const hotline=clean(settings[0]?.hotline);
      return result(selected.map(row=>{
        const c=contact(row);if(!c.phone)c.phone=hotline;
        return (row.listing_code?'房源编号 '+row.listing_code+'：':'该房源：')+(c.phone||c.wechat?format(c):'暂未填写公开招商联系方式，请在网站留言咨询。');
      }).join('\n'));
    }
    const settings=await read('site_settings?select=hotline&id=eq.true');
    const hotline=clean(settings[0]?.hotline);
    if(hotline)return result('网站公开招商热线：'+hotline+'。');
    const contacts=[...new Map(rows.map(contact).filter(c=>c.phone||c.wechat).map(c=>[c.phone+'|'+c.wechat,c])).values()];
    if(contacts.length===1)return result('目前已发布房源的公开招商联系方式：'+format(contacts[0])+'。');
    return result(contacts.length?'网站暂未设置统一招商热线，不同房源可能由不同顾问负责。请告诉我房源编号，或打开房源详情查看“招商联系”。':'网站暂未填写公开招商联系方式，请通过“留言咨询”提交需求；联系方式补充后即可在这里查询。');
  }
  async function search(query,{history=[],filters={},contextIds=[],signal,onStage=()=>{}}={}){
    const config=window.__SITE_BACKEND__||{};
    if(!config.url||!config.key)throw new Error('AI 找房服务尚未连接。');
    const timeout=new AbortController(),abort=()=>timeout.abort();
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    const timer=setTimeout(abort,55000);
    try{
      if(isContactQuestion(query)){
        onStage('researching');
        return await contactAnswer(query,config,{signal:timeout.signal,contextIds});
      }
      const response=await fetch(String(config.url).replace(/\/$/,'')+'/functions/v1/ai-search',{
        method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
        body:JSON.stringify({query,history,filters}),signal:timeout.signal,cache:'no-store'
      });
      if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(displayText(error?.message)||'AI 服务暂时无法连接，请稍后重试。');}
      if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('AI 服务返回异常，请稍后重试。');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
      try{
        while(true){
          const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
          let end;while((end=buffer.indexOf('\n\n'))!==-1){
            const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
            const event=block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
            const data=JSON.parse(block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n'));
            if(event==='stage'&&['thinking','researching','analyzing','writing'].includes(data.state))onStage(data.state);
            if(event==='error')throw new Error(displayText(data.message)||'AI 暂时未能完成请求。');
            if(event==='result')result=data;
          }
          if(buffer.length>100000)throw new Error('AI 响应异常，请重试。');
          if(done)break;
        }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(!result||!Array.isArray(result.ids)||typeof result.reply!=='string')throw new Error('AI 没有返回完整结果，请重试。');
      return {...result,reply:displayText(result.reply),matches:Array.isArray(result.matches)?result.matches.map(item=>({...item,reason:displayText(item.reason)})):[],summary:Array.isArray(result.summary)?result.summary.map(displayText):[]};
    }catch(error){
      if(error.name==='AbortError')throw new Error(signal?.aborted?'本次找房已取消。':'AI 响应超时，请重试或使用筛选。');
      if(error instanceof TypeError)throw new Error('暂时无法连接 AI 服务，请检查网络后重试。');
      throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  window.SiteAI={search,isContactQuestion};
})();
