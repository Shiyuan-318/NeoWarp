/* NeoWarp 扩展编辑器 —— 积木 SVG 渲染（共享纯函数，无 DOM 接线）
 * 同时供停靠面板（extension-editor.js）与积木预览弹窗（blocks-preview.js）使用。
 * 浏览器下挂到 window.NeoWarpBlocksRender；node 下 module.exports（便于单测）。
 */
(function (root) {
  'use strict';

  var BLOCK_H = 32;          // 统一积木主体高度
  var TONGUE_H = 6;          // command 底部凸舌高度
  var SLOT_H = 24;           // 输入插槽高度
  var PAD_L = 12;            // 积木左内边距
  var PAD_R = 12;            // 积木右内边距
  var SEG_GAP = 4;           // 相邻段（文字/插槽）间距
  var TEXT_BASELINE = 20.3;  // 12px 文字在 32px 高积木内的基线
  var FALLBACK_COLOR = '#4C97FF';
  var MIN_WIDTHS = { command: 40, hat: 40, reporter: 36, boolean: 28 };

  var measureCtx = null;

  // 量测文本宽度：浏览器优先 canvas 实测；node 环境按字符估算（ASCII 7 / CJK·全角 12 / 其他 8）
  function measureText (text) {
    var str = String(text == null ? '' : text);
    if (!str) return 0;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      if (!measureCtx) {
        try {
          var canvas = document.createElement('canvas');
          measureCtx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
        } catch (e) { measureCtx = null; }
      }
      if (measureCtx) {
        measureCtx.font = 'bold 12px sans-serif';
        return measureCtx.measureText(str).width;
      }
    }
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0x2e80) w += 12;
      else if (code < 0x80) w += 7;
      else w += 8;
    }
    return w;
  }

  // '#rgb' / '#rrggbb' → {r,g,b}；非法返回 null
  function parseColor (color) {
    if (typeof color !== 'string') return null;
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
    if (!m) return null;
    var hex = m[1];
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function toHex (v) {
    var h = Math.max(0, Math.min(255, Math.round(v))).toString(16);
    return h.length === 1 ? '0' + h : h;
  }

  // rgb 各通道乘 f 后转回 '#rrggbb'；非法输入返回 null
  function darken (color, f) {
    var rgb = parseColor(color);
    if (!rgb) return null;
    return '#' + toHex(rgb.r * f) + toHex(rgb.g * f) + toHex(rgb.b * f);
  }

  function escapeXml (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isEmptyValue (v) {
    return v === undefined || v === null || v === '';
  }

  // text 中 [NAME] 参数分段：[{type:'text'|'arg', value}]
  function parseSegments (text) {
    var str = String(text == null ? '' : text);
    var parts = [];
    var re = /\[([^\[\]]+)\]/g;
    var m;
    var last = 0;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) parts.push({ type: 'text', value: str.slice(last, m.index) });
      parts.push({ type: 'arg', value: m[1] });
      last = re.lastIndex;
    }
    if (last < str.length) parts.push({ type: 'text', value: str.slice(last) });
    return parts;
  }

  // command / conditional / loop：矩形 + 顶部凹口（x 12-28）+ 底部凸舌（镜像向下）
  function commandPath (w) {
    return 'M 4 0 L 12 0 ' +
      'C 12 4.5 15 6 20 6 C 25 6 28 4.5 28 0 ' +
      'L ' + (w - 4) + ' 0 Q ' + w + ' 0 ' + w + ' 4 L ' + w + ' 28 Q ' + w + ' 32 ' + (w - 4) + ' 32 ' +
      'L 28 32 C 28 36.5 25 38 20 38 C 15 38 12 36.5 12 32 ' +
      'L 4 32 Q 0 32 0 28 L 0 4 Q 0 0 4 0 Z';
  }

  // hat：顶部穹顶弧线（左缘 1/3 高处起弧）+ 下方直边圆角
  function hatPath (w) {
    return 'M 0 12 A ' + (w / 2) + ' 12 0 0 1 ' + w + ' 12 ' +
      'L ' + w + ' 28 Q ' + w + ' 32 ' + (w - 4) + ' 32 L 4 32 Q 0 32 0 28 Z';
  }

  // Boolean：左右尖角六边形（左/右中点在垂直中央，顶底缩进 6）
  function booleanPath (x, y, w, h) {
    var mid = y + h / 2;
    return 'M ' + (x + 6) + ' ' + y +
      ' L ' + (x + w - 6) + ' ' + y +
      ' L ' + (x + w) + ' ' + mid +
      ' L ' + (x + w - 6) + ' ' + (y + h) +
      ' L ' + (x + 6) + ' ' + (y + h) +
      ' L ' + x + ' ' + mid + ' Z';
  }

  // 从 menus[menu] 取第一项的 text/value 作为默认显示值
  function menuDefaultText (arg, menus) {
    if (!menus || !arg || !arg.menu) return undefined;
    var entry = menus[arg.menu];
    if (!entry) return undefined;
    var items = Array.isArray(entry) ? entry : entry.items;
    if (!items || !items.length) return undefined;
    var first = items[0];
    if (first == null) return undefined;
    if (typeof first === 'object') {
      return first.text !== undefined ? first.text : first.value;
    }
    return first;
  }

  // 渲染 text 的各段：返回 {els: [...], width: x 游标终值}
  function renderSegments (text, args, menus, color1, stroke) {
    var segments = parseSegments(text);
    var els = [];
    var x = PAD_L;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (i > 0) x += SEG_GAP;
      if (seg.type === 'text') {
        var tw = measureText(seg.value);
        if (tw <= 0) continue;
        els.push('<text x="' + x + '" y="' + TEXT_BASELINE + '" fill="#ffffff" font-size="12" font-weight="bold">' + escapeXml(seg.value) + '</text>');
        x += tw;
        continue;
      }
      var arg = args && Object.prototype.hasOwnProperty.call(args, seg.value) ? args[seg.value] : {};
      if (!arg || typeof arg !== 'object') arg = {};
      var atype = arg.type || 'string';
      if (arg.menu) {
        // 下拉菜单插槽：深色胶囊 + 白字 + 右端白色小三角
        var dv = isEmptyValue(arg.defaultValue) ? menuDefaultText(arg, menus) : arg.defaultValue;
        var mstr = isEmptyValue(dv) ? '' : String(dv);
        var mtw = measureText(mstr);
        var msw = Math.max(mtw + 24, 24);
        els.push('<rect x="' + x + '" y="4" width="' + msw + '" height="' + SLOT_H + '" rx="12" fill="' + (darken(color1, 0.85) || color1) + '"/>');
        if (mstr) {
          els.push('<text x="' + (x + 8) + '" y="' + TEXT_BASELINE + '" fill="#ffffff" font-size="12" font-weight="bold">' + escapeXml(mstr) + '</text>');
        }
        var tx = x + msw - 12;
        els.push('<polygon points="' + tx + ',13.5 ' + (tx + 7) + ',13.5 ' + (tx + 3.5) + ',19.5" fill="#ffffff"/>');
        x += msw;
      } else if (atype === 'Boolean') {
        // 六边形布尔插槽：深色填充、无边框、宽 ≥24
        els.push('<path d="' + booleanPath(x, 4, 24, SLOT_H) + '" fill="' + (darken(color1, 0.75) || color1) + '"/>');
        x += 24;
      } else if (atype === 'color') {
        // 颜色选择器：20×20 圆角色板 + 白描边
        var cfill = parseColor(arg.defaultValue) ? arg.defaultValue : FALLBACK_COLOR;
        els.push('<rect x="' + x + '" y="6" width="20" height="20" rx="4" fill="' + cfill + '" stroke="#ffffff" stroke-width="1.5"/>');
        x += 20;
      } else {
        // number / string / angle 等：白色胶囊插槽，内文 #575E75
        var v = isEmptyValue(arg.defaultValue) ? '' : String(arg.defaultValue);
        var vtw = measureText(v);
        var vsw = Math.max(vtw + 16, 18);
        els.push('<rect x="' + x + '" y="4" width="' + vsw + '" height="' + SLOT_H + '" rx="12" fill="#ffffff" stroke="' + stroke + '" stroke-width="1.5"/>');
        if (v) {
          els.push('<text x="' + (x + (vsw - vtw) / 2) + '" y="' + TEXT_BASELINE + '" fill="#575E75" font-size="12" font-weight="bold">' + escapeXml(v) + '</text>');
        }
        x += vsw;
      }
    }
    return { els: els, width: x };
  }

  // 把单个 block 渲染为 Scratch 3 风格 SVG；返回 {svg, width, height}
  function buildBlockSvg (block, fallbackColor) {
    if (!block || typeof block !== 'object') return { svg: '', width: 0, height: 0 };
    var type = block.blockType || 'command';
    var text = block.text;

    // label：不画积木，只输出一行普通文字
    if (type === 'label') {
      return { svg: '<div class="blocks-label">' + escapeXml(text) + '</div>', width: 0, height: 0 };
    }

    // 主色：block.color1 → fallbackColor → 兜底蓝
    var color1 = FALLBACK_COLOR;
    if (parseColor(block.color1)) color1 = block.color1;
    else if (parseColor(fallbackColor)) color1 = fallbackColor;
    var stroke = darken(color1, 0.75) || color1;

    var shape;
    if (type === 'reporter') shape = 'reporter';
    else if (type === 'Boolean') shape = 'boolean';
    else if (type === 'hat') shape = 'hat';
    else shape = 'command';  // command / conditional / loop / 未知类型
    var height = shape === 'command' ? BLOCK_H + TONGUE_H : BLOCK_H;

    var args = block.arguments && typeof block.arguments === 'object' ? block.arguments : {};
    var menus = block.menus && typeof block.menus === 'object' ? block.menus : {};
    var rendered = renderSegments(text, args, menus, color1, stroke);
    var w = Math.max(rendered.width + PAD_R, MIN_WIDTHS[shape]);

    var shapeEl;
    if (shape === 'command') {
      shapeEl = '<path d="' + commandPath(w) + '" fill="' + color1 + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    } else if (shape === 'hat') {
      shapeEl = '<path d="' + hatPath(w) + '" fill="' + color1 + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    } else if (shape === 'boolean') {
      shapeEl = '<path d="' + booleanPath(0, 0, w, BLOCK_H) + '" fill="' + color1 + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    } else {
      shapeEl = '<rect x="0" y="0" width="' + w + '" height="' + BLOCK_H + '" rx="16" fill="' + color1 + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    }

    // viewBox 外扩 1px，避免 1.5px 描边被裁掉一半
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ' + (w + 2) + ' ' + (height + 2) +
      '" width="' + w + '" height="' + height + '" role="img" aria-label="' + escapeXml(text) + '">' +
      shapeEl + rendered.els.join('') + '</svg>';
    return { svg: svg, width: w, height: height };
  }

  // 一个扩展 → 分组标题 + 各 block 一行 .blocks-row
  function buildExtensionSection (ext, lang) {
    if (!ext || typeof ext !== 'object') return '';
    var name = ext.name != null ? String(ext.name) : '';
    if (!name && ext.id != null) name = String(ext.id);
    var id = ext.id != null ? String(ext.id) : '';
    var color = ext.color1 || FALLBACK_COLOR;
    var html = '<div class="blocks-group">';
    html += '<div class="blocks-group-title">' +
      '<span class="dot" style="background:' + escapeXml(color) + '"></span>' +
      escapeXml(name) +
      (id ? ' <span class="ext-id">' + escapeXml(id) + '</span>' : '') +
      '</div>';
    var blocks = Array.isArray(ext.blocks) ? ext.blocks : [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block || typeof block !== 'object') continue;
      // 扩展级 menus 下放到 block，供菜单插槽查默认项
      var merged = block.menus ? block : Object.assign({}, block, { menus: ext.menus || {} });
      var piece = buildBlockSvg(merged, color);
      if (piece && piece.svg) {
        html += '<div class="blocks-row">' + piece.svg + '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  var api = {
    measureText: measureText,
    parseColor: parseColor,
    darken: darken,
    escapeXml: escapeXml,
    buildBlockSvg: buildBlockSvg,
    buildExtensionSection: buildExtensionSection
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.NeoWarpBlocksRender = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
