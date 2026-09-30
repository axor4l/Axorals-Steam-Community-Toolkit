(() => {
  "use strict";
  const VERSION="0.8.1", INVENTORY_BATCH_SIZE=2000, INVENTORY_MAX_PAGES=100, BADGE_MAX_PAGES=200;
  const LEGACY_YEAR=2014, EARLY_YEAR=2017;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clean=v=>String(v||"").replace(/\s+/g," ").trim();
  const unique=a=>[...new Set(a.filter(Boolean))];

  function normalizeImageURL(url){
    if(!url) return "";
    url=String(url).trim();

    if(url.startsWith("//")) return "https:"+url;
    if(url.startsWith("/")) return "https://steamcommunity.com"+url;
    if(/^http:\/\/steamcommunity\.com\//i.test(url)) return url.replace(/^http:/i,"https:");

    return url;
  }

  function imageURLFromElement(img){
    if(!img) return "";

    const candidates=[
      img.currentSrc,
      img.src,
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-image"),
      img.getAttribute("data-avatar")
    ].filter(Boolean);

    const srcset=img.getAttribute("srcset") || img.getAttribute("data-srcset");

    if(srcset){
      const best=srcset
        .split(",")
        .map(x=>x.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();

      if(best) candidates.unshift(best);
    }

    for(const candidate of candidates){
      const normalized=normalizeImageURL(candidate);

      if(
        normalized &&
        !normalized.startsWith("data:image/gif") &&
        !normalized.includes("transparent.gif")
      ){
        return normalized;
      }
    }

    return "";
  }

  function imageURLFromBackground(el){
    if(!el) return "";

    const values=[
      el.getAttribute("style")||"",
      el.style?.backgroundImage||"",
      el.style?.background||""
    ];

    for(const value of values){
      const m=String(value).match(/url\((['"]?)(.*?)\1\)/i);
      if(m?.[2]){
        return normalizeImageURL(m[2]);
      }
    }

    return "";
  }

  function badgeImageURL(row){
    if(!row) return "";

    // Steam badge pages have used several different badge-image structures.
    // Prefer the badge-specific container rather than any arbitrary row image.
    const selectors=[
      ".badge_icon img",
      ".badge_icon",
      ".badge_row_inner img",
      ".badge_image img",
      ".badge_image",
      "img"
    ];

    for(const selector of selectors){
      const el=row.querySelector(selector);
      if(!el) continue;

      if(el.tagName==="IMG"){
        const url=imageURLFromElement(el);
        if(url) return url;
      }

      const bg=imageURLFromBackground(el);
      if(bg) return bg;

      const nested=el.querySelector?.("img");
      const nestedURL=imageURLFromElement(nested);
      if(nestedURL) return nestedURL;
    }

    // Last resort: inspect descendants with inline background-image styles.
    for(const el of row.querySelectorAll('[style*="background"]')){
      const bg=imageURLFromBackground(el);
      if(bg) return bg;
    }

    return "";
  }
  // Never mount the Toolkit shell inside one of our generated result windows.
  if (document.querySelector('meta[name="steam-toolkit-result"]') || window.name === 'steam-toolkit-result') return;

  const normalizedPath = location.pathname.replace(/\/+$/, "");
  const profileMatch = normalizedPath.match(/^\/(id\/[^/]+|profiles\/\d+)$/i);

  // Only run on the main Steam user profile page.
  // Do not show on /friends, /badges, /groups, /inventory, etc.
  if (!profileMatch) return;

  const PROFILE_BASE = `https://steamcommunity.com/${profileMatch[1]}`;

  // Safety: never allow Toolkit-created or Steam links to downgrade Steam Community to HTTP.
  document.addEventListener("click", event => {
    const a=event.target?.closest?.("a[href]");
    if(!a) return;
    try{
      const u=new URL(a.href, "https://steamcommunity.com/");
      if(u.hostname.toLowerCase()==="steamcommunity.com" && u.protocol==="http:"){
        u.protocol="https:";
        a.href=u.href;
      }
    }catch(_){}
  }, true);

  const EVENT_RULES=[
    {words:["steam trading card beta","trading card beta"],flags:["LEGACY","LIMITED-TIME","EVENT"],reason:"Associated with the early Steam Trading Card Beta."},
    {words:["summer getaway"],flags:["LEGACY","LIMITED-TIME","EVENT"],reason:"Steam Summer Getaway event collectible."},
    {words:["holiday sale","winter sale","summer sale","spring sale","autumn sale"],flags:["LIMITED-TIME","EVENT"],reason:"Steam seasonal sale collectible."},
    {words:["steam awards","steam award"],flags:["LIMITED-TIME","EVENT"],reason:"Steam Awards event collectible."},
    {words:["monster summer"],flags:["LEGACY","LIMITED-TIME","EVENT"],reason:"Monster Summer Sale event collectible."},
    {words:["salien","grand prix","lunar new year","spring cleaning","steamville","steam 3000"],flags:["LIMITED-TIME","EVENT"],reason:"Recognized Steam event collectible."},
    {words:["steam replay","next fest"],flags:["EVENT"],reason:"Recognized Steam event-related collectible."}
  ];

  function extractYear(text){
    const m=String(text||"").match(/\b(20\d{2})\b/g); if(!m) return null;
    const y=m.map(Number).filter(x=>x>=2003&&x<=new Date().getFullYear());
    return y.length?Math.min(...y):null;
  }
  function analyzeEventText(text){
    const l=String(text||"").toLowerCase(), flags=[], reasons=[];
    for(const r of EVENT_RULES) if(r.words.some(w=>l.includes(w))){flags.push(...r.flags);reasons.push(r.reason)}
    return {flags:unique(flags),reasons:unique(reasons)};
  }
  async function fetchDoc(url){
    const r=await fetch(url,{credentials:"include"}); if(!r.ok) throw new Error(`${r.status} loading ${url}`);
    return new DOMParser().parseFromString(await r.text(),"text/html");
  }
  function setStatus(text,pct){
    const s=document.querySelector("#scs-status"), p=document.querySelector("#scs-progress");
    if(s)s.textContent=text;if(p&&typeof pct==="number")p.style.width=Math.max(0,Math.min(100,pct))+"%";
  }

  function mount(){
    if(document.querySelector("#scs-panel")) return;

    const p=document.createElement("div");
    p.id="scs-panel";
    p.title="Steam Toolkit";

    p.innerHTML=`
      <button id="scs-mini" aria-label="Open Steam Toolkit" title="Open Steam Toolkit">ST</button>

      <div id="scs-full">
        <div class="scs-head">
          <div>
            <div class="title">Steam Toolkit</div>
            <div class="version">SYSTEM ONLINE // V${VERSION}</div>
          </div>
          <button id="scs-minimize" aria-label="Minimize scanner" title="Minimize">−</button>
        </div>

        <div class="stk-tabs">
          <button id="stk-collector" class="stk-tool active">Collector Scanner</button>
          <button id="stk-rep" class="stk-tool">REP Scanner</button>
          <button id="stk-groups" class="stk-tool">Group Collector</button>
        </div>
        <div id="stk-view-collector" class="stk-view active">
          <button id="scs-start">Scan Collector Profile</button>
        </div>
        <div id="stk-view-rep" class="stk-view">
          <button id="stk-rep-start">Scan Comments</button>
          <div class="stk-stats"><span>Total <b id="stk-rep-total">0</b></span><span class="pos">+REP <b id="stk-rep-pos">0</b></span><span class="neg">-REP <b id="stk-rep-neg">0</b></span></div>
          <div class="stk-actions"><button id="stk-rep-view-pos">View +REP</button><button id="stk-rep-view-neg">View -REP</button></div>
        </div>
        <div id="stk-view-groups" class="stk-view">
          <button id="stk-groups-start">Find All Groups</button>
        </div>
        <div id="scs-status">Ready</div>
        <div class="progress"><div id="scs-progress"></div></div>
      </div>
    `;

    document.body.appendChild(p);

    const expand=()=>{
      p.classList.add("scs-expanded");
      p.title="";
    };

    const minimize=()=>{
      p.classList.remove("scs-expanded");
      p.title="Steam Toolkit";
    };

    p.querySelector("#scs-mini").addEventListener("click",expand);
    p.querySelector("#scs-minimize").addEventListener("click",minimize);
    p.querySelector("#scs-start").addEventListener("click",run);

    const selectTool=name=>{
      p.querySelectorAll(".stk-tool").forEach(x=>x.classList.toggle("active",x.id===`stk-${name}`));
      p.querySelectorAll(".stk-view").forEach(x=>x.classList.toggle("active",x.id===`stk-view-${name}`));
      const labels={collector:"Collector scanner ready.",rep:"REP scanner ready.",groups:"Group collector ready."};
      setStatus(labels[name]||"Ready");
    };
    ["collector","rep","groups"].forEach(name=>p.querySelector(`#stk-${name}`).addEventListener("click",()=>selectTool(name)));

    p.querySelector("#stk-groups-start").addEventListener("click",()=>{
      const legacy=document.querySelector("#sgc-scan");
      if(legacy){ setStatus("Group Collector scanning..."); legacy.click(); }
      else setStatus("Group Collector module unavailable.");
    });

    p.querySelector("#stk-rep-start").addEventListener("click",()=>{
      const legacy=document.querySelector("#repScanButton");
      if(legacy){ setStatus("REP Scanner scanning comments..."); legacy.click(); }
      else setStatus("REP Scanner module unavailable.");
    });
    p.querySelector("#stk-rep-view-pos").addEventListener("click",()=>document.querySelector("#viewPositive")?.click());
    p.querySelector("#stk-rep-view-neg").addEventListener("click",()=>document.querySelector("#viewNegative")?.click());

    const syncLegacy=()=>{
      const total=document.querySelector("#repTotal")?.textContent||"0";
      const pos=document.querySelector("#repPositive")?.textContent||"0";
      const neg=document.querySelector("#repNegative")?.textContent||"0";
      const status=document.querySelector("#repStatus")?.textContent||"";
      const a=p.querySelector("#stk-rep-total"),b=p.querySelector("#stk-rep-pos"),c=p.querySelector("#stk-rep-neg");
      if(a)a.textContent=total;if(b)b.textContent=pos;if(c)c.textContent=neg;
      if(p.querySelector("#stk-view-rep")?.classList.contains("active") && status) setStatus(status);
    };
    setInterval(syncLegacy,300);
  }
  // The manifest has to match profile sub-pages so the scanners can fetch/use
  // Steam data, but the visible Toolkit launcher belongs ONLY on the root
  // profile page. Without this guard it is injected into badges, inventory,
  // comments, and scanner/result pages as ordinary page content.
  const isMainProfilePage = /^\/(?:id\/[^/]+|profiles\/\d{17})\/?$/.test(location.pathname);

  if (isMainProfilePage) {
    chrome.runtime.onMessage.addListener(m=>{
      if(m?.type==="OPEN_SCANNER"){
        mount();
        document.querySelector("#scs-panel")?.classList.add("scs-expanded");
      }
    });
    mount();
  }

  async function scanProfile(){
    setStatus("Reading profile...",5); const doc=await fetchDoc(PROFILE_BASE+"/");
    const name=clean(doc.querySelector(".actual_persona_name")?.textContent)||"Steam User";
    const level=Number((clean(doc.querySelector(".friendPlayerLevelNum")?.textContent).match(/\d+/)||[0])[0]);
    // Prefer profile-specific metadata. A generic `.playerAvatar` selector can
    // accidentally match the signed-in user's avatar in Steam's global header.
    let avatar="";

    const ogImage=doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if(ogImage){
      avatar=normalizeImageURL(ogImage);
    }

    if(!avatar){
      const profileHeader=
        doc.querySelector(".profile_header") ||
        doc.querySelector(".profile_header_bg") ||
        doc.querySelector(".profile_header_content");

      if(profileHeader){
        avatar=imageURLFromElement(
          profileHeader.querySelector(
            ".playerAvatarAutoSizeInner img, .profile_header_size img, .playerAvatar img"
          )
        );
      }
    }

    // Last fallback: require the profile-header area rather than searching
    // every avatar on the page.
    if(!avatar){
      avatar=imageURLFromElement(
        doc.querySelector(".profile_header .playerAvatarAutoSizeInner img")
      );
    }
    let steamID64=(PROFILE_BASE.match(/\/profiles\/(\d+)/)||[])[1]||"";
    if(!steamID64) steamID64=(doc.documentElement.innerHTML.match(/7656119\d{10}/)||[])[0]||"";
    const ym=clean(doc.body.textContent).match(/(\d+)\s+Years?\s+of\s+Service/i);
    const vanityMatch=PROFILE_BASE.match(/\/id\/([^/]+)/);
    const vanityURL=vanityMatch?decodeURIComponent(vanityMatch[1]):"";
    return {name,level,avatar,steamID64,vanityURL,yearsText:ym?`${ym[1]} Years of Service`:"",profileURL:PROFILE_BASE};
  }

  function parseBadges(doc){
    return [...doc.querySelectorAll(".badge_row")].map(row=>{
      const rawText=clean(row.textContent), link=row.querySelector('a[href*="/gamecards/"]');
      if(!rawText)return null;
      let name=clean(row.querySelector(".badge_title")?.textContent).replace(/\d[\d,]*\s*XP.*$/i,"").replace(/View details.*$/i,"").trim()||clean(link?.textContent)||"Unknown Badge";
      const xp=(rawText.match(/([\d,]+)\s*XP/i)||[])[1], lv=(rawText.match(/Level\s+(\d+)/i)||[])[1], href=link?.href||"", app=(href.match(/\/gamecards\/(\d+)/)||[])[1]||"";
      const ev=analyzeEventText(`${name} ${rawText}`);
      return {name,level:Number(lv||0),xp:Number((xp||"0").replace(/,/g,"")),appid:app,image:badgeImageURL(row),url:href,foil:/foil/i.test(rawText),year:extractYear(rawText),rawText,eventFlags:ev.flags,eventReasons:ev.reasons};
    }).filter(Boolean);
  }
  async function scanBadges(){
    const all=[];
    for(let page=1;page<=BADGE_MAX_PAGES;page++){
      setStatus(`Scanning badges — page ${page}...`,Math.min(12+page,35));
      const doc=await fetchDoc(`${PROFILE_BASE}/badges/?p=${page}`), found=parseBadges(doc); if(!found.length)break;all.push(...found);
      const next=[...doc.querySelectorAll('a[href*="/badges/?p="],.pagebtn')].some(a=>(a.href||"").includes(`p=${page+1}`)||/next/i.test(a.textContent));
      if(!next)break;await sleep(200);
    }
    const m=new Map();for(const b of all){const k=[b.name,b.appid,b.level,b.xp,b.foil].join("|");if(!m.has(k))m.set(k,b)}return [...m.values()];
  }

  function badgeDetailImage(doc){
    const selectors=[
      ".badge_icon img",
      ".badge_icon",
      ".badge_current img",
      ".badge_current",
      ".badge_info_image img",
      ".badge_info_image",
      ".gamecard_badge img",
      ".gamecard_badge",
      ".badge_crafted img"
    ];
    for(const sel of selectors){
      const el=doc.querySelector(sel);
      if(!el) continue;
      const direct=el.tagName==="IMG"?imageURLFromElement(el):"";
      if(direct) return direct;
      const bg=imageURLFromBackground(el);
      if(bg) return bg;
      const nested=imageURLFromElement(el.querySelector?.("img"));
      if(nested) return nested;
    }
    return "";
  }

  async function resolveBadgeImages(badges){
    let done=0;
    const candidates=badges.filter(b=>b.url);
    for(const badge of candidates){
      done++;
      setStatus(`Resolving badge artwork — ${done}/${candidates.length}...`,Math.min(36+Math.floor(done/Math.max(1,candidates.length)*10),46));
      try{
        const doc=await fetchDoc(badge.url);
        const image=badgeDetailImage(doc);
        if(image) badge.image=image;
      }catch(_){}
      await sleep(80);
    }
    return badges;
  }

  const dkey=(c,i)=>`${c}_${i}`;
  async function scanInventory(steamID64){
    if(!steamID64)throw new Error("SteamID64 could not be detected.");
    const assets=[], descriptions=new Map();let start=null,totalExpected=null;
    for(let page=1;page<=INVENTORY_MAX_PAGES;page++){
      setStatus(`Scanning Community inventory — batch ${page}...`,Math.min(37+page*2,60));
      let url=`https://steamcommunity.com/inventory/${steamID64}/753/6?l=english&count=${INVENTORY_BATCH_SIZE}`;
      if(start)url+=`&start_assetid=${encodeURIComponent(start)}`;
      const r=await fetch(url,{credentials:"include"});if(!r.ok)throw new Error(`Inventory HTTP ${r.status}`);
      const d=await r.json();if(!d.success)throw new Error("Community inventory is private or unavailable.");
      assets.push(...(d.assets||[])); if(Number.isFinite(Number(d.total_inventory_count))) totalExpected=Number(d.total_inventory_count); setStatus(`Scanning Community inventory — ${assets.length.toLocaleString()} / ${(totalExpected||assets.length).toLocaleString()} items`,Math.min(37+Math.floor((assets.length/Math.max(1,totalExpected||assets.length))*23),60)); for(const x of d.descriptions||[])descriptions.set(dkey(x.classid,x.instanceid),x);
      if(!d.more_items||!d.last_assetid)break;start=d.last_assetid;await sleep(250);
    }
    return {assets,descriptions};
  }
  function descText(d){return [d.name,d.market_name,d.market_hash_name,d.type,...(d.descriptions||[]).map(x=>x.value),...(d.owner_descriptions||[]).map(x=>x.value),...(d.tags||[]).flatMap(t=>[t.category,t.internal_name,t.localized_tag_name])].filter(Boolean).join(" ")}
  function appidOf(d){
    // Community inventory items belong to app 753, but Steam often exposes
    // the originating game's AppID separately as market_fee_app.
    if(d.market_fee_app && /^\d+$/.test(String(d.market_fee_app))){
      return String(d.market_fee_app);
    }

    for(const c of [
      d.market_hash_name,
      d.market_name,
      d.name,
      ...(d.descriptions||[]).map(x=>x.value)
    ].filter(Boolean)){
      const m=String(c).match(/^(\d{2,10})-/);
      if(m)return m[1];
    }

    for(const t of d.tags||[]){
      const m=`${t.internal_name||""} ${t.localized_tag_name||""}`.match(/\bapp[_\s-]?(\d{2,10})\b/i);
      if(m)return m[1];
    }

    return "";
  }
  function buildItems(inv){
    const map=new Map();
    for(const a of inv.assets){const d=inv.descriptions.get(dkey(a.classid,a.instanceid));if(!d)continue;const text=descText(d),l=text.toLowerCase(),ev=analyzeEventText(text);
      let category="Other Community Item";if(l.includes("booster pack"))category="Booster Pack";else if(l.includes("trading card"))category="Trading Card";else if(l.includes("profile background"))category="Profile Background";else if(l.includes("emoticon"))category="Emoticon";else if(l.includes("gem"))category="Gems";
      const key=d.market_hash_name||`${d.classid}_${d.instanceid}`;
      if(!map.has(key))map.set(key,{name:d.market_name||d.name||"Unknown Item",marketHashName:d.market_hash_name||"",type:d.type||"",category,appid:appidOf(d),foil:l.includes("foil"),year:extractYear(text),eventFlags:ev.flags,eventReasons:ev.reasons,marketable:Boolean(d.marketable),tradable:Boolean(d.tradable),quantity:0,icon:(d.icon_url_large||d.icon_url)?`https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url_large||d.icon_url}`:""});
      map.get(key).quantity+=Number(a.amount||1);
    }return [...map.values()];
  }

  function analyze(o,apps,type){
    const flags=[],reasons=[];let score=0;
    if(o.foil){flags.push("FOIL");reasons.push("Steam identifies this collectible as a foil variant.");score+=5}
    flags.push(...(o.eventFlags||[]));reasons.push(...(o.eventReasons||[]));
    if(o.eventFlags?.includes("LIMITED-TIME"))score+=5;
    if(o.eventFlags?.includes("LEGACY"))score+=5;
    if(o.eventFlags?.includes("EVENT"))score+=2;
    if(o.year<=LEGACY_YEAR&&o.year){flags.push("OLDER COLLECTIBLE");reasons.push(`Collectible references ${o.year}.`);score+=3}
    else if(o.year<=EARLY_YEAR&&o.year){flags.push("EARLIER COLLECTIBLE");score+=1}
    if(type==="Badge"&&o.level>=5){flags.push("HIGH-LEVEL BADGE");reasons.push(`Badge is level ${o.level}.`);score+=1}
    if(type==="Inventory"&&!o.marketable){flags.push("NON-MARKETABLE");score+=1}
    if(type==="Inventory"&&!o.tradable){flags.push("NON-TRADABLE");score+=1}

    const app=o.appid?apps[o.appid]||null:null;
    if(app?.status==="STORE_UNAVAILABLE"){
      flags.push("STORE UNAVAILABLE");
      reasons.push(`AppID ${o.appid} does not currently return an active Steam Store record. This is not by itself proof that the app was historically delisted.`);
      score+=2;
    }else if(app?.status==="UNKNOWN"){
      flags.push("APP STATUS UNKNOWN");
      reasons.push(`Steam metadata for AppID ${o.appid} could not be confirmed.`);
    }

    return {
      ...o,
      collectorType:type,
      flags:unique(flags),
      reasons:unique(reasons),
      collectorScore:score,
      app
    };
  }

  function buildAppSummaries(apps,badges,items){
    const out={};
    const ensure=id=>{
      if(!id)return null;
      if(!out[id])out[id]={
        ...(apps[id]||{
          appid:id,status:"UNKNOWN",statusLabel:"Unknown",name:"",
          type:"unknown",typeLabel:"Unknown",releaseDate:"",
          developers:[],publishers:[],genres:[],categories:[],
          storeURL:`https://store.steampowered.com/app/${id}/`,
          communityURL:`https://steamcommunity.com/app/${id}`,
          steamdbURL:`https://steamdb.info/app/${id}/`
        }),
        counts:{badges:0,tradingCards:0,foilCards:0,backgrounds:0,emoticons:0,boosters:0,other:0,totalQuantity:0,uniqueItems:0},
        collectorFlags:[]
      };
      return out[id];
    };

    for(const b of badges){
      const a=ensure(b.appid); if(!a)continue;
      a.counts.badges++;
      a.collectorFlags.push(...(b.flags||[]));
    }
    for(const item of items){
      const a=ensure(item.appid); if(!a)continue;
      a.counts.uniqueItems++;
      a.counts.totalQuantity+=Number(item.quantity||1);
      if(item.category==="Trading Card"){
        a.counts.tradingCards+=Number(item.quantity||1);
        if(item.foil)a.counts.foilCards+=Number(item.quantity||1);
      }else if(item.category==="Profile Background")a.counts.backgrounds+=Number(item.quantity||1);
      else if(item.category==="Emoticon")a.counts.emoticons+=Number(item.quantity||1);
      else if(item.category==="Booster Pack")a.counts.boosters+=Number(item.quantity||1);
      else a.counts.other+=Number(item.quantity||1);
      a.collectorFlags.push(...(item.flags||[]));
    }
    for(const a of Object.values(out))a.collectorFlags=unique(a.collectorFlags);
    return out;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if(message?.type === "APP_CHECK_PROGRESS") {
      const done=Number(message.done||0), total=Number(message.total||0);
      setStatus(`Checking associated apps... ${done}/${total}`, 65 + (total ? Math.round((done/total)*20) : 0));
    }
  });

  async function run(){
    const btn=document.querySelector("#scs-start");btn.disabled=true;btn.textContent="Scanning...";const errors=[];
    try{
      const profile=await scanProfile();let badges=[],items=[];
      try{
        badges=await scanBadges();
        badges=await resolveBadgeImages(badges);
      }catch(e){errors.push(`Badges: ${e.message}`)}
      try{items=buildItems(await scanInventory(profile.steamID64))}catch(e){errors.push(`Inventory: ${e.message}`)}
      const appids=unique([...badges.map(x=>x.appid),...items.map(x=>x.appid)]).filter(x=>/^\d+$/.test(x));
      setStatus(`Checking ${appids.length} associated apps...`,65);
      const reply=await chrome.runtime.sendMessage({type:"CHECK_APPS",appids});
      const apps=reply?.ok?reply.results:{};if(!reply?.ok)errors.push(`Store checks: ${reply?.error||"Unknown error"}`);
      setStatus("Analyzing collector data...",88);
      const analyzedBadges=badges.map(x=>analyze(x,apps,"Badge")), analyzedItems=items.map(x=>analyze(x,apps,"Inventory"));
      const appSummaries=buildAppSummaries(apps,analyzedBadges,analyzedItems);

      // Keep Steam image URLs instead of converting hundreds of images to
      // base64. The extension page is allowed to load the Steam CDN hosts
      // directly, avoiding Chrome's extension-message size limit.
      const imageURLs=unique([
        profile.avatar,
        ...analyzedBadges.map(x=>x.image),
        ...analyzedItems.map(x=>x.icon)
      ]).map(normalizeImageURL).filter(Boolean);

      setStatus(`Preparing ${imageURLs.length} image URLs...`,94);

      const failedRequests=Object.values(apps).filter(a=>a?.status==="UNKNOWN").map(a=>({type:"app",appid:a.appid,error:a.evidence||"Request failed"}));
      const data={
        version:VERSION,
        scannedAt:new Date().toISOString(),
        profile,
        badges:analyzedBadges,
        items:analyzedItems,
        apps,
        appSummaries,
        imageDiagnostics:{
          profileAvatarURL:profile.avatar||"",
          badgeImageURLs:analyzedBadges.filter(x=>x.image).length,
          inventoryImageURLs:analyzedItems.filter(x=>x.icon).length,
          uniqueImageURLs:imageURLs.length,
          mode:"direct"
        },
        errors,
        failedRequests
      };
      await chrome.storage.local.set({lastScan:data});
      const dashboardReply = await chrome.runtime.sendMessage({type:"OPEN_DASHBOARD"});
      if (!dashboardReply?.ok) {
        throw new Error(`Dashboard could not be opened: ${dashboardReply?.error || "Unknown error"}`);
      }
      setStatus(`Complete — ${badges.length} badges and ${items.length} unique items.`,100);
    }catch(e){setStatus(`ERROR: ${e.message}`,0);alert(`Steam Collector Scanner failed:\n\n${e.message}`)}
    finally{btn.disabled=false;btn.textContent="Scan Collector Profile"}
  }
})();
