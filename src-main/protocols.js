const path = require('path');
const zlib = require('zlib');
const nodeURL = require('url');
const {app, protocol, net} = require('electron');
const {getDist, getPlatform} = require('./platform');
const packageJSON = require('../package.json');
const {getExpandsRoots} = require('./neowarp-expands');

/**
 * @typedef Metadata
 * @property {string} root
 * @property {boolean} [standard] Defaults to false
 * @property {boolean} [supportFetch] Defaults to false
 * @property {boolean} [secure] Defaults to false
 * @property {boolean} [brotli] Defaults to false
 * @property {boolean} [embeddable] Defaults to false
 * @property {boolean} [stream] Defaults to false
 * @property {string} [directoryIndex] Defaults to none
 * @property {string} [defaultExtension] Defaults to n one
 * @property {string} [csp] Defaults to none
 */

/** @type {Record<string, Metadata>} */
const FILE_SCHEMES = {
  'tw-editor': {
    root: path.resolve(__dirname, '../dist-renderer-webpack/editor'),
    standard: true,
    supportFetch: true,
    secure: true,
    embeddable: true, // migration helper
  },
  'tw-desktop-settings': {
    root: path.resolve(__dirname, '../src-renderer/desktop-settings'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
  },
  'tw-privacy': {
    root: path.resolve(__dirname, '../src-renderer/privacy'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  },
  'tw-about': {
    root: path.resolve(__dirname, '../src-renderer/about'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  },
  'tw-home': {
    root: path.resolve(__dirname, '../src-renderer/home'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
  },
  'tw-contact': {
    root: path.resolve(__dirname, '../src-renderer/contact'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  },
  'tw-packager': {
    root: path.resolve(__dirname, '../src-renderer/packager'),
    standard: true,
    secure: true,
    embeddable: true, // migration helper
  },
  'tw-library': {
    root: path.resolve(__dirname, '../dist-library-files'),
    supportFetch: true,
    brotli: true,
    csp: "default-src 'none';"
  },
  'tw-extensions': {
    root: path.resolve(__dirname, '../dist-extensions'),
    supportFetch: true,
    brotli: true,
    embeddable: true,
    stream: true,
    directoryIndex: 'index.html',
    defaultExtension: '.html',
    csp: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  },
  'tw-update': {
    root: path.resolve(__dirname, '../src-renderer/update'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src https://desktop.turbowarp.org"
  },
  'tw-security-prompt': {
    root: path.resolve(__dirname, '../src-renderer/security-prompt'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
  },
  'tw-file-access': {
    root: path.resolve(__dirname, '../src-renderer/file-access'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  },
  'tw-detached-stage': {
    root: path.resolve(__dirname, '../src-renderer/detached-stage'),
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
  },
  'tw-ai-assistant': {
    root: path.resolve(__dirname, '../src-renderer/ai-assistant'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; connect-src * tw-ai-proxy:; img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net"
  },
  'tw-todo-list': {
    root: path.resolve(__dirname, '../src-renderer/todo-list'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
  },
  'tw-project-analysis': {
    root: path.resolve(__dirname, '../src-renderer/project-analysis'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self'; img-src 'self' data:"
  },
  'tw-task-manager': {
    root: path.resolve(__dirname, '../src-renderer/task-manager'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self'; img-src 'self' data:"
  },
  'tw-collaboration': {
    root: path.resolve(__dirname, '../src-renderer/collaboration'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:"
  },
  'tw-mobile-preview': {
    root: path.resolve(__dirname, '../src-renderer/mobile-preview'),
    standard: true,
    secure: true,
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"
  },
  'tw-extension-editor': {
    root: path.resolve(__dirname, '../src-renderer/extension-editor'),
    standard: true,
    supportFetch: true,
    secure: true,
    // Monaco 的脚本/字体/Worker 全部同源（页面内 vs/ 目录），仅样式需要内联；
    // connect-src 放开是为了直连自定义 AI 端点（tw-ai-proxy 不可用时回退）
    csp: "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; worker-src 'self' blob:; connect-src * tw-ai-proxy:"
  },
  // nw-expands 由 createExpandsProtocolHandler 处理（根目录运行时才确定），
  // 不走下面的静态 FILE_SCHEMES 流程
};

// NeoWarp 本地扩展目录协议：Expands/<扩展名>/<作者>/<简介>/*.js
// host 为根目录 id（app=主根目录，data=userData）。扩展代码由 VM fetch 加载、
// 图片由 <img> 加载，因此需要 supportFetchAPI；bypassCSP 免去编辑器 CSP 白名单。
const EXPANDS_SCHEME = 'nw-expands';

const MIME_TYPES = new Map();
MIME_TYPES.set('.html', 'text/html');
MIME_TYPES.set('.js', 'text/javascript');
MIME_TYPES.set('.css', 'text/css');
MIME_TYPES.set('.map', 'application/json');
MIME_TYPES.set('.txt', 'text/plain');
MIME_TYPES.set('.json', 'application/json');
MIME_TYPES.set('.wav', 'audio/wav');
MIME_TYPES.set('.svg', 'image/svg+xml');
MIME_TYPES.set('.png', 'image/png');
MIME_TYPES.set('.jpg', 'image/jpeg');
MIME_TYPES.set('.jpeg', 'image/jpeg');
MIME_TYPES.set('.webp', 'image/webp');
MIME_TYPES.set('.bmp', 'image/bmp');
MIME_TYPES.set('.avif', 'image/avif');
MIME_TYPES.set('.gif', 'image/gif');
MIME_TYPES.set('.cur', 'image/x-icon');
MIME_TYPES.set('.ico', 'image/x-icon');
MIME_TYPES.set('.mp3', 'audio/mpeg');
MIME_TYPES.set('.mp4', 'video/mp4');
MIME_TYPES.set('.wav', 'audio/wav');
MIME_TYPES.set('.ogg', 'audio/ogg');
MIME_TYPES.set('.ttf', 'font/ttf');
MIME_TYPES.set('.otf', 'font/otf');
MIME_TYPES.set('.woff', 'font/woff');
MIME_TYPES.set('.woff2', 'font/woff2');
MIME_TYPES.set('.hex', 'application/octet-stream');
MIME_TYPES.set('.zip', 'application/zip');
MIME_TYPES.set('.xml', 'text/xml');
MIME_TYPES.set('.md', 'text/markdown');

// AI 请求转发协议：自定义 API 端点普遍不返回 CORS 头，页面直接 fetch 会被
// 浏览器拦截。该协议把请求交给主进程的 net.fetch 转发（主进程无 CORS 限制），
// 目标地址与请求头经编码放在查询参数里，SSE 流式响应原样透传。
const AI_PROXY_SCHEME = 'tw-ai-proxy';

protocol.registerSchemesAsPrivileged([
  ...Object.entries(FILE_SCHEMES).map(([scheme, metadata]) => ({
    scheme,
    privileges: {
      standard: !!metadata.standard,
      supportFetchAPI: !!metadata.supportFetch,
      secure: !!metadata.secure,
      stream: !!metadata.stream
    }
  })),
  {
    scheme: AI_PROXY_SCHEME,
    privileges: {
      // non-standard：目标 URL 整体编码进查询参数，避免 URL 规范化破坏它
      standard: false,
      supportFetchAPI: true,
      secure: true,
      stream: true,
      bypassCSP: true
    }
  },
  {
    scheme: EXPANDS_SCHEME,
    privileges: {
      // non-standard：host 是根目录 id，路径各段单独 encodeURI 后拼接
      standard: false,
      supportFetchAPI: true,
      secure: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

/**
 * Promisified zlib.brotliDecompress
 */
const brotliDecompress = (input) => new Promise((resolve, reject) => {
  zlib.brotliDecompress(input, (error, result) => {
    if (error) {
      reject(error);
    } else {
      resolve(result);
    }
  });
});

/**
 * @param {unknown} xml
 * @returns {string}
 */
const escapeXML = (xml) => String(xml).replace(/[<>&'"]/g, c => {
  switch (c) {
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '&': return '&amp;';
    case '\'': return '&apos;';
    case '"': return '&quot;';
  }
});

/**
 * Note that custom extensions will be able to access this page and all of the information in it.
 * @param {Request | Electron.ProtocolRequest} request
 * @param {unknown} errorMessage
 * @returns {string}
 */
const createErrorPageHTML = (request, errorMessage) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Protocol handler error</title>
  </head>
  <body bgcolor="white" text="black">
    <h1>Protocol handler error</h1>
    <p>If you can see this page, <a href="https://github.com/TurboWarp/desktop/issues" target="_blank" rel="noreferrer">please open a GitHub issue</a> or <a href="mailto:contact@turbowarp.org" target="_blank" rel="noreferrer">email us</a> with all the information below.</p>
    <pre>${escapeXML(errorMessage)}</pre>
    <pre>URL: ${escapeXML(request.url)}</pre>
    <pre>Version ${escapeXML(packageJSON.version)}, Electron ${escapeXML(process.versions.electron)}, Platform ${escapeXML(getPlatform())} ${escapeXML(process.arch)}, Distribution ${escapeXML(getDist())}</pre>
  </body>
</html>`;

const errorPageHeaders = {
  'content-type': 'text/html',
  'content-security-policy': 'default-src \'none\''
};

/**
 * @param {Metadata} metadata
 * @returns {Record<string, string>}
 */
const getBaseProtocolHeaders = metadata => {
  const result = {
    // Make sure Chromium always trusts our content-type and doesn't try anything clever
    'x-content-type-options': 'nosniff'
  };

  // Optional Content-Security-Policy
  if (metadata.csp) {
    result['content-security-policy'] = metadata.csp;
  }

  // Don't allow things like extensiosn to embed custom protocols
  if (!metadata.embeddable) {
    result['x-frame-options'] = 'DENY';
  }

  return result;
};

/** @param {Metadata} metadata */
const createModernProtocolHandler = (metadata) => {
  const root = path.join(metadata.root, '/');
  const baseHeaders = getBaseProtocolHeaders(metadata);

  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  return async (request) => {
    const createErrorResponse = (error) => {
      console.error(error);
      return new Response(createErrorPageHTML(request, error), {
        status: 400,
        headers: {
          ...baseHeaders,
          ...errorPageHeaders
        }
      });
    };

    try {
      let parsedURL = new URL(request.url);
      if (parsedURL.pathname.endsWith('/') && metadata.directoryIndex) {
        parsedURL = new URL(metadata.directoryIndex, parsedURL);
      }

      let resolved = path.join(root, parsedURL.pathname);
      if (!resolved.startsWith(root)) {
        return createErrorResponse(new Error('Path traversal blocked'));
      }

      let fileExtension = path.extname(resolved);
      if (!fileExtension && metadata.defaultExtension) {
        fileExtension = metadata.defaultExtension;
        resolved = `${resolved}${fileExtension}`;
      }

      const mimeType = MIME_TYPES.get(fileExtension);
      if (!mimeType) {
        return createErrorResponse(new Error(`Invalid file extension: ${fileExtension}`));
      }

      const headers = {
        ...baseHeaders,
        'content-type': mimeType
      };

      if (metadata.brotli) {
        // Reading it all into memory is not ideal, but we've had so many problems with streaming
        // files from the asar that I can settle with this.
        const brotliResponse = await net.fetch(nodeURL.pathToFileURL(`${resolved}.br`));
        const brotliData = await brotliResponse.arrayBuffer();
        const decompressed = await brotliDecompress(brotliData);
        return new Response(decompressed, {
          headers
        });
      }

      const response = await net.fetch(nodeURL.pathToFileURL(resolved));
      return new Response(response.body, {
        headers
      });
    } catch (error) {
      return createErrorResponse(error);
    }
  };
};

/** @param {Metadata} metadata */
const createLegacyBrotliProtocolHandler = (metadata) => {
  const root = path.join(metadata.root, '/');
  const baseHeaders = getBaseProtocolHeaders(metadata);

  /**
   * @param {Electron.ProtocolRequest} request
   * @param {(result: {data: Buffer; statusCode?: number; headers?: Record<string, string>;}) => void} callback
   */
  return async (request, callback) => {
    const fsPromises = require('fs/promises');

    const returnErrorPage = (error) => {
      console.error(error);
      callback({
        data: Buffer.from(createErrorPageHTML(request, error)),
        statusCode: 400,
        headers: {
          ...baseHeaders,
          ...errorPageHeaders
        }
      });
    };

    try {
      let parsedURL = new URL(request.url);
      if (parsedURL.pathname.endsWith('/') && metadata.directoryIndex) {
        parsedURL = new URL(metadata.directoryIndex, parsedURL);
      }

      let resolved = path.join(root, parsedURL.pathname);
      if (!resolved.startsWith(root)) {
        returnErrorPage(new Error('Path traversal blocked'));
        return;
      }

      let fileExtension = path.extname(resolved);
      if (!fileExtension && metadata.defaultExtension) {
        fileExtension = metadata.defaultExtension;
        resolved = `${resolved}${fileExtension}`;
      }

      const mimeType = MIME_TYPES.get(fileExtension);
      if (!mimeType) {
        returnErrorPage(new Error(`Invalid file extension: ${fileExtension}`));
        return;
      }

      // Reading it all into memory is not ideal, but we've had so many problems with streaming
      // files from the asar that I can settle with this.
      const brotliData = await fsPromises.readFile(`${resolved}.br`);
      const decompressed = await brotliDecompress(brotliData);

      callback({
        data: decompressed,
        headers: {
          ...baseHeaders,
          'content-type': mimeType
        }
      });
    } catch (error) {
      returnErrorPage(error);
    }
  };
};

/** @param {Metadata} metadata */
const createLegacyFileProtocolHandler = (metadata) => {
  const root = path.join(metadata.root, '/');
  const baseHeaders = getBaseProtocolHeaders(metadata);

  /**
   * @param {Electron.ProtocolRequest} request
   * @param {(result: {path: string; statusCode?: number; headers?: Record<string, string>;}) => void} callback
   */
  return (request, callback) => {
    const returnErrorResponse = (error, errorPage) => {
      console.error(error);
      callback({
        status: 400,
        // All we can return is a file path, so we just have a few different ones baked in
        // for each error that we expect.
        path: path.join(__dirname, `../src-protocol-error/legacy-file/${errorPage}.html`),
        headers: {
          ...baseHeaders,
          ...errorPageHeaders
        }
      });
    };

    try {
      let parsedURL = new URL(request.url);
      if (parsedURL.pathname.endsWith('/') && metadata.directoryIndex) {
        parsedURL = new URL(metadata.directoryIndex, parsedURL);
      }

      let resolved = path.join(root, parsedURL.pathname);
      if (!resolved.startsWith(root)) {
        returnErrorResponse(new Error('Path traversal blocked'), 'path-traversal');
        return;
      }

      let fileExtension = path.extname(resolved);
      if (!fileExtension && metadata.defaultExtension) {
        fileExtension = metadata.defaultExtension;
        resolved = `${resolved}${fileExtension}`;
      }

      const mimeType = MIME_TYPES.get(fileExtension);
      if (!mimeType) {
        returnErrorResponse(new Error(`Invalid file extension: ${fileExtension}`), 'invalid-extension');
        return;
      }

      callback({
        path: resolved,
        headers: {
          ...baseHeaders,
          'content-type': mimeType
        }
      });
    } catch (error) {
      returnErrorResponse(error, 'unknown');
    }
  };
};

/** @returns {Promise<Buffer | undefined>} */
const readProtocolRequestBody = async (request) => {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) {
    return undefined;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 64 * 1024 * 1024) {
      throw new Error('AI proxy request body too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
};

/**
 * 转发 AI API 请求。只允许 http/https 目标；Authorization 等请求头
 * 由页面编码在查询参数中传过来，SSE 响应体以流的形式原样透传。
 */
const createAIProxyHandler = () => async (request) => {
  try {
    const parsed = new URL(request.url);
    if (parsed.host !== 'request') {
      throw new Error('Invalid AI proxy URL');
    }
    const target = parsed.searchParams.get('u');
    const headersParam = parsed.searchParams.get('h');
    if (!target || !/^https?:\/\//i.test(target)) {
      throw new Error('Invalid AI proxy target');
    }
    const headers = headersParam ?
      JSON.parse(Buffer.from(headersParam, 'base64url').toString('utf8')) :
      {};
    const body = await readProtocolRequestBody(request);
    const response = await net.fetch(target, {
      method: request.method,
      headers,
      body
    });
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    // 页面源是 tw-ai-assistant://，补一个宽松的 CORS 头以防万一
    responseHeaders['access-control-allow-origin'] = '*';
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('[ai-proxy]', error);
    return new Response(JSON.stringify({
      error: {message: String((error && error.message) || error)}
    }), {
      status: 502,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      }
    });
  }
};

/**
 * nw-expands:// 协议处理器：Expands 本地扩展目录。
 * URL 形如 nw-expands://<rootId>/<扩展名>/<作者>/<简介>/<file>，
 * rootId 在运行时映射到实际根目录（主进程 neowarp-expands.js）。
 * @returns {(request: Request) => Promise<Response>}
 */
const createExpandsProtocolHandler = () => {
  const baseHeaders = getBaseProtocolHeaders({embeddable: false});

  const resolveRoot = (rootId) => getExpandsRoots().find(rootInfo => rootInfo.id === rootId);

  /**
   * 解析请求 URL 到绝对路径；非法请求返回 null。
   * @param {string} url
   * @returns {Promise<{resolved: string; mimeType: string} | null>}
   */
  const resolveFile = async (url) => {
    const parsedURL = new URL(url);
    const rootInfo = resolveRoot(parsedURL.hostname);
    if (!rootInfo) return null;
    // 各路径段在生成 URL 时单独 encode 过，这里逐段解码，避免 %2F 之类被提前还原
    const segments = parsedURL.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment));
    if (!segments.length) return null;

    const root = path.join(rootInfo.root, '/');
    const resolved = path.join(root, ...segments);
    if (!resolved.startsWith(root)) return null; // path traversal

    const fileExtension = path.extname(resolved).toLowerCase();
    const mimeType = MIME_TYPES.get(fileExtension);
    if (!mimeType) return null;
    return {resolved, mimeType};
  };

  return async (request) => {
    try {
      const file = await resolveFile(request.url);
      if (!file) {
        return new Response('Not found', {status: 404, headers: baseHeaders});
      }
      const response = await net.fetch(nodeURL.pathToFileURL(file.resolved));
      return new Response(response.body, {
        headers: {
          ...baseHeaders,
          'content-type': file.mimeType
        }
      });
    } catch (error) {
      console.error('[nw-expands]', error);
      return new Response('Error', {status: 400, headers: baseHeaders});
    }
  };
};

/** nw-expands 的传统协议回调版本（Electron 22 / Windows 7/8/8.1） */
const createLegacyExpandsProtocolHandler = () => {
  const baseHeaders = getBaseProtocolHeaders({embeddable: false});

  /**
   * @param {Electron.ProtocolRequest} request
   * @param {(result: {path: string; statusCode?: number; headers?: Record<string, string>;}) => void} callback
   */
  return (request, callback) => {
    (async () => {
      const parsedURL = new URL(request.url);
      const rootInfo = getExpandsRoots().find(root => root.id === parsedURL.hostname);
      if (!rootInfo) throw new Error('Unknown root');
      const segments = parsedURL.pathname
        .split('/')
        .filter(Boolean)
        .map(segment => decodeURIComponent(segment));
      if (!segments.length) throw new Error('Empty path');

      const root = path.join(rootInfo.root, '/');
      const resolved = path.join(root, ...segments);
      if (!resolved.startsWith(root)) throw new Error('Path traversal blocked');

      const fileExtension = path.extname(resolved).toLowerCase();
      const mimeType = MIME_TYPES.get(fileExtension);
      if (!mimeType) throw new Error(`Invalid file extension: ${fileExtension}`);

      callback({
        path: resolved,
        headers: {
          ...baseHeaders,
          'content-type': mimeType
        }
      });
    })().catch(error => {
      console.error('[nw-expands]', error);
      callback({
        path: path.join(__dirname, '../src-protocol-error/legacy-file/unknown.html'),
        statusCode: 400,
        headers: {
          ...baseHeaders,
          ...errorPageHeaders
        }
      });
    });
  };
};

app.whenReady().then(() => {
  for (const [scheme, metadata] of Object.entries(FILE_SCHEMES)) {
    // Electron 22 (used by Windows 7/8/8.1 build) does not support protocol.handle() or new Response()
    if (protocol.handle) {
      protocol.handle(scheme, createModernProtocolHandler(metadata));
    } else {
      if (metadata.brotli) {
        protocol.registerBufferProtocol(scheme, createLegacyBrotliProtocolHandler(metadata));
      } else {
        protocol.registerFileProtocol(scheme, createLegacyFileProtocolHandler(metadata));
      }
    }
  }

  if (protocol.handle) {
    protocol.handle(AI_PROXY_SCHEME, createAIProxyHandler());
    protocol.handle(EXPANDS_SCHEME, createExpandsProtocolHandler());
  } else {
    protocol.registerFileProtocol(EXPANDS_SCHEME, createLegacyExpandsProtocolHandler());
  }
});
