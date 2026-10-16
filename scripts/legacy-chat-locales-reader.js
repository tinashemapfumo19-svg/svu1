import {createHash} from 'node:crypto';

const maxBytes=256*1024;
const fail=(line,reason)=>{throw new Error(`Legacy locale preview: ${reason} at line ${line}. No PHP was executed.`);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceText(bytes) {
  if(!Buffer.isBuffer(bytes) || bytes.length>maxBytes)throw new Error('Legacy locale preview: source must be a bounded byte buffer.');
  try {const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))throw new Error();return value;}catch {throw new Error('Legacy locale preview: invalid UTF-8 or NUL source.');}
}

// A literal catalogue recognizer, not a PHP interpreter or a general PHP parser.
function reader(source) {
  let i=0,line=1;
  const advance=()=>{if(source[i]==='\n')line++;return source[i++];};
  function space() {
    while(i<source.length){
      if(/\s/.test(source[i])){advance();continue;}
      if(source.startsWith('//',i) || source[i]==='#'){while(i<source.length && source[i]!=='\n')advance();continue;}
      if(source.startsWith('/*',i)){const start=line;i+=2;while(i<source.length && !source.startsWith('*/',i))advance();if(i===source.length)fail(start,'unterminated comment');i+=2;continue;}
      break;
    }
  }
  function take(value) {space();if(!source.startsWith(value,i))fail(line,'unsupported catalogue syntax');i+=value.length;}
  function string() {
    space();const quote=advance(),start=line;if(quote!=="'" && quote!=='"')fail(start,'expected literal string');let result='';const chunks=[];
    const byte=value=>{chunks.push(Buffer.from(result,'utf8'),Buffer.from([value]));result='';};
    while(i<source.length){const c=advance();if(c===quote){if(!chunks.length)return result;chunks.push(Buffer.from(result,'utf8'));try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{fail(start,'escaped string is not valid UTF-8');}}
      if(c!=='\\'){if(quote==='"' && c==='$')fail(line,'interpolated string is not a literal');result+=c;continue;}
      if(i===source.length)fail(start,'unterminated string');const next=advance();
      if(quote==="'"){result+=next==="'" || next==='\\'?next:`\\${next}`;continue;}
      const escapes={n:'\n',r:'\r',t:'\t',v:'\v',e:'\x1b',f:'\f','$':'$', '"':'"','\\':'\\'};
      if(Object.hasOwn(escapes,next)){result+=escapes[next];continue;}
      if(/[0-7]/.test(next)){let digits=next;while(digits.length<3 && /[0-7]/.test(source[i] || ''))digits+=advance();byte(parseInt(digits,8)%256);continue;}
      if(next==='x' && /[a-f\d]/i.test(source[i] || '')){let digits=advance();if(/[a-f\d]/i.test(source[i] || ''))digits+=advance();byte(parseInt(digits,16));continue;}
      if(next==='u' && source[i]==='{')fail(line,'unsupported Unicode escape');
      result+=`\\${next}`;
    }
    fail(start,'unterminated string');
  }
  return {space,take,string,trailing(){if(source.slice(i).trim())fail(line,'non-PHP trailing content');i=source.length;},get line(){return line;},get done(){space();return i===source.length;},starts:value=>{space();return source.startsWith(value,i);}};
}

export function acceptedLanguages(bytes) {
  const source=sourceText(bytes),start='/*<GetAcceptedLanguage>*/',end='/*</GetAcceptedLanguage>*/';
  if(source.split(start).length!==2 || source.split(end).length!==2)throw new Error('Legacy locale preview: ambiguous language marker.');
  const at=source.indexOf(start)+start.length,stop=source.indexOf(end);if(stop<at)throw new Error('Legacy locale preview: reversed language marker.');
  const r=reader(source.slice(at,stop)),values=[];r.take('array');r.take('(');
  if(!r.starts(')'))for(;;){const value=r.string();if(!/^[a-z]{2,3}(?:_[A-Z]{2,3})?(?:-(?:formal|informal))?$/.test(value) || values.includes(value) || values.length>=64)fail(r.line,'invalid or duplicate language identifier');values.push(value);if(r.starts(')'))break;r.take(',');if(r.starts(')'))break;}
  r.take(')');r.take(';');if(!r.done || !values.length || !values.includes('en_US'))fail(r.line,'unsupported language list');return values;
}

export function catalogue(bytes) {
  const source=sourceText(bytes),r=reader(source),entries=[],values=new Map(),duplicates=[];r.take('<?php');
  while(!r.done){if(r.starts('?>')){r.take('?>');r.trailing();break;}
    const line=r.line;r.take('$GLOBALS');r.take('[');if(r.string()!=='i18n')fail(r.line,'unsupported global');r.take(']');r.take('[');const key=r.string();r.take(']');r.take('=');const value=r.string();r.take(';');
    if(!key || key.length>8000 || value.length>16000 || key.includes('\0') || value.includes('\0') || entries.length>=512)fail(line,'invalid or excessive catalogue entry');
    if(values.has(key))duplicates.push({key,line});entries.push({key,value,line});values.set(key,value);
  }
  if(!entries.length)fail(r.line,'empty catalogue');return {sha256:hash(bytes),entries,values,duplicates};
}

export function formatSignature(value) {
  const slots=[];let next=1;
  for(let i=0;i<value.length;i++){if(value[i]!=='%')continue;if(value[i+1]==='%'){i++;continue;}
    const match=/^%(?:(\d+)\$)?[-+ 0#]*\d*(?:\.\d+)?([bcdeEfFgGosuxX])/.exec(value.slice(i));
    if(!match)throw new Error('Unsupported format placeholder.');const slot=match[1]?Number(match[1]):next++;
    if(!Number.isSafeInteger(slot) || slot<1 || slot>64 || slots.length>=64)throw new Error('Unbounded format placeholder.');
    slots.push(`${slot}:${match[2]}`);i+=match[0].length-1;
  }
  return slots.sort().join(',');
}

export function compareCatalogue(current,english) {
  const missing=[],extra=[],empty=[],formatIssues=[],markup=[];let identicalEnglish=0;
  for(const key of english.values.keys())if(!current.values.has(key))missing.push(key);
  for(const [key,value] of current.values){if(!english.values.has(key))extra.push(key);if(!value)empty.push(key);if(value===english.values.get(key))identicalEnglish++;
    if(/<[a-z!/][^>]*>/i.test(value))markup.push(key);
    if(value)try {if(formatSignature(key)!==formatSignature(value))formatIssues.push({key,reason:'placeholder mismatch'});}catch {formatIssues.push({key,reason:'unsupported placeholder syntax'});}
  }
  return {entries:current.entries.length,uniqueKeys:current.values.size,duplicates:current.duplicates,missing,extra,empty,formatIssues,markup,identicalEnglish};
}
