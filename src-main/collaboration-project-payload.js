'use strict';

const zlib = require('zlib');
const {isProjectSnapshot} = require('./collaboration-project-policy');

// 协作消息里的工程数据有两种形态：
//   1. {format: 'sb3', data: <base64>}  —— 带资源的完整存档（正常路径）
//   2. 裸工程 JSON                        —— 旧版/降级路径
// 服务端必须在广播之前把它解成 project.json，才能做语义权限检查。这里用
// Node 内置的 zlib 读 zip 中心目录，只解压 project.json，避免把整个
// （可能几十 MB 的）资源包展开，也不引入主进程运行时依赖。

const SB3_FORMAT = 'sb3';
const MAX_PROJECT_JSON_BYTES = 32 * 1024 * 1024;
const MAX_PAYLOAD_TEXT_LENGTH = 96 * 1024 * 1024;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_ENTRY_NAME = 'project.json';

const fail = error => ({error});

const decodeBase64Strict = text => {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.length > MAX_PAYLOAD_TEXT_LENGTH) return null;
  // Buffer.from(str, 'base64') 会静默丢弃非法字符，和渲染层的 atob 行为不
  // 一致；这里先做严格校验，保证两端解出同一份字节。
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Buffer.from(text, 'base64');
};

const findEndOfCentralDirectory = buffer => {
  if (buffer.length < 22) return -1;
  const searchStart = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength > buffer.length) continue;
    return offset;
  }
  return -1;
};

const readCentralDirectoryEntry = (buffer, offset) => {
  if (offset + 46 > buffer.length) return null;
  if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) return null;

  const method = buffer.readUInt16LE(offset + 10);
  const compressedSize = buffer.readUInt32LE(offset + 20);
  const uncompressedSize = buffer.readUInt32LE(offset + 24);
  const nameLength = buffer.readUInt16LE(offset + 28);
  const extraLength = buffer.readUInt16LE(offset + 30);
  const commentLength = buffer.readUInt16LE(offset + 32);
  const localHeaderOffset = buffer.readUInt32LE(offset + 42);

  const nameEnd = offset + 46 + nameLength;
  if (nameEnd > buffer.length) return null;

  return {
    name: buffer.toString('utf8', offset + 46, nameEnd),
    method,
    compressedSize,
    uncompressedSize,
    localHeaderOffset,
    nextOffset: nameEnd + extraLength + commentLength
  };
};

const readEntryData = (buffer, entry) => {
  if (entry.compressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
    return fail('不支持 zip64 存档');
  }
  if (entry.uncompressedSize > MAX_PROJECT_JSON_BYTES) {
    return fail('project.json 过大');
  }

  const local = entry.localHeaderOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL_SIGNATURE) {
    return fail('sb3 压缩包结构损坏');
  }
  const localNameLength = buffer.readUInt16LE(local + 26);
  const localExtraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) return fail('sb3 压缩包结构损坏');

  const data = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (data.length > MAX_PROJECT_JSON_BYTES) return fail('project.json 过大');
    return {data};
  }
  if (entry.method !== 8) return fail('不支持的 sb3 压缩方式');

  try {
    return {
      data: zlib.inflateRawSync(data, {maxOutputLength: MAX_PROJECT_JSON_BYTES})
    };
  } catch (e) {
    return fail('无法解压 project.json');
  }
};

const extractProjectJSONFromZip = buffer => {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return fail('不是有效的 sb3 压缩包');

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  if (totalEntries === 0xffff) return fail('不支持 zip64 存档');
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset >= buffer.length) return fail('sb3 压缩包结构损坏');

  let offset = centralOffset;
  let entry = null;
  for (let i = 0; i < totalEntries; i++) {
    const current = readCentralDirectoryEntry(buffer, offset);
    if (!current) return fail('sb3 压缩包结构损坏');
    if (current.name === ZIP_ENTRY_NAME) {
      // 重复的 project.json 在 Node 与 JSZip 里可能解析出不同结果，直接拒绝。
      if (entry) return fail('sb3 压缩包含有重复的 project.json');
      entry = current;
    }
    offset = current.nextOffset;
  }
  if (!entry) return fail('sb3 压缩包缺少 project.json');

  const content = readEntryData(buffer, entry);
  if (content.error) return content;

  let projectJSON;
  try {
    projectJSON = JSON.parse(content.data.toString('utf8'));
  } catch (e) {
    return fail('project.json 不是有效的 JSON');
  }
  if (!isProjectSnapshot(projectJSON)) return fail('project.json 缺少有效的工程结构');
  return {projectJSON};
};

/**
 * 把协作消息里的工程数据统一解成 {projectJSON} 或 {error}。
 * @param {string|object} payload
 * @returns {{projectJSON?: object, error?: string}}
 */
const decodeProjectPayload = payload => {
  let value = payload;

  if (typeof value === 'string') {
    if (value.length > MAX_PAYLOAD_TEXT_LENGTH) return fail('项目数据过大');
    try {
      value = JSON.parse(value);
    } catch (e) {
      return fail('项目数据不是有效的 JSON');
    }
  }

  if (value === null || typeof value !== 'object') return fail('项目数据格式无效');

  if (value.format === SB3_FORMAT) {
    const buffer = decodeBase64Strict(value.data);
    if (!buffer) return fail('sb3 数据不是有效的 base64');
    return extractProjectJSONFromZip(buffer);
  }

  if (!isProjectSnapshot(value)) return fail('缺少有效的工程结构');
  return {projectJSON: value};
};

module.exports = {
  decodeProjectPayload,
  // 导出给测试脚本
  extractProjectJSONFromZip
};
