(function () {
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const catalogue=[
  {
    "id": "emoticon_smile",
    "label": "Smile",
    "file": "emoticon_smile.png",
    "aliases": [
      ":-)",
      "^_^",
      ":)"
    ]
  },
  {
    "id": "emoticon_evilgrin",
    "label": "Evil grin",
    "file": "emoticon_evilgrin.png",
    "aliases": [
      ">("
    ]
  },
  {
    "id": "emoticon_surprised",
    "label": "Surprised",
    "file": "emoticon_surprised.png",
    "aliases": [
      ":S",
      ":s",
      ":-S",
      ":-s",
      ":-/"
    ]
  },
  {
    "id": "emoticon_grin",
    "label": "Grin",
    "file": "emoticon_grin.png",
    "aliases": [
      ":-D",
      ":D"
    ]
  },
  {
    "id": "emoticon_unhappy",
    "label": "Unhappy",
    "file": "emoticon_unhappy.png",
    "aliases": [
      ":'(",
      ":-(",
      ":o(",
      ":-<",
      ":("
    ]
  },
  {
    "id": "emoticon_happy",
    "label": "Happy",
    "file": "emoticon_happy.png",
    "aliases": [
      ":lol:"
    ]
  },
  {
    "id": "emoticon_waii",
    "label": "Waii",
    "file": "emoticon_waii.png",
    "aliases": [
      ":{}",
      ":-{}",
      ":razz:",
      ":}",
      ":-}"
    ]
  },
  {
    "id": "emoticon_wink",
    "label": "Wink",
    "file": "emoticon_wink.png",
    "aliases": [
      ";-)",
      ";o)",
      ";)"
    ]
  },
  {
    "id": "emoticon_tongue",
    "label": "Tongue",
    "file": "emoticon_tongue.png",
    "aliases": [
      ":P",
      ":-P",
      ":-p",
      ":p"
    ]
  },
  {
    "id": "weather_rain",
    "label": "Rain",
    "file": "weather_rain.png",
    "aliases": [
      "///",
      "\\\\\\",
      "|||",
      ":rain:",
      ":drizzle:"
    ]
  },
  {
    "id": "weather_snow",
    "label": "Snow",
    "file": "weather_snow.png",
    "aliases": [
      ":***:"
    ]
  },
  {
    "id": "weather_sun",
    "label": "Sun",
    "file": "weather_sun.png",
    "aliases": [
      ">O<"
    ]
  },
  {
    "id": "weather_clouds",
    "label": "Clouds",
    "file": "weather_clouds.png",
    "aliases": [
      ":\"\"\":",
      ":cloud:",
      ":clouds:"
    ]
  },
  {
    "id": "weather_cloudy",
    "label": "Cloudy",
    "file": "weather_cloudy.png",
    "aliases": [
      ":\"O\":",
      ":cloudly:"
    ]
  },
  {
    "id": "weather_lightning",
    "label": "Lightning",
    "file": "weather_lightning.png",
    "aliases": [
      ":$:"
    ]
  },
  {
    "id": "arrow_right",
    "label": "Right arrow",
    "file": "arrow_right.png",
    "aliases": [
      "=>",
      "->",
      "-->",
      "==>",
      ">>>"
    ]
  },
  {
    "id": "arrow_left",
    "label": "Left arrow",
    "file": "arrow_left.png",
    "aliases": [
      "<=",
      "<-",
      "<--",
      "<==",
      "<<<"
    ]
  },
  {
    "id": "exclamation",
    "label": "Exclamation",
    "file": "exclamation.png",
    "aliases": [
      ":!:"
    ]
  },
  {
    "id": "lightbulb",
    "label": "Lightbulb",
    "file": "lightbulb.png",
    "aliases": [
      "*)",
      "0="
    ]
  }
];
  for(const item of catalogue){Object.freeze(item.aliases);Object.freeze(item);}
  Object.freeze(catalogue);
  const byId=new Map(catalogue.map(item=>[item.id,item]));
  const aliases=catalogue.flatMap(item=>item.aliases.map(token=>({token,item}))).sort((a,b)=>b.token.length-a.token.length);
  const src=item=>'/src/assets/chat-smileys/'+item.file;
  function createTextRenderer(enabled=false) {
    let images=0;
    return function text(value,allowed=true) {
      if(!enabled || !allowed)return esc(value);
      let html='',plain='',position=0;
      const flush=()=>{html+=esc(plain);plain='';};
      while(position<value.length){
        // URL chunks stay textual; no tokens are matched in generated HTML or attributes.
        const url=value.slice(position).match(/^https?:\/\/\S+/i);
        if(url){plain+=url[0];position+=url[0].length;continue;}
        const match=aliases.find(alias=>value.startsWith(alias.token,position));
        if(match){
          if(++images>128)throw new Error('smiley limit');
          flush();
          html+=`<img class="chat-smiley" data-chat-smiley="${match.item.id}" src="${src(match.item)}" width="16" height="16" alt="${esc(match.token)}" title="${esc(match.item.label)}">`;
          position+=match.token.length;
        }else plain+=value[position++];
        if(html.length>32000)throw new Error('output limit');
      }
      flush();if(html.length>32000)throw new Error('output limit');return html;
    };
  }
  function picker(disabled=false,id='') {
    const off=disabled?'disabled':'';
    return `<details class="chat-smileys" data-room-detail-key="chat-smileys-${esc(id)}"><summary title="Insert smiley" aria-label="Insert smiley"><img src="${src(catalogue[0])}" width="16" height="16" alt=""></summary><div class="chat-smiley-grid" role="group" aria-label="Smileys">${catalogue.map(item=>`<button type="button" class="icon-button" data-chat-insert-smiley="${item.id}" aria-label="${esc(item.label)} ${esc(item.aliases.at(-1))}" title="${esc(item.label)}: ${esc(item.aliases.join(' '))}" ${off}><img src="${src(item)}" width="16" height="16" alt=""></button>`).join('')}</div><p class="chat-smiley-credit">Silk icons: <a href="https://github.com/markjames/famfamfam-silk-icons" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Mark James</a>. PHPFreeChat port: Robin Monks. <a href="https://creativecommons.org/licenses/by/2.5/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">CC BY 2.5</a>. <a href="/src/assets/chat-smileys/ATTRIBUTION.txt" target="_blank" rel="noopener noreferrer">Credits</a>.</p></details>`;
  }
  function bindComposer(form,current) {
    const field=form?.querySelector('textarea[name="body"]'),status=form?.querySelector('.chat-format-status');
    if(!field)return;
    form.querySelectorAll('[data-chat-insert-smiley]').forEach(button=>button.addEventListener('click',()=>{
      if(!form.isConnected || !current() || button.matches(':disabled') || field.matches(':disabled'))return;
      const item=byId.get(button.dataset.chatInsertSmiley);if(!item)return;
      const token=item.aliases.at(-1),start=field.selectionStart,end=field.selectionEnd;
      if(field.value.length-(end-start)+token.length>4000){if(status)status.textContent='Message exceeds 4000 characters.';return;}
      field.setRangeText(token,start,end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));
      if(status)status.textContent='';field.focus({preventScroll:true});
    }));
  }
  window.chatSmileys={catalogue,createTextRenderer,picker,bindComposer};
})();
