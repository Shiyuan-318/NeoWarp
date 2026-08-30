// Name: PunycodeChange
// ID: punycodechange
// Description: 在文本与 Punycode（RFC 3492 / IDNA）之间互相转换。
// By: NeoWarp

(function (Scratch) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * RFC 3492 Punycode，实现自 punycode.js（Mathias Bynens，MIT）的算法 *
   * ------------------------------------------------------------------ */

  const maxInt = 2147483647;
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128; // 0x80
  const delimiter = "-";

  const regexPunycode = /^xn--/i;
  const regexNonASCII = /[^\0-\x7F]/;
  // 句点的三种全角/表意变体也按分隔符处理
  const regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;

  /** 把字符串按码位（而非 UTF-16 码元）拆成数组，正确处理代理对 */
  const ucs2decode = (string) => {
    const output = [];
    for (const symbol of string) {
      output.push(symbol.codePointAt(0));
    }
    return output;
  };

  const ucs2encode = (codePoints) => String.fromCodePoint(...codePoints);

  /** basic code point -> digit */
  const basicToDigit = (codePoint) => {
    if (codePoint >= 0x30 && codePoint < 0x3a) {
      return 26 + (codePoint - 0x30);
    }
    if (codePoint >= 0x41 && codePoint < 0x5b) {
      return codePoint - 0x41;
    }
    if (codePoint >= 0x61 && codePoint < 0x7b) {
      return codePoint - 0x61;
    }
    return base;
  };

  /** digit -> basic code point，flag 为真时输出大写 */
  const digitToBasic = (digit, flag) =>
    digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);

  const adapt = (delta, numPoints, firstTime) => {
    let k = 0;
    delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) {
      delta = Math.floor(delta / (base - tMin));
    }
    return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
  };

  /** Punycode 字符串 -> Unicode 字符串（不含 xn-- 前缀） */
  const punycodeDecode = (input) => {
    const output = [];
    const inputLength = input.length;
    let i = 0;
    let n = initialN;
    let bias = initialBias;

    // 先取出最后一个分隔符之前的 basic code points
    let basic = input.lastIndexOf(delimiter);
    if (basic < 0) {
      basic = 0;
    }

    for (let j = 0; j < basic; ++j) {
      if (input.charCodeAt(j) >= 0x80) {
        throw new RangeError("非法的输入：Punycode 中出现非 ASCII 字符");
      }
      output.push(input.charCodeAt(j));
    }

    for (let index = basic > 0 ? basic + 1 : 0; index < inputLength; ) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        if (index >= inputLength) {
          throw new RangeError("输入意外结束");
        }
        const digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= base) {
          throw new RangeError("非法的 Punycode 字符");
        }
        if (digit > Math.floor((maxInt - i) / w)) {
          throw new RangeError("数值溢出");
        }
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) {
          break;
        }
        const baseMinusT = base - t;
        if (w > Math.floor(maxInt / baseMinusT)) {
          throw new RangeError("数值溢出");
        }
        w *= baseMinusT;
      }

      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi == 0);

      if (Math.floor(i / out) > maxInt - n) {
        throw new RangeError("数值溢出");
      }
      n += Math.floor(i / out);
      i %= out;

      output.splice(i++, 0, n);
    }

    return String.fromCodePoint(...output);
  };

  /** Unicode 字符串 -> Punycode 字符串（不含 xn-- 前缀） */
  const punycodeEncode = (input) => {
    const output = [];
    const inputCodePoints = ucs2decode(input);
    const inputLength = inputCodePoints.length;

    let n = initialN;
    let delta = 0;
    let bias = initialBias;

    for (const currentValue of inputCodePoints) {
      if (currentValue < 0x80) {
        output.push(String.fromCharCode(currentValue));
      }
    }

    const basicLength = output.length;
    let handledCPCount = basicLength;

    if (basicLength) {
      output.push(delimiter);
    }

    while (handledCPCount < inputLength) {
      let m = maxInt;
      for (const currentValue of inputCodePoints) {
        if (currentValue >= n && currentValue < m) {
          m = currentValue;
        }
      }

      const handledCPCountPlusOne = handledCPCount + 1;
      if (m - n > Math.floor((maxInt - delta) / handledCPCountPlusOne)) {
        throw new RangeError("数值溢出");
      }

      delta += (m - n) * handledCPCountPlusOne;
      n = m;

      for (const currentValue of inputCodePoints) {
        if (currentValue < n && ++delta > maxInt) {
          throw new RangeError("数值溢出");
        }
        if (currentValue !== n) {
          continue;
        }
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (q < t) {
            break;
          }
          const qMinusT = q - t;
          const baseMinusT = base - t;
          output.push(String.fromCharCode(digitToBasic(t + (qMinusT % baseMinusT), 0)));
          q = Math.floor(qMinusT / baseMinusT);
        }
        output.push(String.fromCharCode(digitToBasic(q, 0)));
        bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
        delta = 0;
        ++handledCPCount;
      }

      ++delta;
      ++n;
    }

    return output.join("");
  };

  /** 按标签逐段处理，保留原有的分隔符 */
  const mapLabels = (string, callback) => {
    // 把全角句点等统一成 "."，与 IDNA 处理一致
    const normalized = String(string).replace(regexSeparators, ".");
    return normalized.split(".").map(callback).join(".");
  };

  /** 文本 -> Punycode（含 IDNA 的 xn-- 前缀） */
  const toPunycode = (string) =>
    mapLabels(string, (label) =>
      regexNonASCII.test(label) ? "xn--" + punycodeEncode(label) : label
    );

  /**
   * Punycode -> 文本。
   * 只解码带 xn-- 前缀的标签：普通 ASCII 文本同样是合法的 Punycode 输入，
   * 无前缀就解码会把 "hello" 这类文字变成乱码。
   */
  const fromPunycode = (string) =>
    mapLabels(string, (label) => {
      if (!regexPunycode.test(label)) {
        return label;
      }
      const payload = label.slice(4);
      if (payload === "") {
        return label;
      }
      try {
        return punycodeDecode(payload);
      } catch (e) {
        // 不是合法的 Punycode，原样返回而不是丢掉整段文本
        return label;
      }
    });

  class PunycodeChange {
    getInfo() {
      return {
        id: "punycodechange",
        name: "PunycodeChange",
        color1: "#4a90d9",
        color2: "#3a77b6",
        color3: "#2f6396",
        blocks: [
          {
            opcode: "encode",
            blockType: Scratch.BlockType.REPORTER,
            disableMonitor: false,
            text: "转Punycode [TEXT]",
            arguments: {
              TEXT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "你好世界",
              },
            },
          },
          {
            opcode: "decode",
            blockType: Scratch.BlockType.REPORTER,
            disableMonitor: false,
            text: "Punycode恢复 [TEXT]",
            arguments: {
              TEXT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "xn--6qq986b3xl",
              },
            },
          },
        ],
      };
    }

    encode(args) {
      const text = Scratch.Cast.toString(args.TEXT);
      if (text === "") {
        return "";
      }
      try {
        return toPunycode(text);
      } catch (e) {
        return "";
      }
    }

    decode(args) {
      const text = Scratch.Cast.toString(args.TEXT);
      if (text === "") {
        return "";
      }
      try {
        return fromPunycode(text);
      } catch (e) {
        return "";
      }
    }
  }

  Scratch.extensions.register(new PunycodeChange());
})(Scratch);
