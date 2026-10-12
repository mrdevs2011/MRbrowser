'use strict';
/**
 * Ad / tracker filter lists and matching helpers.
 * @module shared/shields
 */
// Brave-uslubidagi himoya: reklama/trekker bloklash, HTTPS'ga avtomatik o'tkazish, Sec-GPC.
const BLOCK = new Set(`
doubleclick.net googlesyndication.com googleadservices.com adservice.google.com adnxs.com adsrvr.org adform.net
criteo.com criteo.net taboola.com taboolasyndication.com outbrain.com outbrainimg.com revcontent.com mgid.com zedo.com
amazon-adsystem.com rubiconproject.com pubmatic.com openx.net casalemedia.com indexww.com smartadserver.com 33across.com
sharethrough.com teads.tv adcolony.com applovin.com moatads.com adsafeprotected.com doubleverify.com serving-sys.com
bidswitch.net contextweb.com advertising.com adtechus.com yieldmo.com lijit.com sovrn.com media.net bidr.io tapad.com
rlcdn.com mathtag.com demdex.net krxd.net bluekai.com exelator.com agkn.com everesttech.net adition.com 2mdn.net
adsymptotic.com gumgum.com triplelift.com 3lift.com onetag-sys.com popads.net popcash.net propellerads.com exoclick.com
juicyads.com trafficjunky.net adsterra.com hilltopads.net clickadu.com adroll.com rtbhouse.com pippio.com liadm.com
id5-sync.com ads.yahoo.com analytics.yahoo.com imrworldwide.com addthis.com sharethis.com disqusads.com
google-analytics.com analytics.google.com scorecardresearch.com quantserve.com quantcount.com chartbeat.com chartbeat.net
hotjar.com hotjar.io fullstory.com mouseflow.com crazyegg.com luckyorange.com inspectlet.com clarity.ms bat.bing.com
mixpanel.com api.segment.io amplitude.com heapanalytics.com
ads.twitter.com analytics.twitter.com static.ads-twitter.com ads.linkedin.com px.ads.linkedin.com snap.licdn.com
ads.tiktok.com analytics.tiktok.com ads.pinterest.com ct.pinterest.com log.pinterest.com sc-static.net tr.snapchat.com
alb.reddit.com events.redditmedia.com
mc.yandex.ru mc.yandex.com an.yandex.ru adfox.ru awaps.yandex.net yandexadexchange.net top-fwz1.mail.ru counter.yadro.ru
tns-counter.ru
`.split(/\s+/).filter(Boolean));

const hostBlocked = (h) => {
  while (h) {
    if (BLOCK.has(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
  return false;
};
const baseDomain = (h) => h.split('.').slice(-2).join('.');

function setup(ses, d) {
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  ses.webRequest.onBeforeRequest(filter, (r, cb) => {
    try {
      const s = d.settings();
      const u = new URL(r.url);
      const wc = r.webContents;
      if (r.resourceType === 'mainFrame') {
        if (u.protocol === 'http:' && s.httpsUpgrade && s.shields && !d.isLocal(u.hostname)
            && !d.noUpgrade(u.hostname) && !s.shieldsOff.includes(u.hostname)) {
          const to = 'https:' + r.url.slice(5);
          d.onUpgrade(to, r.url);
          return cb({ redirectURL: to });
        }
        return cb({});
      }
      if (!s.shields) return cb({});
      let top = '';
      try { top = wc ? new URL(wc.getURL()).hostname : ''; } catch {}
      if (top && s.shieldsOff.includes(top)) return cb({});
      if (hostBlocked(u.hostname) && (!top || baseDomain(top) !== baseDomain(u.hostname))) {
        d.onBlocked(wc, u.hostname);
        return cb({ cancel: true });
      }
    } catch {}
    cb({});
  });
  ses.webRequest.onBeforeSendHeaders(filter, (r, cb) => {
    const h = r.requestHeaders || {};
    try {
      if (d.chromeUA) {
        h['User-Agent'] = d.chromeUA || h['User-Agent'];
      }
      // Client Hints — faqat Google/login uchun majburiy brend
      let host = '';
      try { host = new URL(r.url).hostname; } catch {}
      const isGoogle = /(^|\.)google\.com$|(^|\.)googleapis\.com$|(^|\.)gstatic\.com$|(^|\.)youtube\.com$|(^|\.)googleusercontent\.com$/.test(host);
      if (typeof d.secChUa === 'function' && isGoogle) {
        const ch = d.secChUa();
        const full = (typeof d.secChUaFull === 'function' ? d.secChUaFull() : ch);
        h['sec-ch-ua'] = ch;
        h['sec-ch-ua-mobile'] = '?0';
        h['sec-ch-ua-platform'] = '"Linux"';
        h['sec-ch-ua-full-version-list'] = full;
        h['sec-ch-ua-platform-version'] = '"6.8.0"';
        h['sec-ch-ua-arch'] = '"x86"';
        h['sec-ch-ua-bitness'] = '"64"';
        h['sec-ch-ua-model'] = '""';
        h['sec-ch-ua-wow64'] = '?0';
      }
      if (!h['Accept-Language']) h['Accept-Language'] = 'en-US,en;q=0.9';
      // Sec-GPC Google login ni bezovta qilishi mumkin — auth domenlarida yubormaymiz
      if (d.settings().shields && !isGoogle) h['Sec-GPC'] = '1';
    } catch {}
    cb({ requestHeaders: h });
  });
}

module.exports = { setup, hostBlocked };
