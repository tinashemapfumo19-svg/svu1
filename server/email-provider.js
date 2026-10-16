import { Webhook } from 'svix';
import { validNotificationDestination } from './notification-queue.js';

export function loadEmailConfig(env = process.env) {
  const provider=env.SVU_MAIL_PROVIDER || 'disabled';
  if (!['disabled','resend'].includes(provider)) throw new Error('SVU_MAIL_PROVIDER must be disabled or resend.');
  if (provider==='disabled') return {provider};
  const {SVU_MAIL_API_KEY:apiKey,SVU_MAIL_FROM:from,SVU_MAIL_WEBHOOK_SECRET:webhookSecret,SVU_PUBLIC_ORIGIN:origin,SVU_MAIL_ENABLED_AFTER:enabledAfter}=env;
  let url;
  try {url=new URL(origin);} catch {throw new Error('SVU_PUBLIC_ORIGIN requires an approved HTTPS origin.');}
  if (url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('SVU_PUBLIC_ORIGIN requires an approved HTTPS origin.');
  if (!apiKey || /\s/.test(apiKey) || !validNotificationDestination(from) || !/^whsec_[A-Za-z0-9+/=]+$/.test(webhookSecret || '') || Buffer.from(webhookSecret.slice(6),'base64').length<24
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(enabledAfter || '') || !Number.isFinite(Date.parse(enabledAfter))) throw new Error('Email delivery requires API key, single sender mailbox, webhook secret and UTC SVU_MAIL_ENABLED_AFTER.');
  return {provider,apiKey,from,webhookSecret,origin:url.origin,enabledAfter};
}

export function emailRequest(content,config) {
  if (!validNotificationDestination(content.recipientEmail) || typeof content.subject!=='string' || !content.subject.trim() || content.subject.length>998 || /[\r\n\x00]/.test(content.subject)
    || typeof content.body!=='string' || content.body.length>100000) throw Object.assign(new Error('Invalid email source'),{mailCode:'INVALID_CONTENT'});
  return {from:config.from,to:[content.recipientEmail],subject:content.subject,text:content.body.replaceAll('/#shared/invitation?token=',`${config.origin}/#shared/invitation?token=`)};
}

// The origin is fixed; queue data cannot choose an outbound endpoint or credentials.
export function resendAdapter(config,{fetchImpl=fetch}={}) {
  return async (message,{idempotencyKey,signal}) => {
    let response;
    try {response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(message)});}
    catch {throw Object.assign(new Error('Provider connection unavailable'),{mailCode:'PROVIDER_UNAVAILABLE',retryable:true});}
    let data;
    try {data=await response.json();} catch {throw Object.assign(new Error('Provider response invalid'),{mailCode:'INVALID_RESPONSE',retryable:true});}
    if (!response.ok) throw Object.assign(new Error('Provider rejected email'),{mailCode:`PROVIDER_HTTP_${response.status}`,retryable:response.status===429 || response.status>=500 || (response.status===409 && data?.name==='concurrent_idempotent_requests')});
    if (typeof data?.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) throw Object.assign(new Error('Provider response invalid'),{mailCode:'INVALID_RESPONSE',retryable:true});
    return {messageId:data.id};
  };
}

export function verifyEmailWebhook(raw,headers,config) {
  new Webhook(config.webhookSecret).verify(raw,headers);
  return JSON.parse(raw);
}
