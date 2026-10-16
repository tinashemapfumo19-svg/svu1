import test from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'svix';
import { loadEmailConfig,emailRequest,resendAdapter,verifyEmailWebhook } from '../server/email-provider.js';
import { emailEventOutcome,createEmailDelivery } from '../server/email-delivery.js';
import { loadConfig } from '../server/config.js';

const secret=`whsec_${Buffer.alloc(32,7).toString('base64')}`;
const env={SVU_MAIL_PROVIDER:'resend',SVU_MAIL_API_KEY:'test_only_key',SVU_MAIL_FROM:'sender@example.edu',SVU_MAIL_WEBHOOK_SECRET:secret,SVU_PUBLIC_ORIGIN:'https://portal.example.edu',SVU_MAIL_ENABLED_AFTER:'2026-10-09T00:00:00Z'};
test('mail is disabled by default and enabling requires complete bounded deployment settings',()=>{
  assert.deepEqual(loadEmailConfig({}),{provider:'disabled'});
  assert.equal(loadEmailConfig(env).origin,'https://portal.example.edu');
  for(const [key,value] of [['SVU_MAIL_PROVIDER','smtp'],['SVU_MAIL_API_KEY',''],['SVU_MAIL_FROM','a,b@example.edu'],['SVU_MAIL_WEBHOOK_SECRET','bad'],['SVU_PUBLIC_ORIGIN','http://portal.example.edu'],['SVU_PUBLIC_ORIGIN','https://user:password@portal.example.edu'],['SVU_PUBLIC_ORIGIN','https://portal.example.edu/path'],['SVU_MAIL_ENABLED_AFTER','yesterday']])assert.throws(()=>loadEmailConfig({...env,[key]:value}));
  assert.throws(()=>loadConfig({...env,SVU_ENV:'development'}),/explicit secure SVU_DATA_KEY/);
});
test('provider request uses one recipient, plain text and an approved public sharing link',()=>{
  const config=loadEmailConfig(env),request=emailRequest({recipientEmail:'recipient@example.edu',subject:'Invitation',body:'Open /#shared/invitation?token=PRIVATE'},config);
  assert.deepEqual(request.to,['recipient@example.edu']);assert.equal(request.text,'Open https://portal.example.edu/#shared/invitation?token=PRIVATE');
  for(const content of [{recipientEmail:'a,b@example.edu',subject:'x',body:'x'},{recipientEmail:'a@example.edu',subject:'x\r\nBcc: other@example.edu',body:'x'}])assert.throws(()=>emailRequest(content,config));
});
test('Resend adapter fixes its endpoint and forwards stable idempotency and abort controls',async()=>{
  let captured;
  const adapter=resendAdapter(loadEmailConfig(env),{fetchImpl:async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({id:'provider-id'})};}});
  const signal=new AbortController().signal,result=await adapter({subject:'x'},{idempotencyKey:'svu/notification',signal});
  assert.equal(result.messageId,'provider-id');assert.equal(captured.url,'https://api.resend.com/emails');assert.equal(captured.options.headers['Idempotency-Key'],'svu/notification');assert.equal(captured.options.signal,signal);assert.equal(captured.options.redirect,'error');
});
test('provider errors retain only safe codes and classify transient failures without logging bodies',async()=>{
  for(const [status,retryable] of [[400,false],[401,false],[429,true],[503,true]]) {
    const send=resendAdapter(loadEmailConfig(env),{fetchImpl:async()=>({ok:false,status,json:async()=>({message:'PRIVATE_PROVIDER_BODY'})})});
    await assert.rejects(send({},{}),error=>error.mailCode===`PROVIDER_HTTP_${status}` && error.retryable===retryable && !error.message.includes('PRIVATE_PROVIDER_BODY'));
  }
  await assert.rejects(resendAdapter(loadEmailConfig(env),{fetchImpl:async()=>{throw new Error('PRIVATE_KEY');}})({},{}),error=>error.retryable && !error.message.includes('PRIVATE_KEY'));
});
test('signed callbacks require the original body, a correct secret and fresh timestamp',()=>{
  const config=loadEmailConfig(env),body=JSON.stringify({type:'email.delivered'}),wh=new Webhook(secret),date=new Date(),id='event-test';
  const headers={'svix-id':id,'svix-timestamp':String(Math.floor(date.getTime()/1000)),'svix-signature':wh.sign(id,date,body)};
  assert.deepEqual(verifyEmailWebhook(body,headers,config),{type:'email.delivered'});
  assert.throws(()=>verifyEmailWebhook(`${body} `,headers,config));
  const old=new Date(Date.now()-600000);
  assert.throws(()=>verifyEmailWebhook(body,{...headers,'svix-timestamp':String(Math.floor(old.getTime()/1000)),'svix-signature':wh.sign(id,old,body)},config));
});
test('delivery outcomes cannot be downgraded by late or out-of-order provider callbacks',()=>{
  assert.equal(emailEventOutcome('accepted','email.delivered'),'delivered');
  assert.equal(emailEventOutcome('delivered','email.sent'),'delivered');
  assert.equal(emailEventOutcome('delivered','email.bounced'),'bounced');
  assert.equal(emailEventOutcome('complained','email.delivered'),'complained');
  assert.equal(emailEventOutcome('bounced','email.failed'),'bounced');
});
test('disabled workers never query or send and unrelated global roles cannot widen scoped authority',async()=>{
  const service=createEmailDelivery({query(){throw new Error('Unexpected query');}});
  assert.equal((await service.processEmailDeliveries()).configured,false);
  const actor={roles:[{scope:{intakeId:'other'},permissions:['integrations.view']},{scope:{},permissions:['applicant.self']}]};
  await assert.rejects(service.listEmailDeliveries({},actor),{statusCode:403});
});
