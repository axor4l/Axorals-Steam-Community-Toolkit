const STORE_DELAY = 100;
const STORE_TIMEOUT = 8000;
const STORE_CONCURRENCY = 4;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_STEAM_SESSION_ID") {
    chrome.cookies.get({url:"https://steamcommunity.com/", name:"sessionid"})
      .then(cookie => sendResponse({ok:Boolean(cookie?.value), sessionID:cookie?.value||""}))
      .catch(error => sendResponse({ok:false,error:error.message}));
    return true;
  }
  if (message?.type === "CHECK_APPS") {
    checkApps(message.appids || [], (done,total) => {
      if(sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id,{type:"APP_CHECK_PROGRESS",done,total}).catch(()=>{});
    })
      .then(results => sendResponse({ok: true, results}))
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({url: chrome.runtime.getURL("dashboard/dashboard.html")})
      .then(tab => sendResponse({ok: true, tabId: tab.id}))
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }

  if (message?.type === "FETCH_IMAGE") {
    fetchImageAsDataURL(message.url || "")
      .then(dataURL => sendResponse({ok: Boolean(dataURL), dataURL}))
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab?.url || !/^https:\/\/steamcommunity\.com\/(id\/[^/]+|profiles\/\d+)/i.test(tab.url)) return;
  try { await chrome.tabs.sendMessage(tab.id, {type:"OPEN_SCANNER"}); } catch (_) {}
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function releaseDate(data){
  const d=data?.release_date;
  return d?.date || "";
}

function classifyStoreResult(appid, result){
  const storeURL=`https://store.steampowered.com/app/${appid}/`;
  const communityURL=`https://steamcommunity.com/app/${appid}`;
  const steamdbURL=`https://steamdb.info/app/${appid}/`;

  if(result?.success && result.data){
    const d=result.data;
    const type=String(d.type||"").toLowerCase() || "unknown";
    return {
      appid:String(appid),
      status:"STORE_AVAILABLE",
      statusLabel:"Store Available",
      evidence:"Steam Store appdetails returned an active app record.",
      name:d.name||"",
      type,
      typeLabel:type ? type.charAt(0).toUpperCase()+type.slice(1) : "Unknown",
      releaseDate:releaseDate(d),
      comingSoon:Boolean(d.release_date?.coming_soon),
      free:Boolean(d.is_free),
      requiredAge:d.required_age||0,
      developers:Array.isArray(d.developers)?d.developers:[],
      publishers:Array.isArray(d.publishers)?d.publishers:[],
      genres:Array.isArray(d.genres)?d.genres.map(x=>x.description).filter(Boolean):[],
      categories:Array.isArray(d.categories)?d.categories.map(x=>x.description).filter(Boolean):[],
      headerImage:d.header_image||"",
      capsuleImage:d.capsule_image||"",
      website:d.website||"",
      storeURL,communityURL,steamdbURL
    };
  }

  return {
    appid:String(appid),
    status:"STORE_UNAVAILABLE",
    statusLabel:"Store Unavailable",
    evidence:"Steam Store appdetails did not return an active Store record. This alone does not prove historical delisting.",
    name:"",
    type:"unknown",
    typeLabel:"Unknown",
    releaseDate:"",
    comingSoon:false,
    free:false,
    developers:[],
    publishers:[],
    genres:[],
    categories:[],
    storeURL,communityURL,steamdbURL
  };
}

async function checkApp(appid){
  const url=`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=english&cc=us`;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),STORE_TIMEOUT);
    let response;
    try{
      response=await fetch(url,{credentials:"omit",cache:"no-cache",signal:controller.signal});
    } finally {
      clearTimeout(timeout);
    }
    if(!response.ok){
      return {
        appid:String(appid),status:"UNKNOWN",statusLabel:"Unknown",
        evidence:`Steam Store request returned HTTP ${response.status}.`,
        name:"",type:"unknown",typeLabel:"Unknown",releaseDate:"",
        developers:[],publishers:[],genres:[],categories:[],
        storeURL:`https://store.steampowered.com/app/${appid}/`,
        communityURL:`https://steamcommunity.com/app/${appid}`,
        steamdbURL:`https://steamdb.info/app/${appid}/`
      };
    }
    const json=await response.json();
    return classifyStoreResult(appid,json[String(appid)]);
  }catch(error){
    return {
      appid:String(appid),status:"UNKNOWN",statusLabel:"Unknown",
      evidence:error.message||"Steam Store metadata request failed.",
      name:"",type:"unknown",typeLabel:"Unknown",releaseDate:"",
      developers:[],publishers:[],genres:[],categories:[],
      storeURL:`https://store.steampowered.com/app/${appid}/`,
      communityURL:`https://steamcommunity.com/app/${appid}`,
      steamdbURL:`https://steamdb.info/app/${appid}/`
    };
  }
}

async function checkApps(appids,onProgress){
  const out={};
  const unique=[...new Set(appids.map(String).filter(x=>/^\d+$/.test(x)))];
  let cursor=0;
  let done=0;
  async function worker(){
    while(true){
      const index=cursor++;
      if(index>=unique.length) return;
      const appid=unique[index];
      out[appid]=await checkApp(appid);
      done++;
      try{ onProgress?.(done,unique.length); }catch(_){}
      if(STORE_DELAY) await sleep(STORE_DELAY);
    }
  }
  const workers=Array.from({length:Math.min(STORE_CONCURRENCY,unique.length)},()=>worker());
  await Promise.all(workers);
  return out;
}

async function blobToDataURL(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binary="";
  const chunkSize=0x8000;
  for(let i=0;i<bytes.length;i+=chunkSize){
    binary+=String.fromCharCode(...bytes.subarray(i,i+chunkSize));
  }
  return `data:${blob.type||"image/png"};base64,${btoa(binary)}`;
}

async function fetchImageAsDataURL(url){
  if(!url || !/^https:\/\//i.test(url)) return "";
  try{
    const response=await fetch(url,{credentials:"omit",cache:"force-cache"});
    if(!response.ok) return "";
    const blob=await response.blob();
    if(!blob.size) return "";
    return await blobToDataURL(blob);
  }catch(_){ return ""; }
}

// Community Market price lookup for Collector high-value filtering.
if (!globalThis.__stkMarketPriceListenerInstalled) {
  globalThis.__stkMarketPriceListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "CHECK_MARKET_PRICES") return;
    checkMarketPrices(message.items || [])
      .then(results => sendResponse({ok:true, results}))
      .catch(error => sendResponse({ok:false, error:error.message}));
    return true;
  });
}

function parseUSDPrice(value){
  if(!value) return null;
  const m=String(value).replace(/,/g,"").match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}

async function checkMarketPrices(items){
  const out={};
  const names=[...new Set(items.map(x=>String(x.marketHashName||"").trim()).filter(Boolean))];
  const CACHE_TTL=6*60*60*1000;
  const stored=await chrome.storage.local.get("marketCache");
  const cache=stored.marketCache||{};
  let dirty=false;
  for(const name of names){
    const cached=cache[name];
    if(cached && cached.cachedAt && Date.now()-cached.cachedAt<CACHE_TTL){
      out[name]={...cached,fromCache:true};
      continue;
    }
    try{
      const url=`https://steamcommunity.com/market/priceoverview/?appid=753&currency=1&market_hash_name=${encodeURIComponent(name)}`;
      const r=await fetch(url,{credentials:"include",cache:"no-cache"});
      if(!r.ok){out[name]={ok:false,error:`HTTP ${r.status}`};continue;}
      const d=await r.json();
      const display=d.lowest_price||d.median_price||"";
      const value={ok:Boolean(d.success),lowestPrice:d.lowest_price||"",medianPrice:d.median_price||"",volume:d.volume||"",priceUSD:parseUSDPrice(display),cachedAt:Date.now()};
      out[name]=value; cache[name]=value; dirty=true;
    }catch(e){out[name]={ok:false,error:e.message||"Price lookup failed"};}
    await sleep(180);
  }
  if(dirty) await chrome.storage.local.set({marketCache:cache});
  return out;
}

// Toolkit maintenance / retry API (v0.7)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_TOOLKIT_INFO") {
    sendResponse({ok:true, version:chrome.runtime.getManifest().version});
    return;
  }
  if (message?.type === "CLEAR_TOOLKIT_CACHE") {
    chrome.storage.local.remove(["appCache","marketCache"]).then(()=>sendResponse({ok:true})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if (message?.type === "RETRY_FAILED_APPS") {
    const ids=(message.appids||[]).map(String).filter(x=>/^\d+$/.test(x));
    checkApps(ids).then(results=>sendResponse({ok:true,results})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
});
