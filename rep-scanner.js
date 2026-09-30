// ==UserScript==
// @name         Steam Profile REP Scanner
// @namespace    steam-rep-scanner
// @version      1.8
// @description  Scan Steam profile comments for +rep/-rep with safe author association, timestamps, avatars, and fallback icons
// @match        https://steamcommunity.com/id/*
// @match        https://steamcommunity.com/profiles/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // SETTINGS
    // =========================================================

    const COMMENTS_PER_REQUEST = 50;
    const REQUEST_DELAY = 600;
    const AVATAR_LOOKUP_DELAY = 100;

    let positiveComments = [];
    let negativeComments = [];

    // Exact verified profile URL -> avatar result
    const avatarCache = new Map();


    // =========================================================
    // ONLY RUN ON MAIN PROFILE PAGES
    // =========================================================

    const pathParts = location.pathname
        .split('/')
        .filter(Boolean);

    if (
        !(
            (pathParts[0] === 'id' && pathParts.length === 2) ||
            (pathParts[0] === 'profiles' && pathParts.length === 2)
        )
    ) {
        return;
    }


    // =========================================================
    // CREATE PANEL
    // =========================================================

    const panel = document.createElement('div');

    panel.id = 'steam-rep-scanner-legacy-panel';

    // Hidden controller only; Steam Toolkit owns the visible UI.
    panel.style.setProperty('display', 'none', 'important');

    panel.style.cssText = `
        display: none !important;
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 260px;
        background: #171d25;
        color: #d6d7d8;
        border: 1px solid #3d4450;
        border-radius: 6px;
        padding: 15px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 15px rgba(0,0,0,.5);
    `;

    panel.innerHTML = `
        <div style="
            font-size:18px;
            font-weight:bold;
            color:white;
            margin-bottom:12px;
        ">
            REP Scanner
        </div>

        <button
            id="repScanButton"
            style="
                width:100%;
                padding:10px;
                background:#1a9fff;
                border:none;
                border-radius:3px;
                color:white;
                font-weight:bold;
                cursor:pointer;
                margin-bottom:12px;
            "
        >
            Scan Comments
        </button>

        <div style="line-height:2;font-size:14px;">

            <div>
                Total Analyzed:
                <strong id="repTotal">0</strong>
            </div>

            <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
            ">
                <span style="color:#66c0f4;">
                    +REP:
                    <strong id="repPositive">0</strong>
                </span>

                <button
                    id="viewPositive"
                    style="
                        display:none;
                        background:#2a475e;
                        color:#fff;
                        border:1px solid #66c0f4;
                        border-radius:3px;
                        padding:3px 9px;
                        cursor:pointer;
                        font-size:12px;
                    "
                >
                    View
                </button>
            </div>

            <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
            ">
                <span style="color:#ff6b6b;">
                    -REP:
                    <strong id="repNegative">0</strong>
                </span>

                <button
                    id="viewNegative"
                    style="
                        display:none;
                        background:#2a475e;
                        color:#fff;
                        border:1px solid #ff6b6b;
                        border-radius:3px;
                        padding:3px 9px;
                        cursor:pointer;
                        font-size:12px;
                    "
                >
                    View
                </button>
            </div>

        </div>

        <div
            id="repStatus"
            style="
                margin-top:10px;
                font-size:12px;
                color:#8f98a0;
            "
        >
            Ready to scan.
        </div>
    `;

    document.body.appendChild(panel);


    // =========================================================
    // UI ELEMENTS
    // =========================================================

    const button =
        document.getElementById('repScanButton');

    const totalElement =
        document.getElementById('repTotal');

    const positiveElement =
        document.getElementById('repPositive');

    const negativeElement =
        document.getElementById('repNegative');

    const statusElement =
        document.getElementById('repStatus');

    const viewPositive =
        document.getElementById('viewPositive');

    const viewNegative =
        document.getElementById('viewNegative');


    // =========================================================
    // GET TARGET PROFILE STEAMID
    // =========================================================

    function getTargetSteamID() {

        // Numeric profile URLs are authoritative.
        const direct = location.pathname.match(/^\/profiles\/(\d{17})\/?$/);
        if (direct) return direct[1];

        // On vanity URLs, only read profile-specific data. Do NOT use
        // g_steamID: on Steam that can refer to the signed-in viewer.
        const html = document.documentElement.innerHTML;
        const patterns = [
            /g_rgProfileData\s*=\s*\{[\s\S]{0,2500}?["']steamid["']\s*:\s*["'](\d{17})["']/i,
            /["']steamid["']\s*:\s*["'](\d{17})["'][\s\S]{0,1200}?["']personaname["']/i,
            /Profile_(\d{17})/
        ];
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
        }

        // data-miniprofile stores the account ID (SteamID3 account number).
        // Convert it to SteamID64 using Valve's fixed individual-account base.
        const mini = document.querySelector('.profile_header [data-miniprofile], .profile_header_content [data-miniprofile]');
        const accountID = Number(mini?.getAttribute('data-miniprofile'));
        if (Number.isSafeInteger(accountID) && accountID > 0) {
            return (76561197960265728n + BigInt(accountID)).toString();
        }

        return null;
    }


    // =========================================================
    // NORMALIZE PROFILE URL
    // =========================================================

    function normalizeProfileURL(url) {

        if (!url) {
            return '';
        }


        try {

            const parsed =
                new URL(
                    url,
                    location.origin
                );


            if (
                parsed.hostname !==
                'steamcommunity.com'
            ) {
                return '';
            }

            parsed.protocol = 'https:';


            if (
                !(
                    parsed.pathname.startsWith('/id/') ||
                    parsed.pathname.startsWith('/profiles/')
                )
            ) {
                return '';
            }


            parsed.search = '';
            parsed.hash = '';


            return (
                parsed.origin +
                parsed.pathname.replace(/\/+$/, '')
            );

        } catch {

            return '';
        }
    }


    // =========================================================
    // GET AUTHOR ELEMENT
    //
    // Only searches inside the exact comment.
    // =========================================================

    function getAuthorElement(comment) {

        const selectors = [
            '.commentthread_author_link',
            '.commentthread_comment_author a',
            'a.commentthread_author_link'
        ];


        for (const selector of selectors) {

            const element =
                comment.querySelector(
                    selector
                );


            if (
                element &&
                element.href
            ) {
                return element;
            }
        }


        return null;
    }


    // =========================================================
    // GET AUTHOR NAME
    // =========================================================

    function getCommentAuthor(comment) {

        const author =
            getAuthorElement(
                comment
            );


        if (!author) {
            return 'Unknown User';
        }


        return (
            author.textContent.trim() ||
            'Unknown User'
        );
    }


    // =========================================================
    // GET PROFILE URL
    // =========================================================

    function getCommentProfileURL(comment) {

        const author =
            getAuthorElement(
                comment
            );


        if (!author) {
            return '';
        }


        return normalizeProfileURL(
            author.href
        );
    }


    // =========================================================
    // IMAGE SOURCE
    // =========================================================

    function getImageSource(img) {

        if (!img) {
            return '';
        }


        let src =
            img.getAttribute('src') ||
            img.getAttribute('data-src') ||
            img.src ||
            '';


        if (src) {

            try {

                return new URL(
                    src,
                    location.origin
                ).href;

            } catch {

                return src;
            }
        }


        const srcset =
            img.getAttribute(
                'srcset'
            );


        if (srcset) {

            const first =
                srcset
                    .split(',')[0]
                    .trim()
                    .split(/\s+/)[0];


            if (first) {

                try {

                    return new URL(
                        first,
                        location.origin
                    ).href;

                } catch {

                    return first;
                }
            }
        }


        return '';
    }


    // =========================================================
    // DETECT AVATAR DECORATIONS
    // =========================================================

    function isDecoration(src) {

        const lower =
            String(src || '')
                .toLowerCase();


        return (
            lower.includes('avatarframe') ||
            lower.includes('avatar_frame') ||
            lower.includes('/avatarframes/') ||
            lower.includes('/frames/') ||
            lower.includes('profilemodifier') ||
            lower.includes('profile_modifier')
        );
    }


    // =========================================================
    // FIND AVATAR FROM COMMENT
    // =========================================================

    function findCommentAvatar(comment) {

        const container =
            comment.querySelector(
                '.commentthread_comment_avatar'
            );


        if (!container) {
            return '';
        }


        const images =
            Array.from(
                container.querySelectorAll(
                    'img'
                )
            );


        // First choice: Steam avatar CDN
        for (const img of images) {

            const src =
                getImageSource(
                    img
                );


            if (
                src.includes(
                    'avatars.akamai.steamstatic.com'
                )
            ) {

                return src;
            }
        }


        // Second choice: anything that isn't obviously
        // an avatar frame/decorator.
        for (const img of images) {

            const src =
                getImageSource(
                    img
                );


            if (
                src &&
                !isDecoration(src)
            ) {

                return src;
            }
        }


        return '';
    }


    // =========================================================
    // TIMESTAMP
    // =========================================================

    function getCommentTimestamp(comment) {

        const visibleSelectors = [
            '.commentthread_comment_timestamp',
            '.commentthread_comment_date'
        ];


        for (
            const selector of
            visibleSelectors
        ) {

            const element =
                comment.querySelector(
                    selector
                );


            if (element) {

                const text =
                    element.textContent
                        .trim();


                if (text) {
                    return text;
                }
            }
        }


        const timestampElements =
            comment.querySelectorAll(
                '[data-timestamp], [data-time], [data-rtime]'
            );


        for (
            const element of
            timestampElements
        ) {

            const value =
                element.getAttribute(
                    'data-timestamp'
                ) ||

                element.getAttribute(
                    'data-time'
                ) ||

                element.getAttribute(
                    'data-rtime'
                );


            if (
                !value ||
                !/^\d+$/.test(value)
            ) {
                continue;
            }


            const number =
                Number(value);


            const milliseconds =
                number < 100000000000
                    ? number * 1000
                    : number;


            const date =
                new Date(
                    milliseconds
                );


            if (
                !Number.isNaN(
                    date.getTime()
                )
            ) {

                return date.toLocaleString();
            }
        }


        return '';
    }


    // =========================================================
    // EXTRACT COMMENT
    // =========================================================

    function extractComment(comment) {

        const textElement =
            comment.querySelector(
                '.commentthread_comment_text'
            );


        if (!textElement) {
            return null;
        }


        const text =
            textElement.textContent
                .trim();


        if (!text) {
            return null;
        }


        const author =
            getCommentAuthor(
                comment
            );


        const profile =
            getCommentProfileURL(
                comment
            );


        const avatar =
            findCommentAvatar(
                comment
            );


        const time =
            getCommentTimestamp(
                comment
            );


        return {

            text,

            author,

            profile,

            avatar,

            time,

            verifiedProfile:
                Boolean(profile)
        };
    }


    // =========================================================
    // GET AVATAR FROM EXACT VERIFIED PROFILE
    //
    // This is ONLY allowed to improve the avatar.
    //
    // It NEVER changes:
    // - username
    // - profile association
    // - comment
    // - timestamp
    // =========================================================

    async function fetchVerifiedAvatar(profileURL) {

        profileURL =
            normalizeProfileURL(
                profileURL
            );


        if (!profileURL) {
            return '';
        }


        if (
            avatarCache.has(
                profileURL
            )
        ) {

            return avatarCache.get(
                profileURL
            );
        }


        try {

            const response =
                await fetch(
                    profileURL,
                    {
                        credentials:
                            'include'
                    }
                );


            if (!response.ok) {

                avatarCache.set(
                    profileURL,
                    ''
                );

                return '';
            }


            const html =
                await response.text();


            const doc =
                new DOMParser()
                    .parseFromString(
                        html,
                        'text/html'
                    );


            let avatar = '';


            // =================================================
            // PROFILE AVATAR SELECTORS
            // =================================================

            const selectors = [

                '.playerAvatarAutoSizeInner img',

                '.playerAvatar.profile_header_size img',

                '.profile_header .playerAvatar img',

                '.profile_header_centered_persona .playerAvatar img'
            ];


            for (const selector of selectors) {

                const images =
                    doc.querySelectorAll(
                        selector
                    );


                for (const img of images) {

                    const src =
                        getImageSource(
                            img
                        );


                    if (
                        src &&
                        !isDecoration(src)
                    ) {

                        avatar = src;
                        break;
                    }
                }


                if (avatar) {
                    break;
                }
            }


            // =================================================
            // AVATAR CDN FALLBACK
            // =================================================

            if (!avatar) {

                const images =
                    doc.querySelectorAll(
                        'img'
                    );


                for (const img of images) {

                    const src =
                        getImageSource(
                            img
                        );


                    if (
                        src.includes(
                            'avatars.akamai.steamstatic.com'
                        )
                    ) {

                        avatar = src;
                        break;
                    }
                }
            }


            // =================================================
            // OG IMAGE FALLBACK
            //
            // Steam profile pages may expose the avatar in
            // metadata even when the visible avatar structure
            // is unusual.
            // =================================================

            if (!avatar) {

                const ogImage =
                    doc.querySelector(
                        'meta[property="og:image"]'
                    );


                const src =
                    ogImage?.getAttribute(
                        'content'
                    ) || '';


                if (
                    src &&
                    !isDecoration(src)
                ) {

                    avatar = src;
                }
            }


            avatarCache.set(
                profileURL,
                avatar
            );


            return avatar;

        } catch (error) {

            console.warn(
                '[REP Scanner] Avatar lookup failed:',
                profileURL,
                error
            );


            avatarCache.set(
                profileURL,
                ''
            );


            return '';
        }
    }


    // =========================================================
    // RESOLVE AVATARS
    // =========================================================

    async function resolveAvatars(comments) {

        const groups =
            new Map();


        // Group comments by their exact verified profile URL.
        for (const comment of comments) {

            if (
                !comment.verifiedProfile ||
                !comment.profile
            ) {
                continue;
            }


            if (
                !groups.has(
                    comment.profile
                )
            ) {

                groups.set(
                    comment.profile,
                    []
                );
            }


            groups.get(
                comment.profile
            ).push(
                comment
            );
        }


        let current = 0;


        for (
            const [profile, userComments]
            of groups
        ) {

            current++;


            statusElement.textContent =
                `Loading avatars... ${current}/${groups.size}`;


            const avatar =
                await fetchVerifiedAvatar(
                    profile
                );


            if (avatar) {

                for (
                    const comment of
                    userComments
                ) {

                    // ONLY update avatar.
                    comment.avatar =
                        avatar;
                }
            }


            await sleep(
                AVATAR_LOOKUP_DELAY
            );
        }
    }


    // =========================================================
    // SCAN
    // =========================================================

    button.addEventListener(
        'click',
        async function () {

            positiveComments = [];
            negativeComments = [];


            totalElement.textContent =
                '0';

            positiveElement.textContent =
                '0';

            negativeElement.textContent =
                '0';


            viewPositive.style.display =
                'none';

            viewNegative.style.display =
                'none';


            button.disabled =
                true;

            button.style.opacity =
                '.6';

            button.textContent =
                'Scanning...';


            statusElement.textContent =
                'Finding profile...';


            try {

                const targetSteamID =
                    getTargetSteamID();


                if (!targetSteamID) {

                    throw new Error(
                        'Could not determine profile SteamID.'
                    );
                }


                let total =
                    0;

                let positive =
                    0;

                let negative =
                    0;

                let start =
                    0;

                let totalCount =
                    null;


                // =================================================
                // DOWNLOAD COMMENT PAGES
                // =================================================

                while (true) {

                    statusElement.textContent =
                        `Scanning... ${total} comments checked`;


                    const url =
                        'https://steamcommunity.com/comment/' +
                        'Profile/render/' +
                        targetSteamID +
                        '/-1/' +
                        '?start=' +
                        start +
                        '&count=' +
                        COMMENTS_PER_REQUEST;


                    const response =
                        await fetch(
                            url,
                            {
                                credentials:
                                    'include'
                            }
                        );


                    if (!response.ok) {

                        throw new Error(
                            'Steam returned HTTP ' +
                            response.status
                        );
                    }


                    const data =
                        await response.json();


                    if (
                        totalCount === null &&
                        typeof data.total_count ===
                        'number'
                    ) {

                        totalCount =
                            data.total_count;
                    }


                    if (
                        !data.comments_html
                    ) {

                        break;
                    }


                    const doc =
                        new DOMParser()
                            .parseFromString(
                                data.comments_html,
                                'text/html'
                            );


                    const comments =
                        doc.querySelectorAll(
                            '.commentthread_comment'
                        );


                    if (
                        comments.length === 0
                    ) {

                        break;
                    }


                    // =================================================
                    // ANALYZE COMMENTS
                    // =================================================

                    comments.forEach(
                        commentElement => {

                            const info =
                                extractComment(
                                    commentElement
                                );


                            if (!info) {
                                return;
                            }


                            total++;


                            // +REP
                            if (
                                /\+\s*rep\b/i.test(
                                    info.text
                                )
                            ) {

                                positive++;

                                positiveComments.push(
                                    info
                                );
                            }


                            // -REP
                            if (
                                /-\s*rep\b/i.test(
                                    info.text
                                )
                            ) {

                                negative++;

                                negativeComments.push(
                                    info
                                );
                            }
                        }
                    );


                    // Update counters
                    totalElement.textContent =
                        total;

                    positiveElement.textContent =
                        positive;

                    negativeElement.textContent =
                        negative;


                    start +=
                        comments.length;


                    // =================================================
                    // FINISHED?
                    // =================================================

                    if (
                        totalCount !== null &&
                        start >= totalCount
                    ) {

                        break;
                    }


                    if (
                        comments.length <
                        COMMENTS_PER_REQUEST
                    ) {

                        break;
                    }


                    await sleep(
                        REQUEST_DELAY
                    );
                }


                // =================================================
                // SAFELY IMPROVE AVATARS
                // =================================================

                const matchingComments = [

                    ...positiveComments,
                    ...negativeComments

                ];


                if (
                    matchingComments.length > 0
                ) {

                    await resolveAvatars(
                        matchingComments
                    );
                }


                // =================================================
                // DONE
                // =================================================

                totalElement.textContent =
                    total;

                positiveElement.textContent =
                    positive;

                negativeElement.textContent =
                    negative;


                if (
                    positive > 0
                ) {

                    viewPositive.style.display =
                        'inline-block';
                }


                if (
                    negative > 0
                ) {

                    viewNegative.style.display =
                        'inline-block';
                }


                statusElement.textContent =
                    'Scan complete.';

            } catch (error) {

                console.error(
                    '[REP Scanner]',
                    error
                );


                statusElement.textContent =
                    'Scan failed: ' +
                    error.message;
            }


            button.disabled =
                false;

            button.style.opacity =
                '1';

            button.textContent =
                'Scan Again';
        }
    );


    // =========================================================
    // VIEW BUTTONS
    // =========================================================

    viewPositive.addEventListener(
        'click',
        function () {

            openResultsPage(
                '+REP Comments',
                positiveComments,
                '#66c0f4'
            );
        }
    );


    viewNegative.addEventListener(
        'click',
        function () {

            openResultsPage(
                '-REP Comments',
                negativeComments,
                '#ff6b6b'
            );
        }
    );


    // =========================================================
    // RESULTS PAGE
    // =========================================================

    function openResultsPage(
        title,
        comments,
        accentColor
    ) {

        const newWindow =
            window.open(
                '',
                '_blank'
            );

        if (newWindow) newWindow.name = 'steam-toolkit-result';


        if (!newWindow) {

            alert(
                'Allow popups for steamcommunity.com to view results.'
            );

            return;
        }


        const profileName =
            document.querySelector(
                '.actual_persona_name'
            )?.textContent.trim() ||
            document.title;


        // =====================================================
        // BUILD CARDS
        // =====================================================

        const cards =
            comments.map(
                (comment, index) => {

                    const profileURL =
                        comment.verifiedProfile
                            ? comment.profile
                            : '';


                    // =========================================
                    // AVATAR
                    // =========================================

                    let avatarContent;


                    if (comment.avatar) {

                        avatarContent = `

                            <img
                                class="avatar"
                                src="${escapeHTML(comment.avatar)}"
                                loading="lazy"

                                onerror="
                                    this.style.display='none';
                                    this.parentElement.classList.add('show-fallback');
                                "
                            >

                            <div class="fallback-avatar">
                                ?
                            </div>
                        `;

                    } else {

                        avatarContent = `

                            <div class="fallback-avatar visible">
                                ?
                            </div>
                        `;
                    }


                    let avatarHTML;


                    if (profileURL) {

                        avatarHTML = `

                            <a
                                href="${escapeHTML(profileURL)}"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="avatar-wrapper"
                                title="Open Steam profile"
                            >
                                ${avatarContent}
                            </a>
                        `;

                    } else {

                        avatarHTML = `

                            <div class="avatar-wrapper">
                                ${avatarContent}
                            </div>
                        `;
                    }


                    // =========================================
                    // AUTHOR
                    // =========================================

                    let authorHTML;


                    if (profileURL) {

                        authorHTML = `

                            <a
                                href="${escapeHTML(profileURL)}"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="author"
                            >
                                ${escapeHTML(comment.author)}
                            </a>
                        `;

                    } else {

                        authorHTML = `

                            <span class="author">
                                ${escapeHTML(comment.author)}
                            </span>
                        `;
                    }


                    // =========================================
                    // TIMESTAMP
                    // =========================================

                    const timestampHTML =
                        comment.time

                        ? `
                            <span class="timestamp">
                                ${escapeHTML(comment.time)}
                            </span>
                          `

                        : `
                            <span class="
                                timestamp
                                timestamp-missing
                            ">
                                Timestamp unavailable
                            </span>
                          `;


                    return `

                        <div class="comment">

                            ${avatarHTML}

                            <div class="content">

                                <div class="top">

                                    ${authorHTML}

                                    ${timestampHTML}

                                </div>

                                <div class="text">
                                    ${escapeHTML(comment.text)}
                                </div>

                            </div>

                            <div class="number">
                                #${index + 1}
                            </div>

                        </div>
                    `;
                }
            )
            .join('');


        // =====================================================
        // WRITE PAGE
        // =====================================================

        newWindow.document.open();


        newWindow.document.write(`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">
<meta name="steam-toolkit-result" content="rep-scanner">

<title>
    ${escapeHTML(title)}
</title>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    background: #1b2838;

    color: #d6d7d8;

    font-family:
        Arial,
        sans-serif;
}


/* =========================================================
   HEADER
   ========================================================= */

.header {

    background: #171d25;

    border-bottom:
        1px solid #3d4450;

    padding: 25px;
}

.header-inner {

    max-width: 900px;

    margin: auto;
}

h1 {

    margin:
        0 0 8px 0;

    color:
        ${accentColor};

    font-size:
        28px;
}

.profile-name {

    color:
        #8f98a0;

    font-size:
        14px;
}

.summary {

    margin-top:
        12px;

    color:
        white;

    font-size:
        16px;
}


/* =========================================================
   RESULTS
   ========================================================= */

.container {

    max-width:
        900px;

    margin:
        25px auto;

    padding:
        0 15px;
}

.comment {

    position:
        relative;

    display:
        flex;

    align-items:
        flex-start;

    gap:
        12px;

    min-height:
        100px;

    background:
        #16202d;

    border:
        1px solid #2a475e;

    border-left:
        4px solid ${accentColor};

    padding:
        15px;

    margin-bottom:
        10px;

    border-radius:
        4px;
}


/* =========================================================
   AVATAR
   ========================================================= */

.avatar-wrapper {

    position:
        relative;

    display:
        block;

    width:
        48px;

    height:
        48px;

    flex-shrink:
        0;

    background:
        #101822;

    border:
        2px solid #3d4450;

    border-radius:
        3px;

    overflow:
        hidden;

    text-decoration:
        none;
}

.avatar {

    position:
        absolute;

    inset:
        0;

    width:
        100%;

    height:
        100%;

    display:
        block;

    object-fit:
        cover;

    z-index:
        2;
}


/* =========================================================
   FALLBACK ? AVATAR
   ========================================================= */

.fallback-avatar {

    position:
        absolute;

    inset:
        0;

    display:
        none;

    align-items:
        center;

    justify-content:
        center;

    background:
        linear-gradient(
            135deg,
            #29384a,
            #182331
        );

    color:
        #8f98a0;

    font-size:
        28px;

    font-weight:
        bold;

    line-height:
        1;

    user-select:
        none;

    z-index:
        1;
}


/* No avatar existed at all */

.fallback-avatar.visible {

    display:
        flex;
}


/* Existing avatar failed to load */

.avatar-wrapper.show-fallback
.fallback-avatar {

    display:
        flex;
}


/* =========================================================
   CONTENT
   ========================================================= */

.content {

    flex:
        1;

    min-width:
        0;
}

.top {

    display:
        flex;

    align-items:
        center;

    flex-wrap:
        wrap;

    gap:
        8px;

    margin-bottom:
        12px;
}

.author {

    color:
        #66c0f4;

    font-weight:
        bold;

    text-decoration:
        none;
}

a.author:hover {

    color:
        white;

    text-decoration:
        underline;
}


/* =========================================================
   TIMESTAMP
   ========================================================= */

.timestamp {

    color:
        #8f98a0;

    font-size:
        12px;
}

.timestamp::before {

    content:
        "•";

    margin-right:
        8px;

    color:
        #536170;
}

.timestamp-missing {

    opacity:
        .5;

    font-style:
        italic;
}


/* =========================================================
   COMMENT TEXT
   ========================================================= */

.text {

    color:
        #d6d7d8;

    line-height:
        1.5;

    white-space:
        pre-wrap;

    word-break:
        break-word;

    padding-right:
        25px;
}


/* =========================================================
   RESULT NUMBER
   ========================================================= */

.number {

    position:
        absolute;

    right:
        10px;

    bottom:
        7px;

    color:
        #536170;

    font-size:
        11px;
}


/* Steam Toolkit v0.6 shared retro skin */
body{background:radial-gradient(circle at 50% -20%,#123040 0,#08151b 36%,#050c10 85%)!important;color:#c7d5e0!important;font-family:Consolas,"Lucida Console",monospace!important}body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483646;background:repeating-linear-gradient(0deg,rgba(255,255,255,.015) 0,rgba(255,255,255,.015) 1px,transparent 1px,transparent 4px)}header,.header{background:linear-gradient(110deg,#071218,#0d2631)!important;border-bottom:1px solid #286377!important}h1,h2{font-family:Consolas,monospace!important;text-shadow:0 0 10px rgba(102,192,244,.2)}button,input{font-family:Consolas,monospace!important;border-radius:2px!important}.toolbar{background:#071218!important;border-bottom:1px solid #183f4b!important}.group,.comment{background:linear-gradient(100deg,#09171d,#0b1c23)!important;border:1px solid #123541!important;border-left:3px solid #1d5666!important;border-radius:2px!important;transition:.15s ease!important}.group:hover,.comment:hover{background:#0d2530!important;border-left-color:#76ff9f!important;transform:translateX(3px)}a{color:#66c0f4}.join-status.success{color:#76ff9f!important}.join-status.processing{color:#66c0f4!important}.join-status.failure{color:#ff7373!important}.avatar-placeholder,.fallback-avatar{background:#050d11!important;color:#76ff9f!important}
</style>

</head>


<body>


<div class="header">

    <div class="header-inner">

        <h1>
            ${escapeHTML(title)}
        </h1>

        <div class="profile-name">
            Profile:
            ${escapeHTML(profileName)}
        </div>

        <div class="summary">
            ${comments.length}
            matching comments
        </div>

    </div>

</div>


<div class="container">

    ${cards}

</div>


</body>

</html>
        `);


        newWindow.document.close();

        const removeInjectedToolkit = () =>
            newWindow.document.querySelectorAll('#scs-panel').forEach(el => el.remove());
        removeInjectedToolkit();
        new newWindow.MutationObserver(removeInjectedToolkit).observe(
            newWindow.document.documentElement,
            { childList: true, subtree: true }
        );
    }


    // =========================================================
    // ESCAPE HTML
    // =========================================================

    function escapeHTML(value) {

        return String(
            value || ''
        )
            .replaceAll(
                '&',
                '&amp;'
            )
            .replaceAll(
                '<',
                '&lt;'
            )
            .replaceAll(
                '>',
                '&gt;'
            )
            .replaceAll(
                '"',
                '&quot;'
            )
            .replaceAll(
                "'",
                '&#039;'
            );
    }


    // =========================================================
    // DELAY
    // =========================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

})();