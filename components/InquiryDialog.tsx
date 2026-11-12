"use client";

import { useRef, useState } from "react";
import { backendReady, submitInquiry } from "@/lib/backend";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function InquiryDialog({ open, onOpenChange, listingId, requestText = "" }: { open: boolean; onOpenChange: (open: boolean) => void; listingId?: string; requestText?: string }) {
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [viewingAt, setViewingAt] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<{signature:string;id:string}|null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !consent) return;
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setMessage("请输入 11 位中国大陆手机号。"); return; }
    setBusy(true); setMessage("");
    try {
      const payload = { listing_id: listingId || null, request_text: requestText || null, company: company.trim(), contact: contact.trim(), phone: phone.trim(), viewing_at: viewingAt ? new Date(viewingAt).toISOString() : null };
      const signature=JSON.stringify(payload);
      if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
      await submitInquiry(payload,request.current!.id);
      request.current=null;
      setMessage("需求已提交，工作人员会根据你填写的联系方式跟进。");
      setCompany(""); setContact(""); setPhone(""); setViewingAt(""); setConsent(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="inquiry-dialog"><DialogHeader><DialogTitle>{listingId ? "预约看房" : "留下选址需求"}</DialogTitle><DialogDescription>填写需求后由工作人员联系。联系方式仅用于本次咨询。</DialogDescription></DialogHeader>
    {!backendReady ? <div className="feature-pending"><strong>线上预约尚未开通</strong><p>房源资料正在整理，后台数据服务尚未接入。开通后这里可以直接提交预约。</p></div> : <form className="inquiry-form" onSubmit={submit}>
      <label>企业名称<input value={company} onChange={e=>setCompany(e.target.value)} required maxLength={80} placeholder="请输入企业名称"/></label>
      <label>联系人<input value={contact} onChange={e=>setContact(e.target.value)} required maxLength={40} placeholder="请输入联系人"/></label>
      <label>联系电话<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} required maxLength={11} placeholder="请输入手机号"/></label>
      {listingId && <label>希望看房时间<input type="datetime-local" value={viewingAt} onChange={e=>setViewingAt(e.target.value)}/></label>}
      <label className="inquiry-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span>同意将以上信息用于本次选址咨询和看房联系。</span></label>
      {message && <p role="status" className="form-message">{message}</p>}
      <button className="primary-action" disabled={busy} type="submit">{busy ? "正在提交…" : "提交咨询"}</button>
    </form>}
  </DialogContent></Dialog>;
}
