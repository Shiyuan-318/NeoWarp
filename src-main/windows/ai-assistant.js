const AbstractWindow = require('./abstract');
const {ipcMain} = require('electron');
const {translate, getLocale} = require('../l10n');
const {APP_NAME} = require('../brand');
const settings = require('../settings');
const privilegedFetch = require('../fetch');
const https = require('https');
const http = require('http');

/**
 * Fetch URL with redirect support, returns text content.
 * @param {string} url
 * @param {object} options
 * @param {number} maxRedirects
 * @returns {Promise<string>}
 */
function fetchText (url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedURL = new URL(url);
    const mod = parsedURL.protocol === 'http:' ? http : https;
    const req = mod.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        let redirectUrl = res.headers.location;
        // Handle protocol-relative URLs (//example.com/path)
        if (redirectUrl.startsWith('//')) {
          redirectUrl = parsedURL.protocol + redirectUrl;
        } else if (redirectUrl.startsWith('/')) {
          // Handle absolute paths
          redirectUrl = parsedURL.origin + redirectUrl;
        } else if (!redirectUrl.startsWith('http')) {
          // Handle relative paths
          redirectUrl = parsedURL.origin + parsedURL.pathname.replace(/[^/]*$/, '') + redirectUrl;
        }
        return resolve(fetchText(redirectUrl, options, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Decode a DuckDuckGo redirect URL to extract the actual target URL.
 * DuckDuckGo wraps result URLs like: //duckduckgo.com/l/?uddg=<encoded>&rut=...
 * @param {string} rawUrl
 * @returns {string}
 */
function decodeDDGUrl (rawUrl) {
  if (!rawUrl) return '';
  // Handle protocol-relative URLs
  let url = rawUrl;
  if (url.startsWith('//')) url = 'https:' + url;
  // Extract uddg parameter from redirect URLs
  const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch (e) {
      return rawUrl;
    }
  }
  return rawUrl;
}

/**
 * Parse DuckDuckGo HTML search results.
 * @param {string} html
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
function parseDDGResults (html) {
  const results = [];
  // Match result links - handles different attribute orders
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<(?:a|td)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
  const links = [];
  const snippets = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null && links.length < 8) {
    links.push({url: decodeDDGUrl(m[1]), title: m[2].replace(/<[^>]+>/g, '').trim()});
  }
  while ((m = snippetRegex.exec(html)) !== null && snippets.length < 8) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  for (let i = 0; i < links.length; i++) {
    if (links[i].url) {
      results.push({title: links[i].title, url: links[i].url, snippet: snippets[i] || ''});
    }
  }
  return results;
}

/**
 * Parse Bing HTML search results.
 * @param {string} html
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
function parseBingResults (html) {
  const results = [];
  // Bing results use <li class="b_algo"> with <h2><a href="...">title</a></h2> and <p>snippet</p>
  const itemRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null && results.length < 8) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!title || !url) continue;
    // Snippet is usually in <p> or class="b_caption"
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    results.push({title: title, url: url, snippet: snippet});
  }
  return results;
}

/**
 * Extract readable text content from an HTML string.
 * @param {string} html
 * @returns {string}
 */
function extractPageContent (html) {
  if (!html) return '';
  var text = html;
  // Remove script, style, nav, footer, header, aside, form, noscript, svg tags and their contents
  text = text.replace(/<(script|style|nav|footer|header|aside|form|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Truncate to 2000 characters
  if (text.length > 2000) text = text.substring(0, 2000);
  return text;
}

/**
 * Perform web search using DuckDuckGo HTML, Bing, and Wikipedia API.
 * @param {string} query
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function webSearch (query) {
  const results = [];
  const errors = [];
  const seenUrls = new Set();

  // Helper to add results without duplicates
  function addResult (r) {
    if (r.url && !seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      results.push(r);
    }
  }

  // DuckDuckGo HTML search
  try {
    const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const html = await fetchText(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const ddgResults = parseDDGResults(html);
    ddgResults.forEach(r => addResult({...r, source: 'DuckDuckGo'}));
  } catch (e) {
    errors.push('DuckDuckGo: ' + e.message);
  }

  // Bing search as fallback / supplement
  if (results.length < 5) {
    try {
      const bingUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN';
      const bingHtml = await fetchText(bingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });
      const bingResults = parseBingResults(bingHtml);
      bingResults.forEach(r => addResult({...r, source: 'Bing'}));
    } catch (e) {
      errors.push('Bing: ' + e.message);
    }
  }

  // DuckDuckGo Instant Answer API as fallback
  if (results.length === 0) {
    try {
      const apiUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
      const data = await privilegedFetch.json(apiUrl);
      if (data.Abstract) {
        addResult({
          title: data.Heading || query,
          url: data.AbstractURL || '',
          snippet: data.Abstract,
          source: data.AbstractSource || 'DuckDuckGo'
        });
      }
      if (data.RelatedTopics) {
        data.RelatedTopics.forEach(t => {
          if (t.Text && results.length < 12) {
            addResult({
              title: t.Text.substring(0, 80),
              url: t.FirstURL || '',
              snippet: t.Text,
              source: 'DuckDuckGo'
            });
          }
        });
      }
    } catch (e) {
      errors.push('DuckDuckGo API: ' + e.message);
    }
  }

  // Wikipedia search - try both Chinese and English
  const wikiSources = [
    {lang: 'zh', label: 'Wikipedia', url: 'https://zh.wikipedia.org/w/api.php'},
    {lang: 'en', label: 'Wikipedia (EN)', url: 'https://en.wikipedia.org/w/api.php'}
  ];
  for (const src of wikiSources) {
    if (results.length >= 12) break;
    try {
      const wikiUrl = src.url + '?action=query&list=search&srsearch=' +
        encodeURIComponent(query) + '&format=json&srlimit=3&utf8=1';
      const wikiData = await privilegedFetch.json(wikiUrl);
      if (wikiData.query && wikiData.query.search) {
        wikiData.query.search.forEach(s => {
          addResult({
            title: s.title,
            url: 'https://' + src.lang + '.wikipedia.org/wiki/' + encodeURIComponent(s.title),
            snippet: s.snippet.replace(/<[^>]+>/g, '').trim(),
            source: src.label
          });
        });
      }
    } catch (e) {
      errors.push(src.label + ': ' + e.message);
    }
  }

  // Fetch page content for top 3 results
  const topResults = results.slice(0, 3);
  for (const r of topResults) {
    try {
      const pageHtml = await fetchText(r.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });
      r.content = extractPageContent(pageHtml);
    } catch (e) {
      // Silently skip content extraction on failure
    }
  }

  if (results.length === 0) {
    return {success: false, error: 'No results found. ' + errors.join('; ')};
  }
  return {success: true, data: results.slice(0, 12)};
}

class AIAssistantWindow extends AbstractWindow {
  constructor (editorWindow) {
    super();

    this.editorWindow = editorWindow;

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle(`AI Assistant`);

    this.ipc.handle('get-project-code', () => {
      return new Promise((resolve) => {
        if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
          resolve(null);
          return;
        }
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('project-json-response', handler);
            resolve(data.projectJSON || null);
          }
        };
        ipcMain.on('project-json-response', handler);
        this.editorWindow.window.webContents.send('request-project-json', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('project-json-response', handler);
          resolve(null);
        }, 5000);
      });
    });

    this.ipc.handle('apply-project', async (event, projectJSON) => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return { success: false, error: 'Editor window not available' };
      }
      this.editorWindow.window.webContents.send('apply-project', { projectJSON });
      return { success: true };
    });

    this.ipc.handle('apply-sprite', async (event, spriteJSON, targetId) => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return { success: false, error: 'Editor window not available' };
      }
      this.editorWindow.window.webContents.send('apply-sprite', { spriteJSON, targetId });
      return { success: true };
    });

    this.ipc.handle('ai-tool-call', async (event, toolName, params) => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return { success: false, error: 'Editor window not available' };
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('ai-tool-response', handler);
            resolve(data.result || { success: false, error: 'No response' });
          }
        };
        ipcMain.on('ai-tool-response', handler);
        this.editorWindow.window.webContents.send('ai-tool-call', { requestId, toolName, params });
        setTimeout(() => {
          ipcMain.removeListener('ai-tool-response', handler);
          resolve({ success: false, error: 'Tool call timeout' });
        }, 30000);
      });
    });

    this.ipc.handle('get-sprite-library', async () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return null;
      }
      return new Promise((resolve) => {
        const handler = (event, data) => {
          ipcMain.removeListener('sprite-library-response', handler);
          resolve(data || null);
        };
        ipcMain.on('sprite-library-response', handler);
        this.editorWindow.window.webContents.send('request-sprite-library');
        setTimeout(() => {
          ipcMain.removeListener('sprite-library-response', handler);
          resolve(null);
        }, 5000);
      });
    });

    this.ipc.handle('get-ai-settings', () => settings.aiProviders || {});

    this.ipc.handle('save-ai-settings', async (event, aiSettings) => {
      settings.aiProviders = aiSettings;
      await settings.save();
      return { success: true };
    });

    this.ipc.handle('web-search', async (event, query) => {
      try {
        return await webSearch(query);
      } catch (e) {
        return {success: false, error: e.message};
      }
    });

    this.ipc.handle('ai-get-theme', () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return 'light';
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('theme-response', handler);
            resolve(data.theme || 'light');
          }
        };
        ipcMain.on('theme-response', handler);
        this.editorWindow.window.webContents.send('request-theme', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('theme-response', handler);
          resolve('light');
        }, 3000);
      });
    });

    this.ipc.handle('ai-get-locale', () => {
      return getLocale() || 'en';
    });

    this.ipc.handle('ai-close-window', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.loadURL('tw-ai-assistant://./ai-assistant.html');
    this.show();
  }

  getDimensions () {
    return {
      width: 1040,
      height: 640
    };
  }

  getPreload () {
    return 'ai-assistant';
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#f5f5f7';
  }

  static show (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(AIAssistantWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    return new AIAssistantWindow(editorWindow);
  }
}

module.exports = AIAssistantWindow;
