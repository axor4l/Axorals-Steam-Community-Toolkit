// ==UserScript==
// @name         Steam Group Collector V4.3
// @namespace    steam-group-collector
// @version      4.3
// @description  Finds Steam groups, displays group avatars, and can join groups sequentially with verification.
// @match        https://steamcommunity.com/id/*
// @match        https://steamcommunity.com/profiles/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    console.log('[Steam Group Collector] V4.3 loaded');

    // =========================================================
    // SETTINGS
    // =========================================================

    const JOIN_DELAY = 5000;
    const VERIFY_DELAY = 1500;

    // =========================================================
    // ONLY RUN ON PROFILE PAGES
    // =========================================================

    if (
        !location.pathname.startsWith('/id/') &&
        !location.pathname.startsWith('/profiles/')
    ) {
        return;
    }

    if (!document.body) {
        return;
    }

    // =========================================================
    // PROFILE URL
    // =========================================================

    function getProfileBase() {
        const match = location.pathname.match(
            /^\/(id\/[^/]+|profiles\/\d+)/
        );

        if (!match) {
            return null;
        }

        return 'https://steamcommunity.com/' + match[1];
    }

    const profileBase = getProfileBase();

    // =========================================================
    // MAIN PANEL
    // =========================================================

    const panel = document.createElement('div');

    panel.id = 'steam-group-collector-panel';

    // Hidden controller only; Steam Toolkit owns the visible UI.
    panel.style.setProperty('display', 'none', 'important');

    panel.innerHTML = `
        <div class="sgc-title">
            Steam Group Collector
        </div>

        <div id="sgc-profile">
            ${
                profileBase
                    ? 'Profile detected'
                    : 'No profile detected'
            }
        </div>

        <button id="sgc-scan">
            Find All Groups
        </button>

        <div id="sgc-status">
            Ready
        </div>
    `;

    Object.assign(panel.style, {
        position: 'fixed',
        top: '100px',
        right: '20px',
        width: '280px',
        padding: '16px',
        background: '#171d25',
        color: '#ffffff',
        border: '2px solid #66c0f4',
        borderRadius: '6px',
        zIndex: '2147483647',
        fontFamily: 'Arial, sans-serif',
        boxShadow: '0 5px 30px rgba(0,0,0,.8)'
    });

    document.body.appendChild(panel);

    // =========================================================
    // PANEL CSS
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `
        #steam-group-collector-panel .sgc-title {
            font-size: 18px;
            font-weight: bold;
            color: #66c0f4;
            margin-bottom: 10px;
        }

        #sgc-profile {
            font-size: 12px;
            color: #aaa;
            margin-bottom: 10px;
            word-break: break-all;
        }

        #sgc-scan {
            width: 100%;
            background: #1a9fff;
            color: white;
            border: none;
            border-radius: 3px;
            padding: 10px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
        }

        #sgc-scan:hover {
            background: #66c0f4;
            color: #111;
        }

        #sgc-scan:disabled {
            opacity: .6;
            cursor: default;
        }

        #sgc-status {
            margin-top: 10px;
            padding: 8px;
            background: #0e141b;
            font-size: 12px;
            min-height: 18px;
        }
    `;

    document.head.appendChild(style);

    const scanButton = document.getElementById('sgc-scan');
    const status = document.getElementById('sgc-status');

    // =========================================================
    // HELPERS
    // =========================================================

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getUsername() {
        return (
            document.querySelector('.actual_persona_name')
                ?.textContent?.trim()
            ||
            document.querySelector('.profile_header_centered_persona')
                ?.textContent?.trim()
            ||
            'Steam User'
        );
    }

    // =========================================================
    // EXTRACT IMAGE FROM A GROUP LINK / CONTAINER
    // =========================================================

    function findGroupImage(link) {
        let img = link.querySelector('img');

        if (img) {
            return (
                img.getAttribute('src') ||
                img.getAttribute('data-src') ||
                img.getAttribute('data-original') ||
                ''
            );
        }

        // Steam often puts the link inside a larger group container.
        let parent = link;

        for (let i = 0; i < 6 && parent; i++) {
            img = parent.querySelector?.('img');

            if (img) {
                const src =
                    img.getAttribute('src') ||
                    img.getAttribute('data-src') ||
                    img.getAttribute('data-original');

                if (src) {
                    return src;
                }
            }

            parent = parent.parentElement;
        }

        return '';
    }

    // =========================================================
    // FIND GROUPS
    // =========================================================

    async function getGroups() {
        if (!profileBase) {
            throw new Error(
                'Could not detect Steam profile.'
            );
        }

        const groupsURL = profileBase + '/groups/';

        status.textContent = 'Loading group page...';

        const response = await fetch(groupsURL, {
            credentials: 'include',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(
                'Steam returned HTTP ' + response.status
            );
        }

        const html = await response.text();

        status.textContent =
            'Scanning groups and avatars...';

        const parser = new DOMParser();

        const doc = parser.parseFromString(
            html,
            'text/html'
        );

        const groups = new Map();

        const links = doc.querySelectorAll('a[href]');

        links.forEach(link => {
            try {
                const href = link.getAttribute('href');

                if (!href) {
                    return;
                }

                const url = new URL(
                    href,
                    'https://steamcommunity.com'
                );

                if (
                    url.hostname !== 'steamcommunity.com'
                ) {
                    return;
                }

                const match = url.pathname.match(
                    /^\/groups\/([^/]+)\/?/
                );

                if (!match) {
                    return;
                }

                const groupName = match[1];

                const cleanURL =
                    'https://steamcommunity.com/groups/' +
                    groupName;

                // -----------------------------------------
                // GROUP DISPLAY NAME
                // -----------------------------------------

                let name = link.textContent
                    .replace(/\s+/g, ' ')
                    .trim();

                const directImage =
                    link.querySelector('img');

                if (
                    !name &&
                    directImage?.alt
                ) {
                    name =
                        directImage.alt.trim();
                }

                if (!name) {
                    const parent =
                        link.parentElement;

                    if (parent) {
                        const text =
                            parent.textContent
                                .replace(/\s+/g, ' ')
                                .trim();

                        if (
                            text &&
                            text.length < 150
                        ) {
                            name = text;
                        }
                    }
                }

                if (!name) {
                    name =
                        decodeURIComponent(
                            groupName
                        );
                }

                // -----------------------------------------
                // GROUP AVATAR
                // -----------------------------------------

                const avatar =
                    findGroupImage(link);

                // -----------------------------------------
                // STORE / UPDATE GROUP
                // -----------------------------------------

                if (!groups.has(cleanURL)) {
                    groups.set(cleanURL, {
                        name,
                        url: cleanURL,
                        avatar: avatar || ''
                    });
                } else {
                    // Sometimes Steam has multiple links to
                    // the same group. If an earlier link did
                    // not contain the avatar, use this one.
                    const existing =
                        groups.get(cleanURL);

                    if (
                        !existing.avatar &&
                        avatar
                    ) {
                        existing.avatar = avatar;
                    }

                    // Prefer a better group name if the
                    // existing name was just the URL name.
                    if (
                        existing.name === groupName &&
                        name !== groupName
                    ) {
                        existing.name = name;
                    }
                }
            }

            catch (error) {
                console.warn(
                    '[SGC] Link parse error:',
                    error
                );
            }
        });

        const result =
            Array.from(groups.values());

        result.sort(
            (a, b) =>
                a.name.localeCompare(b.name)
        );

        console.log(
            '[SGC] Groups with avatars:',
            result
        );

        return result;
    }

    // =========================================================
    // GROUP JOIN HELPERS (MV3 extension-safe)
    // =========================================================
    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async function getSessionID() {
        try {
            const reply = await chrome.runtime.sendMessage({ type: 'GET_STEAM_SESSION_ID' });
            if (reply?.ok && reply.sessionID) return String(reply.sessionID);
        } catch (error) {
            console.warn('[SGC] Extension session lookup failed:', error);
        }
        try {
            const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
            if (match) return decodeURIComponent(match[1]);
        } catch (_) {}
        return null;
    }

    async function downloadGroupPage(group) {
        const separator = group.url.includes('?') ? '&' : '?';
        const response = await fetch(group.url + separator + 'sgc_cache=' + Date.now(), {
            method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow'
        });
        if (!response.ok) throw new Error('Group page returned HTTP ' + response.status);
        return await response.text();
    }

    function inspectGroupPage(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let joinAvailable=false, requestAvailable=false, leaveAvailable=false, inviteOnly=false;
        doc.querySelectorAll('a,button,input[type="button"],input[type="submit"]').forEach(element => {
            const text=(element.textContent||element.value||'').replace(/\s+/g,' ').trim().toLowerCase();
            const onclick=(element.getAttribute('onclick')||'').toLowerCase();
            const href=(element.getAttribute('href')||'').toLowerCase();
            if(text==='join group'||text==='join'||onclick.includes('joingroup')||href.includes('action=join')) joinAvailable=true;
            if(text.includes('request to join')||text.includes('request membership')||text.includes('request to become')) requestAvailable=true;
            if(text==='leave group'||onclick.includes('leavegroup')||href.includes('action=leave')) leaveAvailable=true;
        });
        const joinArea=doc.querySelector('.grouppage_join_area');
        if(joinArea){const text=joinArea.textContent.replace(/\s+/g,' ').trim().toLowerCase();if(text.includes('join group'))joinAvailable=true;if(text.includes('request'))requestAvailable=true;}
        const pageText=(doc.body?.textContent||'').replace(/\s+/g,' ').toLowerCase();
        if(pageText.includes('invite only')||pageText.includes('closed group')) inviteOnly=true;
        return {joinAvailable,requestAvailable,leaveAvailable,inviteOnly};
    }

    async function getGroupState(group) { return inspectGroupPage(await downloadGroupPage(group)); }

    async function sendJoinRequest(group, sessionID) {
        const form=new URLSearchParams(); form.set('action','join'); form.set('sessionID',sessionID);
        const response=await fetch(group.url,{method:'POST',credentials:'include',cache:'no-store',redirect:'follow',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:form.toString()});
        if(!response.ok) throw new Error('Join POST returned HTTP '+response.status);
        return await response.text();
    }

    async function joinGroup(group) {
        const sessionID=await getSessionID();
        if(!sessionID) return {result:'failed',message:'Could not obtain Steam session ID'};
        const before=await getGroupState(group);
        if(before.leaveAvailable&&!before.joinAvailable) return {result:'already',message:'Already a member'};
        if(before.inviteOnly&&!before.joinAvailable) return {result:'closed',message:'Invite only'};
        if(before.requestAvailable&&!before.joinAvailable) return {result:'requested',message:'Membership request required'};
        if(!before.joinAvailable) return {result:'failed',message:'No Join Group action found'};
        const responseHTML=await sendJoinRequest(group,sessionID);
        const immediate=inspectGroupPage(responseHTML);
        if(immediate.leaveAvailable&&!immediate.joinAvailable) return {result:'joined',message:'Membership verified'};
        await sleep(VERIFY_DELAY);
        const after=await getGroupState(group);
        if(after.leaveAvailable&&!after.joinAvailable) return {result:'joined',message:'Membership verified'};
        if(after.requestAvailable&&!after.joinAvailable) return {result:'requested',message:'Membership request required'};
        if(after.inviteOnly&&!after.joinAvailable) return {result:'closed',message:'Invite only'};
        if(after.joinAvailable) return {result:'failed',message:'Steam still shows Join Group'};
        return {result:'failed',message:'Steam response could not be verified'};
    }

    // =========================================================
    // RESULTS WINDOW
    // =========================================================

    function showResults(groups) {
        const username = getUsername();
        const win = window.open('', '_blank');
        if (win) win.name = 'steam-toolkit-result';
        if (!win) { alert('Popup blocked. Allow popups for steamcommunity.com.'); return; }

        const rows = groups.map((group,index)=>`<div class="group" id="group-${index}">
          <div class="number">${index+1}</div>
          <div class="avatar-container">${group.avatar?`<img class="group-avatar" src="${escapeHTML(group.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<div class="avatar-placeholder">?</div>`}</div>
          <div class="info"><a class="group-name" href="${escapeHTML(group.url)}" target="_blank" rel="noopener">${escapeHTML(group.name)}</a>
          <div class="url">${escapeHTML(group.url)}</div><div class="join-status" id="status-${index}">Waiting</div></div></div>`).join('');

        win.document.open();
        win.document.write(`<!doctype html><html><head><meta charset="UTF-8"><meta name="steam-toolkit-result" content="group-collector"><title>Steam Groups</title><style>
        *{box-sizing:border-box}body{margin:0;background:#1b2838;color:#fff;font-family:Arial,sans-serif}header{padding:30px;background:#171d25;border-bottom:1px solid #2a475e}h1{margin:0 0 8px;color:#66c0f4}.subtitle{color:#aaa}.toolbar{position:sticky;top:0;padding:15px 30px;background:#16202d;display:flex;gap:10px;flex-wrap:wrap;z-index:1000;border-bottom:1px solid #2a475e}.toolbar button{padding:10px 15px;background:#2a475e;color:#fff;border:0;cursor:pointer;border-radius:3px;font-weight:bold}.toolbar button:hover{background:#66c0f4;color:#111}.toolbar button:disabled{opacity:.5}#join-all{background:#75b022}#stop-join{background:#a33;display:none}#search{width:300px;max-width:100%;background:#0e141b;color:#fff;border:1px solid #2a475e;padding:10px}#progress{width:100%;margin-top:5px;padding:12px;background:#0e141b;color:#c7d5e0;display:none;border-radius:3px}.container{max-width:1100px;margin:30px auto;padding:0 20px}.group{display:flex;align-items:center;min-height:100px;padding:12px;margin-bottom:8px;background:#16202d;border-radius:4px}.number{width:45px;flex-shrink:0;color:#66c0f4;font-weight:bold;text-align:center}.avatar-container{width:72px;height:72px;flex-shrink:0;margin-right:16px;border-radius:4px;overflow:hidden;background:#0e141b;border:1px solid #2a475e}.group-avatar{display:block;width:100%;height:100%;object-fit:cover}.avatar-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#2a475e;font-size:32px}.info{flex:1;min-width:0}.group-name{color:#66c0f4;font-size:18px;font-weight:bold;text-decoration:none}.url{color:#888;font-size:12px;margin-top:6px;word-break:break-all}.join-status{margin-top:10px;font-size:12px;color:#aaa}.join-status.success{color:#8ed629}.join-status.failure{color:#ff7373}.join-status.warning{color:#e5c07b}.join-status.processing{color:#66c0f4}
        
/* Steam Toolkit v0.6 shared retro skin */
body{background:radial-gradient(circle at 50% -20%,#123040 0,#08151b 36%,#050c10 85%)!important;color:#c7d5e0!important;font-family:Consolas,"Lucida Console",monospace!important}body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483646;background:repeating-linear-gradient(0deg,rgba(255,255,255,.015) 0,rgba(255,255,255,.015) 1px,transparent 1px,transparent 4px)}header,.header{background:linear-gradient(110deg,#071218,#0d2631)!important;border-bottom:1px solid #286377!important}h1,h2{font-family:Consolas,monospace!important;text-shadow:0 0 10px rgba(102,192,244,.2)}button,input{font-family:Consolas,monospace!important;border-radius:2px!important}.toolbar{background:#071218!important;border-bottom:1px solid #183f4b!important}.group,.comment{background:linear-gradient(100deg,#09171d,#0b1c23)!important;border:1px solid #123541!important;border-left:3px solid #1d5666!important;border-radius:2px!important;transition:.15s ease!important}.group:hover,.comment:hover{background:#0d2530!important;border-left-color:#76ff9f!important;transform:translateX(3px)}a{color:#66c0f4}.join-status.success{color:#76ff9f!important}.join-status.processing{color:#66c0f4!important}.join-status.failure{color:#ff7373!important}.avatar-placeholder,.fallback-avatar{background:#050d11!important;color:#76ff9f!important}
</style></head><body><header><h1>Steam Groups</h1><div class="subtitle">${escapeHTML(username)} &mdash; ${groups.length} groups found</div></header><div class="toolbar"><input id="search" placeholder="Search groups..."><button id="copy">Copy All Links</button><button id="join-all">Join All Groups</button><button id="stop-join">Stop Joining</button><div id="progress">Ready</div></div><div class="container" id="groups">${rows||'<div>No groups found.</div>'}</div></body></html>`);
        win.document.close();

        // IMPORTANT: bind handlers from the extension content script. Inline
        // scripts written into Steam pages are blocked by Steam's CSP in MV3.
        const d=win.document;
        const removeInjectedToolkit=()=>d.querySelectorAll('#scs-panel').forEach(el=>el.remove());
        removeInjectedToolkit();
        new win.MutationObserver(removeInjectedToolkit).observe(d.documentElement,{childList:true,subtree:true});
        d.getElementById('search').addEventListener('input',function(){const q=this.value.toLowerCase();d.querySelectorAll('.group').forEach(row=>row.style.display=row.textContent.toLowerCase().includes(q)?'flex':'none');});
        d.getElementById('copy').addEventListener('click',async()=>{const text=groups.map(g=>g.url).join('\n');try{await navigator.clipboard.writeText(text);win.alert(groups.length+' links copied.');}catch(_){win.prompt('Copy these links:',text);}});

        let stop=false, running=false;
        const stopBtn=d.getElementById('stop-join'), joinBtn=d.getElementById('join-all'), progress=d.getElementById('progress');
        stopBtn.addEventListener('click',()=>{stop=true;stopBtn.disabled=true;stopBtn.textContent='Stopping...';});
        const rowStatus=(i,text,type='')=>{const el=d.getElementById('status-'+i);if(!el)return;el.textContent=text;el.className='join-status'+(type?' '+type:'');};
        joinBtn.addEventListener('click',async()=>{
          if(running||!groups.length)return;
          if(!win.confirm(`Join all ${groups.length} groups?\n\nGroups will be processed one at a time with a ${JOIN_DELAY/1000} second delay.`))return;
          running=true;stop=false;joinBtn.disabled=true;stopBtn.style.display='inline-block';stopBtn.disabled=false;stopBtn.textContent='Stop Joining';progress.style.display='block';
          let joined=0,already=0,requested=0,closed=0,failed=0;
          for(let i=0;i<groups.length;i++){
            if(stop)break;
            rowStatus(i,'Checking...','processing');progress.textContent=`Processing ${i+1}/${groups.length}: ${groups[i].name}`;
            try{
              const r=await joinGroup(groups[i]);
              if(r.result==='joined'){joined++;rowStatus(i,r.message,'success');}
              else if(r.result==='already'){already++;rowStatus(i,r.message,'success');}
              else if(r.result==='requested'){requested++;rowStatus(i,r.message,'warning');}
              else if(r.result==='closed'){closed++;rowStatus(i,r.message,'warning');}
              else{failed++;rowStatus(i,r.message||'Failed','failure');}
            }catch(e){failed++;rowStatus(i,e.message||'Failed','failure');}
            if(i<groups.length-1&&!stop){for(let sec=Math.ceil(JOIN_DELAY/1000);sec>0;sec--){if(stop)break;progress.textContent=`Joined: ${joined} | Already: ${already} | Failed: ${failed} | Next in ${sec}s`;await sleep(1000);}}
          }
          running=false;joinBtn.disabled=false;stopBtn.style.display='none';progress.textContent=`${stop?'Stopped.':'Finished.'} Joined: ${joined} | Already joined: ${already} | Requests: ${requested} | Invite only: ${closed} | Failed: ${failed}`;
        });
    }

    // =========================================================
    // SCAN BUTTON
    // =========================================================

    scanButton.addEventListener(
        'click',
        async () => {

            scanButton.disabled =
                true;

            scanButton.textContent =
                'Scanning...';

            status.textContent =
                'Starting scan...';

            try {

                const groups =
                    await getGroups();

                status.textContent =
                    'Found ' +
                    groups.length +
                    ' groups.';

                showResults(groups);

                scanButton.textContent =
                    'Find All Groups';
            }

            catch (error) {

                console.error(
                    '[Steam Group Collector ERROR]',
                    error
                );

                status.textContent =
                    'ERROR: ' +
                    error.message;

                alert(
                    'Steam Group Collector error:\\n\\n' +
                    error.message
                );

                scanButton.textContent =
                    'Try Again';
            }

            scanButton.disabled =
                false;
        }
    );

})();