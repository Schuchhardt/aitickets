import '@astrojs/internal-helpers/path';
import 'kleur/colors';
import 'html-escaper';
import 'clsx';
import { l as NOOP_MIDDLEWARE_HEADER, n as decodeKey } from './chunks/astro/server_CB9syzyE.mjs';
import 'cookie';
import 'es-module-lexer';

const NOOP_MIDDLEWARE_FN = async (_ctx, next) => {
  const response = await next();
  response.headers.set(NOOP_MIDDLEWARE_HEADER, "true");
  return response;
};

const codeToStatusMap = {
  // Implemented from tRPC error code table
  // https://trpc.io/docs/server/error-handling#error-codes
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 405,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500
};
Object.entries(codeToStatusMap).reduce(
  // reverse the key-value pairs
  (acc, [key, value]) => ({ ...acc, [value]: key }),
  {}
);

function sanitizeParams(params) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")];
      }
      return [key, value];
    })
  );
}
function getParameter(part, params) {
  if (part.spread) {
    return params[part.content.slice(3)] || "";
  }
  if (part.dynamic) {
    if (!params[part.content]) {
      throw new TypeError(`Missing parameter: ${part.content}`);
    }
    return params[part.content];
  }
  return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]");
}
function getSegment(segment, params) {
  const segmentPath = segment.map((part) => getParameter(part, params)).join("");
  return segmentPath ? "/" + segmentPath : "";
}
function getRouteGenerator(segments, addTrailingSlash) {
  return (params) => {
    const sanitizedParams = sanitizeParams(params);
    let trailing = "";
    if (addTrailingSlash === "always" && segments.length) {
      trailing = "/";
    }
    const path = segments.map((segment) => getSegment(segment, sanitizedParams)).join("") + trailing;
    return path || "/";
  };
}

function deserializeRouteData(rawRouteData) {
  return {
    route: rawRouteData.route,
    type: rawRouteData.type,
    pattern: new RegExp(rawRouteData.pattern),
    params: rawRouteData.params,
    component: rawRouteData.component,
    generate: getRouteGenerator(rawRouteData.segments, rawRouteData._meta.trailingSlash),
    pathname: rawRouteData.pathname || void 0,
    segments: rawRouteData.segments,
    prerender: rawRouteData.prerender,
    redirect: rawRouteData.redirect,
    redirectRoute: rawRouteData.redirectRoute ? deserializeRouteData(rawRouteData.redirectRoute) : void 0,
    fallbackRoutes: rawRouteData.fallbackRoutes.map((fallback) => {
      return deserializeRouteData(fallback);
    }),
    isIndex: rawRouteData.isIndex,
    origin: rawRouteData.origin
  };
}

function deserializeManifest(serializedManifest) {
  const routes = [];
  for (const serializedRoute of serializedManifest.routes) {
    routes.push({
      ...serializedRoute,
      routeData: deserializeRouteData(serializedRoute.routeData)
    });
    const route = serializedRoute;
    route.routeData = deserializeRouteData(serializedRoute.routeData);
  }
  const assets = new Set(serializedManifest.assets);
  const componentMetadata = new Map(serializedManifest.componentMetadata);
  const inlinedScripts = new Map(serializedManifest.inlinedScripts);
  const clientDirectives = new Map(serializedManifest.clientDirectives);
  const serverIslandNameMap = new Map(serializedManifest.serverIslandNameMap);
  const key = decodeKey(serializedManifest.key);
  return {
    // in case user middleware exists, this no-op middleware will be reassigned (see plugin-ssr.ts)
    middleware() {
      return { onRequest: NOOP_MIDDLEWARE_FN };
    },
    ...serializedManifest,
    assets,
    componentMetadata,
    inlinedScripts,
    clientDirectives,
    routes,
    serverIslandNameMap,
    key
  };
}

const manifest = deserializeManifest({"hrefRoot":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/","cacheDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/node_modules/.astro/","outDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/dist/","srcDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/src/","publicDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/public/","buildClientDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/dist/","buildServerDir":"file:///Users/sebastianschuchhardt/Documents/Code/aitickets/.netlify/build/","adapterName":"@astrojs/netlify","routes":[{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"page","component":"_server-islands.astro","params":["name"],"segments":[[{"content":"_server-islands","dynamic":false,"spread":false}],[{"content":"name","dynamic":true,"spread":false}]],"pattern":"^\\/_server-islands\\/([^/]+?)\\/?$","prerender":false,"isIndex":false,"fallbackRoutes":[],"route":"/_server-islands/[name]","origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[],"routeData":{"type":"endpoint","isIndex":false,"route":"/_image","pattern":"^\\/_image\\/?$","segments":[[{"content":"_image","dynamic":false,"spread":false}]],"params":[],"component":"node_modules/astro/dist/assets/endpoint/generic.js","pathname":"/_image","prerender":false,"fallbackRoutes":[],"origin":"internal","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/e-_slug_.Cmh1EOYt.css"}],"routeData":{"route":"/404","isIndex":false,"type":"page","pattern":"^\\/404\\/?$","segments":[[{"content":"404","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/404.astro","pathname":"/404","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/e-_slug_.Cmh1EOYt.css"}],"routeData":{"route":"/privacy","isIndex":false,"type":"page","pattern":"^\\/privacy\\/?$","segments":[[{"content":"privacy","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/privacy.astro","pathname":"/privacy","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/e-_slug_.Cmh1EOYt.css"}],"routeData":{"route":"/terms","isIndex":false,"type":"page","pattern":"^\\/terms\\/?$","segments":[[{"content":"terms","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/terms.astro","pathname":"/terms","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/e-_slug_.Cmh1EOYt.css"}],"routeData":{"route":"/e-[slug]","isIndex":false,"type":"page","pattern":"^\\/e-([^/]+?)\\/?$","segments":[[{"content":"e-","dynamic":false,"spread":false},{"content":"slug","dynamic":true,"spread":false}]],"params":["slug"],"component":"src/pages/e-[slug].astro","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"external","src":"/_astro/e-_slug_.Cmh1EOYt.css"},{"type":"inline","content":".blur-background[data-v-1e1733f6]{filter:blur(10px);position:absolute;width:100%;height:100%}.event-grid[data-v-a7c63479]{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;padding:20px}\n"}],"routeData":{"route":"/","isIndex":true,"type":"page","pattern":"^\\/$","segments":[],"params":[],"component":"src/pages/index.astro","pathname":"/","prerender":false,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}}],"base":"/","trailingSlash":"ignore","compressHTML":true,"componentMetadata":[["/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/404.astro",{"propagation":"none","containsHead":true}],["/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/e-[slug].astro",{"propagation":"none","containsHead":true}],["/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/index.astro",{"propagation":"none","containsHead":true}],["/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/privacy.astro",{"propagation":"none","containsHead":true}],["/Users/sebastianschuchhardt/Documents/Code/aitickets/src/pages/terms.astro",{"propagation":"none","containsHead":true}]],"renderers":[],"clientDirectives":[["idle","(()=>{var l=(n,t)=>{let i=async()=>{await(await n())()},e=typeof t.value==\"object\"?t.value:void 0,s={timeout:e==null?void 0:e.timeout};\"requestIdleCallback\"in window?window.requestIdleCallback(i,s):setTimeout(i,s.timeout||200)};(self.Astro||(self.Astro={})).idle=l;window.dispatchEvent(new Event(\"astro:idle\"));})();"],["load","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).load=e;window.dispatchEvent(new Event(\"astro:load\"));})();"],["media","(()=>{var n=(a,t)=>{let i=async()=>{await(await a())()};if(t.value){let e=matchMedia(t.value);e.matches?i():e.addEventListener(\"change\",i,{once:!0})}};(self.Astro||(self.Astro={})).media=n;window.dispatchEvent(new Event(\"astro:media\"));})();"],["only","(()=>{var e=async t=>{await(await t())()};(self.Astro||(self.Astro={})).only=e;window.dispatchEvent(new Event(\"astro:only\"));})();"],["visible","(()=>{var a=(s,i,o)=>{let r=async()=>{await(await s())()},t=typeof i.value==\"object\"?i.value:void 0,c={rootMargin:t==null?void 0:t.rootMargin},n=new IntersectionObserver(e=>{for(let l of e)if(l.isIntersecting){n.disconnect(),r();break}},c);for(let e of o.children)n.observe(e)};(self.Astro||(self.Astro={})).visible=a;window.dispatchEvent(new Event(\"astro:visible\"));})();"]],"entryModules":{"\u0000noop-middleware":"_noop-middleware.mjs","\u0000@astro-page:src/pages/404@_@astro":"pages/404.astro.mjs","\u0000@astro-page:src/pages/privacy@_@astro":"pages/privacy.astro.mjs","\u0000@astro-page:src/pages/terms@_@astro":"pages/terms.astro.mjs","\u0000@astro-page:src/pages/e-[slug]@_@astro":"pages/e-_slug_.astro.mjs","\u0000@astro-page:src/pages/index@_@astro":"pages/index.astro.mjs","\u0000@astrojs-ssr-virtual-entry":"entry.mjs","\u0000@astro-renderers":"renderers.mjs","\u0000@astro-page:node_modules/astro/dist/assets/endpoint/generic@_@js":"pages/_image.astro.mjs","\u0000@astrojs-ssr-adapter":"_@astrojs-ssr-adapter.mjs","\u0000@astrojs-manifest":"manifest_CMNr2zUJ.mjs","/Users/sebastianschuchhardt/Documents/Code/aitickets/node_modules/astro/dist/assets/services/sharp.js":"chunks/sharp_Le0AEuGi.mjs","/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/EventDetail.vue":"_astro/EventDetail.BBSst-z-.js","/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/EventList.vue":"_astro/EventList.B4D4XONi.js","/Users/sebastianschuchhardt/Documents/Code/aitickets/src/components/AppFooter.vue":"_astro/AppFooter.BXg9NL1S.js","@astrojs/vue/client.js":"_astro/client.BGBmGOTZ.js","astro:scripts/before-hydration.js":""},"inlinedScripts":[],"assets":["/_astro/icon-arrow-green.anh70UTw.png","/_astro/icon-facebook.BhU4-XTv.png","/_astro/icon-linkedin.CeUn6Acf.png","/_astro/logo.DGoce3p0.png","/_astro/summit.DiEtm8JE.jpg","/_astro/unbounded-cyrillic-400-normal.2GwyjskV.woff2","/_astro/unbounded-latin-ext-400-normal.Bt9eW0j5.woff2","/_astro/unbounded-latin-400-normal.C8Alrmf5.woff2","/_astro/prompt-thai-400-normal.DLYauRM_.woff2","/_astro/prompt-vietnamese-400-normal.C0M0cfbS.woff2","/_astro/unbounded-vietnamese-400-normal.D7u77xXC.woff2","/_astro/prompt-latin-ext-400-normal.B87LmIfq.woff2","/_astro/prompt-latin-400-normal.CyXKtQGK.woff2","/_astro/icon-calendar-dark.CIERjYjX.png","/_astro/icon-pin-dark.jp5q-vbA.png","/_astro/icon-pin-light.BX8DvhYB.png","/_astro/icon-calendar-light.B0rRWg9Y.png","/_astro/icon-arrow-black.BVt6gO27.png","/_astro/icon-share.BQ2neyRA.png","/_astro/icon-tickets.DpRNYEFj.png","/_astro/unbounded-cyrillic-400-normal.rALq597v.woff","/_astro/unbounded-latin-400-normal.BGx2sYOz.woff","/_astro/unbounded-latin-ext-400-normal.D7MWojQw.woff","/_astro/prompt-vietnamese-400-normal.BPfgjBFK.woff","/_astro/unbounded-vietnamese-400-normal.CyNLgijQ.woff","/_astro/prompt-thai-400-normal.BfcZV_lT.woff","/_astro/prompt-latin-ext-400-normal.GMJklDwX.woff","/_astro/prompt-latin-400-normal.CbIUKyyc.woff","/_astro/e-_slug_.Cmh1EOYt.css","/android-chrome-192x192.png","/android-chrome-512x512.png","/apple-touch-icon.png","/favicon-16x16.png","/favicon-32x32.png","/favicon.ico","/logo-dark.png","/logo-light.png","/logo.png","/robots.txt","/site.webmanifest","/_astro/AppFooter.BXg9NL1S.js","/_astro/EventDetail.BBSst-z-.js","/_astro/EventList.B4D4XONi.js","/_astro/_plugin-vue_export-helper.DlAUqK2U.js","/_astro/client.BGBmGOTZ.js","/_astro/e-_slug_.CZw3Zzgp.css","/_astro/icon-pin-dark.Bj6ZMfId.js","/_astro/index.D0lYUxof.css","/_astro/runtime-core.esm-bundler.5WBOP5BV.js","/_astro/runtime-dom.esm-bundler.CFpN4rq-.js"],"buildFormat":"directory","checkOrigin":true,"serverIslandNameMap":[],"key":"/iUZ8B9E7Bx2FkPIZiKLrZK8eCRkhWSt+3IaG7QvOAo="});
if (manifest.sessionConfig) manifest.sessionConfig.driverModule = null;

export { manifest };
