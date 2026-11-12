'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInquiries, type SavedInquiry } from '@/lib/backend';
import { beijingDate, isPendingInquiry, newPendingInquiryIds } from '@/lib/inquiries';

export function InquiryNotifier({rows,onRows,onOpen,blocked=false,visible=true}:{rows:SavedInquiry[];onRows:(rows:SavedInquiry[])=>void;onOpen:()=>void;blocked?:boolean;visible?:boolean}){
  const seen=useRef(new Set(rows.map(item=>item.id))),audio=useRef<AudioContext|null>(null),alive=useRef(true),checking=useRef(false);
  const [sound,setSound]=useState(false),[unread,setUnread]=useState<string[]>([]),[last,setLast]=useState(''),[error,setError]=useState(''),[audioError,setAudioError]=useState(''),[polling,setPolling]=useState(false);
  const soundEnabled=useRef(false);
  const play=useCallback(async()=>{
    const context=audio.current;
    if(!context)throw new Error('请先点击开启声音提醒。');
    if(context.state!=='running')await context.resume();
    if(context.state!=='running')throw new Error('浏览器暂停了声音，请重新点击试听。');
    const now=context.currentTime;
    [660,880].forEach((frequency,index)=>{const tone=context.createOscillator(),gain=context.createGain(),start=now+index*.22;tone.type='sine';tone.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.08,start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+.18);tone.connect(gain);gain.connect(context.destination);tone.start(start);tone.stop(start+.2);});
  },[]);
  const observe=useCallback((next:SavedInquiry[])=>{
    const fresh=newPendingInquiryIds(next,seen.current),pending=new Set(next.filter(isPendingInquiry).map(item=>item.id));
    next.forEach(item=>seen.current.add(item.id));
    setUnread(current=>Array.from(new Set([...current.filter(id=>pending.has(id)),...fresh])));
    if(fresh.length&&soundEnabled.current)void play().catch(()=>{if(alive.current){soundEnabled.current=false;setSound(false);setAudioError('声音未能播放，请点击开启声音提醒并试听；文字提示仍有效。');}});
  },[play]);
  useEffect(()=>{observe(rows);},[rows,observe]);
  const poll=useCallback(async()=>{
    if(checking.current||document.visibilityState==='hidden')return;
    checking.current=true;setPolling(true);
    try{const next=await loadInquiries();if(!alive.current)return;observe(next);onRows(next);setLast(beijingDate(new Date().toISOString()));setError('');}
    catch{if(alive.current)setError('留言检查失败，已有资料保留；稍后自动重试，也可手动检查。');}
    finally{checking.current=false;if(alive.current)setPolling(false);}
  },[observe,onRows]);
  useEffect(()=>{
    alive.current=true;
    const tick=()=>{void poll();},timer=setInterval(tick,15000);
    document.addEventListener('visibilitychange',tick);window.addEventListener('online',tick);
    return()=>{alive.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('online',tick);void audio.current?.close().catch(()=>{});audio.current=null;};
  },[poll]);
  async function enableSound(){
    try{
      const Ctor=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Ctor)throw new Error('当前浏览器不支持声音提醒，可使用文字提醒。');
      if(!audio.current||audio.current.state==='closed')audio.current=new Ctor();
      await play();if(!alive.current)return;soundEnabled.current=true;setSound(true);setAudioError('');
    }catch(e){soundEnabled.current=false;setSound(false);setAudioError(e instanceof Error?e.message:'声音未能开启，请重试。');}
  }
  return <section hidden={!visible} className="workspace-card inquiry-notifier" aria-label="新留言提醒">
    <div className="workspace-card-heading"><h2>新留言提醒</h2><span>{sound?'声音已开启':'声音未开启'}</span></div>
    <div className="workspace-actions"><button className="admin-secondary" type="button" onClick={()=>void enableSound()}>{sound?'试听提醒音':'开启声音提醒'}</button>{sound&&<button type="button" className="admin-secondary" onClick={()=>{soundEnabled.current=false;setSound(false);}}>关闭声音</button>}<button type="button" className="admin-secondary" disabled={polling} onClick={()=>void poll()}>{polling?'检查中…':'检查新留言'}</button></div>
    <p className="workspace-help">后台页面保持打开且可见时，每 15 秒检查一次；首次打开不把历史留言当作新留言。切回页面会补查。锁屏或关闭网页后不能保证提醒，不会发送短信或微信通知。</p>
    {last&&<small className="workspace-help">上次检查：{last}（北京时间）</small>}
    {unread.length>0&&<div className="inquiry-new-alert" role="status" aria-live="polite"><strong>收到 {unread.length} 条新待回复留言</strong><button type="button" disabled={blocked} className="admin-primary" onClick={()=>{setUnread([]);onOpen();}}>查看新留言</button></div>}
    {error&&<p className="admin-error" role="status">{error}</p>}{audioError&&<p className="admin-error" role="status">{audioError}</p>}
  </section>;
}
