const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const flagClass=f=>"flag-"+f.toLowerCase().replace(/[^a-z0-9]+/g,"-");
let DATA=null,SETS={},APP_LIST=[];
let MARKET_PRICES={};
let HIGH_VALUE_LOADING=true;
let PRICE_PROGRESS={done:0,total:0};
const IMAGE_CACHE=new Map();

function stat(value,label,key){return `<div class="stat" data-key="${key}"><div class="num">${esc(value)}</div><div class="label">${esc(label)}</div><div class="hint">Click to view</div></div>`}
function itemLink(x){
  if(x.collectorType==="Badge")return x.url||"";
  return x.marketHashName?`https://steamcommunity.com/market/listings/753/${encodeURIComponent(x.marketHashName)}`:"";
}
function appName(x){return x.app?.name||""}

function linksForApp(a){
  if(!a?.appid)return "";
  return `<div class="links">
    <a href="${esc(a.storeURL||`https://store.steampowered.com/app/${a.appid}/`)}" target="_blank">Store</a>
    <a href="${esc(a.communityURL||`https://steamcommunity.com/app/${a.appid}`)}" target="_blank">Community</a>
    <a href="${esc(a.steamdbURL||`https://steamdb.info/app/${a.appid}/`)}" target="_blank">SteamDB</a>
  </div>`;
}

function renderItem(x){
  const image=x.image||x.icon||"";
  const meta=[
    x.collectorType,x.category,
    appName(x)&&appName(x),
    x.appid&&`AppID ${x.appid}`,
    x.app?.typeLabel&&x.app.typeLabel!=="Unknown"&&x.app.typeLabel,
    x.level&&`Level ${x.level}`,x.xp&&`${x.xp.toLocaleString()} XP`,
    `Quantity ${x.quantity||1}`,
    x.marketable ? "Marketable" : "Non-marketable",
    x.marketable ? (x.marketPriceDisplay ? `Market ${x.marketPriceDisplay}` : "Market price unavailable") : "No Community Market price"
  ].filter(Boolean).join(" • ");
  const flags=(x.flags||[]).map(f=>`<span class="flag ${flagClass(f)}">${esc(f)}</span>`).join("");
  const reasons=(x.reasons||[]).map(r=>`<div class="reason">• ${esc(r)}</div>`).join("");
  const link=itemLink(x);
  return `<div class="item" data-search="${esc((x.name+" "+appName(x)+" "+(x.flags||[]).join(" ")+" "+(x.appid||"")).toLowerCase())}">
    ${image?`<div class="placeholder lazy-image" data-image-url="${esc(image)}">…</div>`:`<div class="placeholder">?</div>`}
    <div class="main"><div class="name">${esc(x.name)}${x.quantity>1?` ×${x.quantity}`:""}</div><div class="metadata">${esc(meta)}</div><div>${flags}</div>${reasons}</div>
    <div class="item-actions">${link?`<a class="view" href="${esc(link)}" target="_blank">Item</a>`:""}${x.app?linksForApp(x.app):""}</div>
  </div>`;
}

function renderApp(a){
  const c=a.counts||{};
  const statusClass=`status-${String(a.status||"unknown").toLowerCase().replace(/_/g,"-")}`;
  const collection=[
    c.badges&&`${c.badges} badge${c.badges===1?"":"s"}`,
    c.tradingCards&&`${c.tradingCards} card${c.tradingCards===1?"":"s"}`,
    c.foilCards&&`${c.foilCards} foil`,
    c.backgrounds&&`${c.backgrounds} background${c.backgrounds===1?"":"s"}`,
    c.emoticons&&`${c.emoticons} emoticon${c.emoticons===1?"":"s"}`,
    c.boosters&&`${c.boosters} booster${c.boosters===1?"":"s"}`,
    c.other&&`${c.other} other`
  ].filter(Boolean).join(" • ")||"Associated collectible detected";
  const details=[
    a.typeLabel&&a.typeLabel!=="Unknown"&&a.typeLabel,
    a.releaseDate&&`Released ${a.releaseDate}`,
    a.developers?.length&&`Developer: ${a.developers.join(", ")}`,
    a.publishers?.length&&`Publisher: ${a.publishers.join(", ")}`
  ].filter(Boolean).join(" • ");
  const flags=(a.collectorFlags||[]).slice(0,8).map(f=>`<span class="flag ${flagClass(f)}">${esc(f)}</span>`).join("");
  const image=a.headerImage||a.capsuleImage||"";
  return `<div class="app-card" data-search="${esc(((a.name||"")+" "+a.appid+" "+a.statusLabel+" "+a.typeLabel+" "+collection).toLowerCase())}">
    ${image?`<div class="app-art lazy-image" data-image-url="${esc(image)}">…</div>`:`<div class="app-art placeholder">APP</div>`}
    <div class="app-main">
      <div class="app-title">${esc(a.name||`AppID ${a.appid}`)}</div>
      <div class="metadata">AppID ${esc(a.appid)}${details?` • ${esc(details)}`:""}</div>
      <div class="collection-line">${esc(collection)}</div>
      <div><span class="status ${statusClass}">${esc(a.statusLabel||"Unknown")}</span>${flags}</div>
      ${a.evidence?`<div class="reason">${esc(a.evidence)}</div>`:""}
      ${a.genres?.length?`<div class="metadata">Genres: ${esc(a.genres.join(", "))}</div>`:""}
    </div>
    ${linksForApp(a)}
  </div>`;
}

async function loadOneImage(slot){
  const url=slot.dataset.imageUrl;if(!url||slot.dataset.loading==="1")return;
  slot.dataset.loading="1";let dataURL=IMAGE_CACHE.get(url)||"";
  if(!dataURL){
    try{
      const reply=await chrome.runtime.sendMessage({type:"FETCH_IMAGE",url});
      if(reply?.ok&&reply.dataURL){dataURL=reply.dataURL;IMAGE_CACHE.set(url,dataURL)}
    }catch(_){}
  }
  if(!slot.isConnected)return;
  if(dataURL){
    const img=document.createElement("img");img.src=dataURL;img.alt="";img.className=slot.classList.contains("app-art")?"app-art remote-image":"remote-image";
    img.addEventListener("error",()=>{const ph=document.createElement("div");ph.className=slot.classList.contains("app-art")?"app-art placeholder":"placeholder";ph.textContent="?";img.replaceWith(ph)},{once:true});
    slot.replaceWith(img);
  }else{slot.textContent="?";slot.dataset.loading="0"}
}
async function hydrateVisibleImages(root=document){
  const slots=[...root.querySelectorAll(".lazy-image[data-image-url]")];let cursor=0;
  async function worker(){while(cursor<slots.length)await loadOneImage(slots[cursor++])}
  await Promise.all(Array.from({length:Math.min(6,slots.length)},()=>worker()));
}

function show(key){
  document.querySelectorAll(".stat").forEach(x=>x.classList.toggle("active",x.dataset.key===key));
  const box=document.querySelector("#results");
  let html="",count=0,title="";
  if(key==="apps"){
    const set=APP_LIST;count=set.length;title="Apps / Games";html=set.map(renderApp).join("");
  }else{
    const set=SETS[key]||[];count=set.length;title=document.querySelector(`.stat[data-key="${key}"] .label`)?.textContent||"Results";html=set.map(renderItem).join("");
  }
  document.querySelector("#result-title").textContent=title;
  document.querySelector("#result-desc").textContent=`${count} unique result${count===1?"":"s"} shown.`;
  box.innerHTML=html||`<div class="empty">No matching results found.</div>`;
  hydrateVisibleImages(box);document.querySelector("#filtered").classList.remove("hidden");document.querySelector("#filtered").scrollIntoView({behavior:"smooth"});
}
function saveBlob(text,type,name){const b=new Blob([text],{type}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function pricedItems(){return (DATA.items||[]).map(x=>{const q=MARKET_PRICES[x.marketHashName]||{};return {...x,marketPriceUSD:q.priceUSD,marketPriceDisplay:q.lowestPrice||q.medianPrice||"",marketURL:itemLink(x)}})}
function download(){saveBlob(JSON.stringify({...DATA,marketPrices:MARKET_PRICES,inventoryWithPrices:pricedItems()},null,2),"application/json","steam-collector-scan.json")}
function exportInventoryJSON(){saveBlob(JSON.stringify(pricedItems(),null,2),"application/json","steam-inventory-results.json")}
function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function exportInventoryCSV(){const rows=[["Name","Category","Type","AppID","Quantity","Marketable","Tradable","Price USD","Price Display","Estimated Stack Value USD","Market URL"]];for(const x of pricedItems())rows.push([x.name,x.category,x.type,x.appid,x.quantity,x.marketable,x.tradable,x.marketPriceUSD??"",x.marketPriceDisplay||"",Number.isFinite(x.marketPriceUSD)?(x.marketPriceUSD*(x.quantity||1)).toFixed(2):"",x.marketURL||""]);saveBlob(rows.map(r=>r.map(csvCell).join(",")).join("\n"),"text/csv","steam-inventory-results.csv")}
function copyItemList(){const lines=pricedItems().map(x=>`${x.name} | ${x.category} | Qty ${x.quantity||1} | ${x.marketable?(x.marketPriceDisplay||"Price unavailable"):"Non-marketable"}${x.marketURL?` | ${x.marketURL}`:""}`);copyText(lines.join("\n"),"Item list")}


function copyText(value,label){
  if(!value)return;
  navigator.clipboard.writeText(String(value)).then(()=>flashNotice(`${label} copied.`)).catch(()=>{});
}
function flashNotice(text){
  let n=document.querySelector("#toolkit-notice");
  if(!n){n=document.createElement("div");n.id="toolkit-notice";document.body.appendChild(n)}
  n.textContent=`> ${text}`;n.classList.add("show");setTimeout(()=>n.classList.remove("show"),1800);
}
function renderErrorLog(){
  const errors=[...(DATA.errors||[])];
  for(const f of (DATA.failedRequests||[])) errors.push(`AppID ${f.appid}: ${f.error}`);
  const box=document.querySelector("#error-log-body");
  if(box) box.innerHTML=errors.length?errors.map((e,i)=>`<div class="log-line"><span>${String(i+1).padStart(2,"0")}</span>${esc(e)}</div>`).join(""):`<div class="log-ok">No errors recorded for this scan.</div>`;
  const count=document.querySelector("#error-count");if(count)count.textContent=String(errors.length);
}
async function retryFailed(){
  const ids=(DATA.failedRequests||[]).filter(x=>x.type==="app"&&x.appid).map(x=>x.appid);
  if(!ids.length){flashNotice("No failed app requests to retry.");return}
  const b=document.querySelector("#retry-failed");b.disabled=true;b.textContent=`Retrying 0/${ids.length}...`;
  try{
    const r=await chrome.runtime.sendMessage({type:"RETRY_FAILED_APPS",appids:ids});
    if(!r?.ok)throw new Error(r?.error||"Retry failed");
    DATA.apps={...(DATA.apps||{}),...(r.results||{})};
    DATA.failedRequests=Object.values(DATA.apps).filter(a=>a?.status==="UNKNOWN").map(a=>({type:"app",appid:a.appid,error:a.evidence||"Request failed"}));
    DATA.errors=(DATA.errors||[]).filter(e=>!String(e).startsWith("Store checks:"));
    await chrome.storage.local.set({lastScan:DATA});
    renderErrorLog();flashNotice(`Retry complete. ${DATA.failedRequests.length} still failed.`);
    b.textContent="Retry Failed Requests";
  }catch(e){flashNotice(`Retry failed: ${e.message}`)}finally{b.disabled=false}
}
async function init(){
  const {lastScan}=await chrome.storage.local.get("lastScan");
  if(!lastScan){document.querySelector("#app").innerHTML=`<div class="empty">No scan found. Open a Steam profile and click Scan Collector Profile.</div>`;return}
  DATA=lastScan;
  const b=DATA.badges||[],i=DATA.items||[],all=[...b,...i];
  const interesting=all.filter(x=>x.collectorScore>0);
  const limited=interesting.filter(x=>x.flags.includes("LIMITED-TIME")||x.flags.includes("LEGACY")||x.flags.includes("EVENT"));
  const unavailable=all.filter(x=>x.flags.includes("STORE UNAVAILABLE"));
  const unknown=all.filter(x=>x.flags.includes("APP STATUS UNKNOWN"));
  const foilBadges=b.filter(x=>x.flags.includes("FOIL")),eventBadges=b.filter(x=>x.flags.includes("EVENT"));
  const cards=i.filter(x=>x.category==="Trading Card"),foilCards=cards.filter(x=>x.foil);
  const assets=i.reduce((s,x)=>s+x.quantity,0),cardCount=cards.reduce((s,x)=>s+x.quantity,0),foilCount=foilCards.reduce((s,x)=>s+x.quantity,0);
  APP_LIST=Object.values(DATA.appSummaries||{}).sort((a,b)=>(a.name||`zz${a.appid}`).localeCompare(b.name||`zz${b.appid}`));
  SETS={badges:b,"foil-badges":foilBadges,"event-badges":eventBadges,inventory:i,unique:i,cards,"foil-cards":foilCards,backgrounds:i.filter(x=>x.category==="Profile Background"),emoticons:i.filter(x=>x.category==="Emoticon"),boosters:i.filter(x=>x.category==="Booster Pack"),gems:i.filter(x=>x.category==="Gems"),other:i.filter(x=>x.category==="Other Community Item"),marketable:i.filter(x=>x.marketable),"non-marketable":i.filter(x=>!x.marketable),limited,unavailable,unknown,noteworthy:interesting,"high-value":[],"top-10":[]};

  document.querySelector("#header").innerHTML=`<div class="profile">${DATA.profile.avatar?`<div class="avatar placeholder lazy-image" data-image-url="${esc(DATA.profile.avatar)}">…</div>`:""}<div class="profile-data"><h1>${esc(DATA.profile.name)}</h1><div class="meta">Steam Level ${esc(DATA.profile.level||"?")}${DATA.profile.yearsText?` • ${esc(DATA.profile.yearsText)}`:""}</div><div class="identity-grid"><div><span>SteamID64</span><code>${esc(DATA.profile.steamID64||"Unavailable")}</code><button id="copy-steamid">COPY</button></div><div><span>Vanity URL</span><code>${esc(DATA.profile.vanityURL||"None / SteamID profile")}</code></div><div><span>Profile URL</span><code>${esc(DATA.profile.profileURL||"")}</code><button id="copy-profile">COPY</button></div></div><div class="meta">Steam Toolkit V${esc(chrome.runtime.getManifest().version)} • Scan format V${esc(DATA.version||"?")}</div></div></div>`;
  document.querySelector("#nav").innerHTML=`<button id="export">Export Entire Scan JSON</button><button id="export-csv">Inventory CSV</button><button id="export-inventory-json">Inventory JSON</button><button id="copy-items">Copy Item List</button><button id="apps-button">Apps / Games</button><button id="high-value-button">High Value Items <span id="high-value-count">…</span></button><button id="retry-failed">Retry Failed Requests</button><button id="clear-cache">Clear Cache</button><button id="toggle-errors">Error Log <span id="error-count">0</span></button><input id="search" placeholder="Search visible results...">`;

  const availableApps=APP_LIST.filter(a=>a.status==="STORE_AVAILABLE").length;
  const unavailableApps=APP_LIST.filter(a=>a.status==="STORE_UNAVAILABLE").length;
  const unknownApps=APP_LIST.filter(a=>a.status==="UNKNOWN").length;

  document.querySelector("#app").innerHTML=`
    ${DATA.errors?.length?`<div class="warning">${DATA.errors.map(e=>`<div>• ${esc(e)}</div>`).join("")}</div>`:""}
    <div class="info"><strong>V2 app analysis:</strong> ${APP_LIST.length} associated AppIDs • ${availableApps} Store available • ${unavailableApps} Store unavailable • ${unknownApps} unknown.<br>
    <strong>Status rule:</strong> “Store Unavailable” means Steam did not return an active Store record. It is deliberately <em>not</em> labeled “confirmed delisted” without stronger evidence.</div>
    <section id="error-log" class="error-log hidden"><div class="error-head"><h2>Error Log</h2></div><div id="error-log-body"></div></section>
    <div id="market-summary" class="market-summary"><div><span>Estimated Total Inventory Value</span><strong id="estimated-value">PRICING…</strong></div><div><span>Most Valuable Item</span><strong id="most-valuable">PRICING…</strong></div><div><span>Price Progress</span><strong id="price-progress">0 / 0 items</strong><div class="progress-track"><div id="price-progress-bar"></div></div></div></div>
    <div class="stats">
      ${stat(b.length,"Badges","badges")}
      ${stat(foilBadges.length,"Foil Badges","foil-badges")}
      ${stat(eventBadges.length,"Event Badges","event-badges")}
      ${stat(assets,"Inventory Items","inventory")}
      ${stat(i.length,"Unique Community Items","unique")}
      ${stat(cardCount,"Trading Cards","cards")}
      ${stat(foilCount,"Foil Cards","foil-cards")}
      ${stat(SETS.backgrounds.length,"Backgrounds","backgrounds")}
      ${stat(SETS.emoticons.length,"Emoticons","emoticons")}
      ${stat(SETS.boosters.length,"Booster Packs","boosters")}
      ${stat(SETS.gems.length,"Gems","gems")}
      ${stat(SETS.other.length,"Other Items","other")}
      ${stat(SETS.marketable.length,"Marketable","marketable")}
      ${stat(SETS["non-marketable"].length,"Non-Marketable","non-marketable")}
      ${stat(10,"Top 10 Items","top-10")}
      ${stat(APP_LIST.length,"Apps / Games","apps")}
      ${stat(limited.length,"Limited / Legacy","limited")}
      ${stat(unavailable.length,"Store-Unavailable Items","unavailable")}
      ${stat(unknown.length,"Unknown-App Items","unknown")}
      ${stat(interesting.length,"Noteworthy Finds","noteworthy")}
    </div>
    <section id="filtered" class="hidden"><h2 id="result-title">Results</h2><div id="result-desc" class="desc"></div><div id="results"></div></section>`;

  document.querySelectorAll(".stat").forEach(x=>x.addEventListener("click",()=>show(x.dataset.key)));
  document.querySelector("#apps-button").addEventListener("click",()=>show("apps"));
  document.querySelector("#high-value-button").addEventListener("click",()=>{
    if(HIGH_VALUE_LOADING){
      const section=document.querySelector("#filtered"),box=document.querySelector("#results");
      document.querySelector("#result-title").textContent="High Value Items";
      document.querySelector("#result-desc").textContent="Checking current Steam Community Market prices…";
      box.innerHTML=`<div class="empty">Pricing marketable items… this view will update automatically.</div>`;
      section.classList.remove("hidden"); section.scrollIntoView({behavior:"smooth"});
    } else show("high-value");
  });
  document.querySelector("#export").addEventListener("click",download);
  document.querySelector("#export-csv").addEventListener("click",exportInventoryCSV);
  document.querySelector("#export-inventory-json").addEventListener("click",exportInventoryJSON);
  document.querySelector("#copy-items").addEventListener("click",copyItemList);
  document.querySelector("#copy-steamid")?.addEventListener("click",()=>copyText(DATA.profile.steamID64,"SteamID64"));
  document.querySelector("#copy-profile")?.addEventListener("click",()=>copyText(DATA.profile.profileURL,"Profile URL"));
  document.querySelector("#retry-failed").addEventListener("click",retryFailed);
  document.querySelector("#clear-cache").addEventListener("click",async()=>{const r=await chrome.runtime.sendMessage({type:"CLEAR_TOOLKIT_CACHE"});IMAGE_CACHE.clear();flashNotice(r?.ok?"Toolkit cache cleared.":"Cache clear failed.")});
  document.querySelector("#toggle-errors").addEventListener("click",()=>document.querySelector("#error-log").classList.toggle("hidden"));
  renderErrorLog();
  document.querySelector("#search").addEventListener("input",e=>{
    const q=e.target.value.toLowerCase().trim();
    document.querySelectorAll("#results .item,#results .app-card").forEach(x=>x.classList.toggle("hidden",q&&!x.dataset.search.includes(q)));
  });
  hydrateVisibleImages(document);
  loadHighValueItems(i);
}

async function loadHighValueItems(items){
  const count=document.querySelector("#high-value-count");
  const candidates=items.filter(x=>x.marketable&&x.marketHashName);
  PRICE_PROGRESS={done:0,total:candidates.length};
  const progress=()=>{const t=PRICE_PROGRESS.total,d=PRICE_PROGRESS.done;const e=document.querySelector("#price-progress");if(e)e.textContent=`${d.toLocaleString()} / ${t.toLocaleString()} items`;const bar=document.querySelector("#price-progress-bar");if(bar)bar.style.width=`${t?Math.round(d/t*100):100}%`};progress();
  if(!candidates.length){SETS["high-value"]=[];SETS["top-10"]=[];HIGH_VALUE_LOADING=false;if(count)count.textContent="(0)";updateMarketSummary(items);return;}
  HIGH_VALUE_LOADING=true;if(count)count.textContent="(checking…)";
  try{
    const batchSize=25;
    for(let pos=0;pos<candidates.length;pos+=batchSize){
      const batch=candidates.slice(pos,pos+batchSize);
      const reply=await chrome.runtime.sendMessage({type:"CHECK_MARKET_PRICES",items:batch.map(x=>({marketHashName:x.marketHashName}))});
      if(!reply?.ok)throw new Error(reply?.error||"Market price lookup failed");
      Object.assign(MARKET_PRICES,reply.results||{});PRICE_PROGRESS.done=Math.min(candidates.length,pos+batch.length);progress();updateMarketSummary(items);
      if(document.querySelector("#result-title")?.textContent==="Inventory Items") show("inventory");
    }
    const priced=candidates.map(x=>{const p=MARKET_PRICES[x.marketHashName]||{};return {...x,marketPriceUSD:p.priceUSD,marketPriceDisplay:p.lowestPrice||p.medianPrice||"",marketVolume:p.volume||""}}).filter(x=>Number.isFinite(x.marketPriceUSD)).sort((a,b)=>b.marketPriceUSD-a.marketPriceUSD);
    SETS["high-value"]=priced.filter(x=>x.marketPriceUSD>=1);SETS["top-10"]=priced.slice(0,10);if(count)count.textContent=`(${SETS["high-value"].length})`;HIGH_VALUE_LOADING=false;updateMarketSummary(items);if(document.querySelector("#result-title")?.textContent==="High Value Items")show("high-value");
  }catch(e){HIGH_VALUE_LOADING=false;if(count)count.textContent="(!)";console.warn("[Steam Toolkit] Market pricing:",e);flashNotice(`Market pricing failed: ${e.message}`)}
}
function updateMarketSummary(items){
  const priced=items.map(x=>{const p=MARKET_PRICES[x.marketHashName]||{};return {...x,marketPriceUSD:p.priceUSD,marketPriceDisplay:p.lowestPrice||p.medianPrice||""}}).filter(x=>Number.isFinite(x.marketPriceUSD));
  const total=priced.reduce((sum,x)=>sum+x.marketPriceUSD*(x.quantity||1),0);const best=[...priced].sort((a,b)=>b.marketPriceUSD-a.marketPriceUSD)[0];
  const ev=document.querySelector("#estimated-value");if(ev)ev.textContent=`$${total.toFixed(2)}${PRICE_PROGRESS.done<PRICE_PROGRESS.total?"+":""}`;
  const mv=document.querySelector("#most-valuable");if(mv)mv.textContent=best?`${best.name} — ${best.marketPriceDisplay||`$${best.marketPriceUSD.toFixed(2)}`}`:"None priced";
  SETS.inventory=items.map(x=>{const p=MARKET_PRICES[x.marketHashName]||{};return {...x,marketPriceUSD:p.priceUSD,marketPriceDisplay:p.lowestPrice||p.medianPrice||"",marketVolume:p.volume||""}});
  for(const key of ["cards","foil-cards","backgrounds","emoticons","boosters","gems","other","marketable","non-marketable"]){SETS[key]=(SETS[key]||[]).map(x=>{const p=MARKET_PRICES[x.marketHashName]||{};return {...x,marketPriceUSD:p.priceUSD,marketPriceDisplay:p.lowestPrice||p.medianPrice||""}})}
}

init();
