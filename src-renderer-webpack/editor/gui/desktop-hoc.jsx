import React from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {
  openLoadingProject,
  closeLoadingProject,
  openInvalidProjectModal
} from 'scratch-gui/src/reducers/modals';
import {
  requestProjectUpload,
  setProjectId,
  defaultProjectId,
  onFetchedProjectData,
  onLoadedProject,
  requestNewProject,
  LoadingState
} from 'scratch-gui/src/reducers/project-state';
import {
  setFileHandle,
  setUsername,
  setProjectError
} from 'scratch-gui/src/reducers/tw';
import {
  setViewOnly,
  setFullScreen
} from 'scratch-gui/src/reducers/mode';
import {getAutoAddExtensions} from 'scratch-gui/src/lib/tw-my-extensions';
import {manuallyTrustExtension} from 'scratch-gui/src/containers/tw-security-manager.jsx';
import {WrappedFileHandle} from './filesystem-api.js';
import {setStrings} from '../prompt/prompt.js';
import {showEncryptedSaveDialog, showPasswordDialog, setStrings as setEncryptedSaveStrings} from '../encrypted-save-dialog/encrypted-save-dialog.js';

let mountedOnce = false;
let isStageDetached = false;
let frameStreamingActive = false;
let frameAnimationId = null;
let aiListenersRegistered = false;

/**
 * @param {string} filename
 * @returns {string}
 */
const getDefaultProjectTitle = (filename) => {
  const match = filename.match(/([^/\\]+)\.(?:sb[2|3]?|np1|npnp|viewsb3)$/);
  if (!match) return filename;
  return match[1];
};

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

const handleClickAddonSettings = (search) => {
  EditorPreload.openAddonSettings(typeof search === 'string' ? search : null);
};

const handleClickNewWindow = () => {
  EditorPreload.openNewWindow();
};

const handleClickPackager = () => {
  EditorPreload.openPackager();
};

const handleClickDesktopSettings = () => {
  EditorPreload.openDesktopSettings();
};

const handleClickPrivacy = () => {
  EditorPreload.openPrivacy();
};

const handleClickAbout = () => {
  EditorPreload.openAbout();
};

const handleClickContact = () => {
  EditorPreload.openContact();
};

const handleClickAI = () => {
  EditorPreload.openAI();
};

const handleClickTodoList = () => {
  EditorPreload.openTodoList();
};

const handleClickProjectAnalysis = () => {
  EditorPreload.openProjectAnalysis();
};

const handleClickMobilePreview = () => {
  EditorPreload.openMobilePreview();
};

const handleClickSourceCode = () => {
  window.open('https://github.com/Shiyuan-318/Neowarp');
};

const handleClickFeedback = () => {
  window.open('https://github.com/Shiyuan-318/Neowarp/issues');
};

const handleDetachStage = (vm) => {
  let stageWidth = 480;
  let stageHeight = 360;
  try {
    if (vm && vm.runtime && vm.runtime.renderer) {
      stageWidth = vm.runtime.renderer._width || stageWidth;
      stageHeight = vm.runtime.renderer._height || stageHeight;
    }
  } catch (e) {
    // ignore - fall back to defaults
  }
  EditorPreload.detachStage(stageWidth, stageHeight);
};

const handleReattachStage = () => {
  EditorPreload.reattachStage();
};

const handleClickCollaborationHost = () => {
  EditorPreload.openCollaborationHost();
};

const handleClickCollaborationJoin = () => {
  EditorPreload.openCollaborationJoin();
};

const handleClickCollaborationChat = () => {
  EditorPreload.openCollaborationChat();
};

const handleClickEndCollaboration = () => {
  EditorPreload.endCollaboration();
};

const handleClickLeaveCollaboration = () => {
  EditorPreload.leaveCollaboration();
};

const startFrameStreaming = (vm) => {
  if (frameStreamingActive) return;
  frameStreamingActive = true;

  const streamFrame = () => {
    if (!frameStreamingActive || !isStageDetached) return;
    try {
      if (vm.renderer && vm.renderer.requestSnapshot) {
        // Use the renderer's built-in snapshot API
        // This properly handles preserveDrawingBuffer and renders the frame
        vm.renderer.requestSnapshot((dataURL) => {
          if (frameStreamingActive && isStageDetached) {
            EditorPreload.sendStageFrame(dataURL);
          }
        });
      }
    } catch (e) {
      // ignore
    }
    frameAnimationId = setTimeout(streamFrame, 33);
  };
  streamFrame();
};

const stopFrameStreaming = () => {
  frameStreamingActive = false;
  if (frameAnimationId !== null) {
    clearTimeout(frameAnimationId);
    frameAnimationId = null;
  }
};

const handleDetachedStageInput = (vm, inputData) => {
  try {
    if (inputData.type === 'mousedown' || inputData.type === 'mouseup' || inputData.type === 'mousemove') {
      const data = {
        x: inputData.x,
        y: inputData.y,
        canvasWidth: inputData.canvasWidth || 480,
        canvasHeight: inputData.canvasHeight || 360
      };
      if (inputData.type === 'mousedown') {
        data.isDown = true;
        data.button = inputData.button || 0;
      } else if (inputData.type === 'mouseup') {
        data.isDown = false;
        data.button = inputData.button || 0;
      }
      vm.postIOData('mouse', data);
    } else if (inputData.type === 'wheel') {
      vm.postIOData('mouseWheel', {
        deltaX: inputData.deltaX,
        deltaY: inputData.deltaY
      });
    } else if (inputData.type === 'keydown') {
      vm.postIOData('keyboard', {
        key: inputData.key,
        code: inputData.code,
        isDown: true
      });
    } else if (inputData.type === 'keyup') {
      vm.postIOData('keyboard', {
        key: inputData.key,
        code: inputData.code,
        isDown: false
      });
    }
  } catch (e) {
    // ignore
  }
};

const securityManager = {
  // Everything not specified here falls back to the scratch-gui security manager

  // Managed by Electron main process:
  canReadClipboard: () => true,
  canNotify: () => true,

  // Does not work in Electron:
  canGeolocate: () => false
};

const USERNAME_KEY = 'tw:username';
const DEFAULT_USERNAME = 'player';

// Schema mapping each Scratch opcode to its parameter layout.
// args: array of {name, kind} where kind is 'input' or 'field', in visual order.
// substack: true for C-shaped blocks; substack2: true for control_if_else.
const OPCODE_SCHEMA = {
  // Motion
  motion_movesteps: { args: [{ name: 'STEPS', kind: 'input' }] },
  motion_turnright: { args: [{ name: 'DEGREES', kind: 'input' }] },
  motion_turnleft: { args: [{ name: 'DEGREES', kind: 'input' }] },
  motion_goto: { args: [{ name: 'TO', kind: 'field' }] },
  motion_gotoxy: { args: [{ name: 'X', kind: 'input' }, { name: 'Y', kind: 'input' }] },
  motion_glideto: { args: [{ name: 'TO', kind: 'field' }, { name: 'SECS', kind: 'input' }] },
  motion_glidesecstoxy: { args: [{ name: 'SECS', kind: 'input' }, { name: 'X', kind: 'input' }, { name: 'Y', kind: 'input' }] },
  motion_pointindirection: { args: [{ name: 'DIRECTION', kind: 'input' }] },
  motion_pointtowards: { args: [{ name: 'TOWARDS', kind: 'field' }] },
  motion_changexby: { args: [{ name: 'DX', kind: 'input' }] },
  motion_setx: { args: [{ name: 'X', kind: 'input' }] },
  motion_changeyby: { args: [{ name: 'DY', kind: 'input' }] },
  motion_sety: { args: [{ name: 'Y', kind: 'input' }] },
  motion_ifonedgebounce: { args: [] },
  motion_setrotationstyle: { args: [{ name: 'STYLE', kind: 'field' }] },
  motion_xposition: { args: [] },
  motion_yposition: { args: [] },
  motion_direction: { args: [] },
  // Looks
  looks_say: { args: [{ name: 'MESSAGE', kind: 'input' }] },
  looks_sayforsecs: { args: [{ name: 'MESSAGE', kind: 'input' }, { name: 'SECS', kind: 'input' }] },
  looks_think: { args: [{ name: 'MESSAGE', kind: 'input' }] },
  looks_thinkforsecs: { args: [{ name: 'MESSAGE', kind: 'input' }, { name: 'SECS', kind: 'input' }] },
  looks_switchcostumeto: { args: [{ name: 'COSTUME', kind: 'field' }] },
  looks_nextcostume: { args: [] },
  looks_switchbackdropto: { args: [{ name: 'BACKDROP', kind: 'field' }] },
  looks_nextbackdrop: { args: [] },
  looks_changesizeby: { args: [{ name: 'CHANGE', kind: 'input' }] },
  looks_setsizeto: { args: [{ name: 'SIZE', kind: 'input' }] },
  looks_changeeffectby: { args: [{ name: 'EFFECT', kind: 'field' }, { name: 'CHANGE', kind: 'input' }] },
  looks_seteffectto: { args: [{ name: 'EFFECT', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  looks_cleargraphiceffects: { args: [] },
  looks_show: { args: [] },
  looks_hide: { args: [] },
  looks_gotofrontback: { args: [{ name: 'FRONT_BACK', kind: 'field' }] },
  looks_goforwardbackwardlayers: { args: [{ name: 'FRONT_BACK', kind: 'field' }, { name: 'NUM', kind: 'input' }] },
  looks_costumenumbername: { args: [{ name: 'NUMBER_NAME', kind: 'field' }] },
  looks_backdropnumbername: { args: [{ name: 'NUMBER_NAME', kind: 'field' }] },
  looks_size: { args: [] },
  // TurboWarp stretch blocks
  looks_setstretchto: { args: [{ name: 'STRETCHX', kind: 'input' }, { name: 'STRETCHY', kind: 'input' }] },
  looks_changestretchby: { args: [{ name: 'STRETCHX', kind: 'input' }, { name: 'STRETCHY', kind: 'input' }] },
  // Sound
  sound_play: { args: [{ name: 'SOUND_MENU', kind: 'field' }] },
  sound_playuntildone: { args: [{ name: 'SOUND_MENU', kind: 'field' }] },
  sound_stopallsounds: { args: [] },
  sound_changeeffectby: { args: [{ name: 'EFFECT', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  sound_seteffectto: { args: [{ name: 'EFFECT', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  sound_cleareffects: { args: [] },
  sound_changevolumeby: { args: [{ name: 'VOLUME', kind: 'input' }] },
  sound_setvolumeto: { args: [{ name: 'VOLUME', kind: 'input' }] },
  sound_volume: { args: [] },
  // Control
  control_wait: { args: [{ name: 'DURATION', kind: 'input' }] },
  control_wait_until: { args: [{ name: 'CONDITION', kind: 'input' }] },
  control_repeat: { args: [{ name: 'TIMES', kind: 'input' }], substack: true },
  control_forever: { args: [], substack: true },
  control_if: { args: [{ name: 'CONDITION', kind: 'input' }], substack: true },
  control_if_else: { args: [{ name: 'CONDITION', kind: 'input' }], substack: true, substack2: true },
  control_repeat_until: { args: [{ name: 'CONDITION', kind: 'input' }], substack: true },
  control_while: { args: [{ name: 'CONDITION', kind: 'input' }], substack: true },
  control_for_each: { args: [{ name: 'VARIABLE', kind: 'field' }, { name: 'VALUE', kind: 'input' }], substack: true },
  control_stop: { args: [{ name: 'STOP_OPTION', kind: 'field' }] },
  control_start_as_clone: { args: [], substack: false },
  control_create_clone_of: { args: [{ name: 'CLONE_OPTION', kind: 'field' }] },
  control_delete_this_clone: { args: [] },
  control_get_counter: { args: [] },
  control_incr_counter: { args: [] },
  control_decr_counter: { args: [] },
  control_clear_counter: { args: [] },
  control_all_at_once: { args: [], substack: true },
  // Sensing
  sensing_touchingobject: { args: [{ name: 'TOUCHINGOBJECTMENU', kind: 'field' }] },
  sensing_touchingcolor: { args: [{ name: 'COLOR', kind: 'input' }] },
  sensing_coloristouchingcolor: { args: [{ name: 'COLOR', kind: 'input' }, { name: 'COLOR2', kind: 'input' }] },
  sensing_distanceto: { args: [{ name: 'DISTANCETOMENU', kind: 'field' }] },
  sensing_askandwait: { args: [{ name: 'QUESTION', kind: 'input' }] },
  sensing_answer: { args: [] },
  sensing_keypressed: { args: [{ name: 'KEY_OPTION', kind: 'field' }] },
  sensing_mousedown: { args: [] },
  sensing_mousex: { args: [] },
  sensing_mousey: { args: [] },
  sensing_setdragmode: { args: [{ name: 'DRAG_MODE', kind: 'field' }] },
  sensing_loudness: { args: [] },
  sensing_timer: { args: [] },
  sensing_resettimer: { args: [] },
  sensing_of: { args: [{ name: 'PROPERTY', kind: 'field' }, { name: 'OBJECT', kind: 'field' }] },
  sensing_current: { args: [{ name: 'CURRENTMENU', kind: 'field' }] },
  sensing_dayssince2000: { args: [] },
  sensing_username: { args: [] },
  // Operators
  operator_add: { args: [{ name: 'NUM1', kind: 'input' }, { name: 'NUM2', kind: 'input' }] },
  operator_subtract: { args: [{ name: 'NUM1', kind: 'input' }, { name: 'NUM2', kind: 'input' }] },
  operator_multiply: { args: [{ name: 'NUM1', kind: 'input' }, { name: 'NUM2', kind: 'input' }] },
  operator_divide: { args: [{ name: 'NUM1', kind: 'input' }, { name: 'NUM2', kind: 'input' }] },
  operator_random: { args: [{ name: 'FROM', kind: 'input' }, { name: 'TO', kind: 'input' }] },
  operator_gt: { args: [{ name: 'OPERAND1', kind: 'input' }, { name: 'OPERAND2', kind: 'input' }] },
  operator_lt: { args: [{ name: 'OPERAND1', kind: 'input' }, { name: 'OPERAND2', kind: 'input' }] },
  operator_equals: { args: [{ name: 'OPERAND1', kind: 'input' }, { name: 'OPERAND2', kind: 'input' }] },
  operator_and: { args: [{ name: 'OPERAND1', kind: 'input' }, { name: 'OPERAND2', kind: 'input' }] },
  operator_or: { args: [{ name: 'OPERAND1', kind: 'input' }, { name: 'OPERAND2', kind: 'input' }] },
  operator_not: { args: [{ name: 'OPERAND', kind: 'input' }] },
  operator_join: { args: [{ name: 'STRING1', kind: 'input' }, { name: 'STRING2', kind: 'input' }] },
  operator_letter_of: { args: [{ name: 'LETTER', kind: 'input' }, { name: 'STRING', kind: 'input' }] },
  operator_length: { args: [{ name: 'STRING', kind: 'input' }] },
  operator_contains: { args: [{ name: 'STRING1', kind: 'input' }, { name: 'STRING2', kind: 'input' }] },
  operator_round: { args: [{ name: 'NUM', kind: 'input' }] },
  operator_mod: { args: [{ name: 'NUM1', kind: 'input' }, { name: 'NUM2', kind: 'input' }] },
  operator_mathop: { args: [{ name: 'OPERATOR', kind: 'field' }, { name: 'NUM', kind: 'input' }] },
  // Data
  data_setvariableto: { args: [{ name: 'VARIABLE', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  data_changevariableby: { args: [{ name: 'VARIABLE', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  data_showvariable: { args: [{ name: 'VARIABLE', kind: 'field' }] },
  data_hidevariable: { args: [{ name: 'VARIABLE', kind: 'field' }] },
  data_addtolist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'ITEM', kind: 'input' }] },
  data_deleteoflist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'INDEX', kind: 'input' }] },
  data_deletealloflist: { args: [{ name: 'LIST', kind: 'field' }] },
  data_insertatlist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'INDEX', kind: 'input' }, { name: 'ITEM', kind: 'input' }] },
  data_replaceitemoflist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'INDEX', kind: 'input' }, { name: 'ITEM', kind: 'input' }] },
  data_itemoflist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'INDEX', kind: 'input' }] },
  data_itemnumoflist: { args: [{ name: 'LIST', kind: 'field' }, { name: 'ITEM', kind: 'input' }] },
  data_lengthoflist: { args: [{ name: 'LIST', kind: 'field' }] },
  data_listcontainsitem: { args: [{ name: 'LIST', kind: 'field' }, { name: 'ITEM', kind: 'input' }] },
  data_showlist: { args: [{ name: 'LIST', kind: 'field' }] },
  data_hidelist: { args: [{ name: 'LIST', kind: 'field' }] },
  // Events
  event_whenflagclicked: { args: [] },
  event_whenkeypressed: { args: [{ name: 'KEY_OPTION', kind: 'field' }] },
  event_whenthisspriteclicked: { args: [] },
  event_whenstageclicked: { args: [] },
  event_whenbackdropswitchesto: { args: [{ name: 'BACKDROP', kind: 'field' }] },
  event_whengreaterthan: { args: [{ name: 'WHENGREATERTHANMENU', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  event_whenbroadcastreceived: { args: [{ name: 'BROADCAST_OPTION', kind: 'field' }] },
  event_broadcast: { args: [{ name: 'BROADCAST_INPUT', kind: 'input' }] },
  event_broadcastandwait: { args: [{ name: 'BROADCAST_INPUT', kind: 'input' }] },
  // Procedures (custom blocks)
  procedures_call: { args: [] }, // args handled dynamically
  // Pen extension (common)
  pen_penDown: { args: [] },
  pen_penUp: { args: [] },
  pen_setPenColorToColor: { args: [{ name: 'COLOR', kind: 'input' }] },
  pen_changePenColorParamBy: { args: [{ name: 'COLOR_PARAM', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  pen_setPenColorParamTo: { args: [{ name: 'COLOR_PARAM', kind: 'field' }, { name: 'VALUE', kind: 'input' }] },
  pen_changePenSizeBy: { args: [{ name: 'SIZE', kind: 'input' }] },
  pen_setPenSizeTo: { args: [{ name: 'SIZE', kind: 'input' }] },
  pen_clear: { args: [] }
};

// Tokenize a string of positional arguments into parsed values.
// Handles: numbers, double-quoted strings, $variables, @lists, and (opcode args...) nested reporters.
function tokenizeArgs(argsStr) {
  const args = [];
  const s = String(argsStr == null ? '' : argsStr);
  const n = s.length;
  let i = 0;
  const isWhitespace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  while (i < n) {
    while (i < n && isWhitespace(s[i])) i++;
    if (i >= n) break;
    const ch = s[i];
    if (ch === '"') {
      i++; // skip opening quote
      let str = '';
      while (i < n) {
        if (s[i] === '\\' && i + 1 < n && (s[i+1] === '"' || s[i+1] === '\\')) {
          str += s[i+1]; // unescape \" -> " and \\ -> \
          i += 2;
          continue;
        }
        if (s[i] === '"') break;
        str += s[i];
        i++;
      }
      if (i >= n) {
        throw new Error('Unclosed string literal: "' + str + '"');
      }
      i++; // skip closing quote
      args.push(str);
    } else if (ch === '(') {
      i++; // skip opening paren
      let depth = 1;
      let inner = '';
      while (i < n && depth > 0) {
        if (s[i] === '"') {
          // consume a quoted string verbatim so parens inside it don't affect depth
          inner += s[i]; i++;
          while (i < n) {
            if (s[i] === '\\' && i + 1 < n && (s[i+1] === '"' || s[i+1] === '\\')) {
              inner += s[i]; inner += s[i+1]; i += 2; continue;
            }
            if (s[i] === '"') break;
            inner += s[i]; i++;
          }
          if (i < n) { inner += s[i]; i++; } // closing quote
        } else if (s[i] === '(') {
          depth++; inner += s[i]; i++;
        } else if (s[i] === ')') {
          depth--;
          if (depth === 0) { i++; break; }
          inner += s[i]; i++;
        } else {
          inner += s[i]; i++;
        }
      }
      if (depth > 0) {
        throw new Error('Unbalanced parentheses in: ' + s.substring(Math.max(0, i - 20), i));
      }
      // inner = "opcode args..."
      let subOpcode, subArgsStr;
      const wsMatch = inner.match(/\s/);
      if (wsMatch === null) {
        subOpcode = inner;
        subArgsStr = '';
      } else {
        const wsIdx = wsMatch.index;
        subOpcode = inner.substring(0, wsIdx);
        subArgsStr = inner.substring(wsIdx + 1);
      }
      args.push({ opcode: subOpcode, args: tokenizeArgs(subArgsStr) });
    } else if (ch === '$') {
      i++; // skip $
      let name = '';
      while (i < n && !isWhitespace(s[i])) name += s[i], i++;
      args.push({ variable: name });
    } else if (ch === '@') {
      i++; // skip @
      let name = '';
      while (i < n && !isWhitespace(s[i])) name += s[i], i++;
      args.push({ list: name });
    } else {
      // number or bareword: read until whitespace
      let token = '';
      while (i < n && !isWhitespace(s[i])) token += s[i], i++;
      if (/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(token)) {
        args.push(parseFloat(token));
      } else {
        args.push(token);
      }
    }
  }
  return args;
}

// Convert a raw token (from tokenizeArgs) into an input value, applying variable/list/nested-reporter rules.
function argToInputValue(val) {
  if (val && typeof val === 'object') {
    if (val.variable) {
      return { opcode: 'data_variable', fields: { VARIABLE: val.variable } };
    }
    if (val.list) {
      return { opcode: 'data_listcontents', fields: { LIST: val.list } };
    }
    if (val.opcode) {
      return mapArgsToDescriptor(val.opcode, val.args);
    }
  }
  return val; // number or string
}

// Map an opcode + positional raw args to a block descriptor {opcode, inputs, fields}.
function mapArgsToDescriptor(opcode, rawArgs) {
  const schema = OPCODE_SCHEMA[opcode];
  const inputs = {};
  const fields = {};
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  if (schema) {
    for (let i = 0; i < args.length; i++) {
      const argDef = schema.args[i];
      const val = args[i];
      if (!argDef) {
        inputs['ARG' + (i + 1)] = argToInputValue(val);
        continue;
      }
      if (argDef.kind === 'field') {
        if (val && typeof val === 'object') {
          if (val.variable && argDef.name === 'VARIABLE') {
            fields[argDef.name] = val.variable;
          } else if (val.list && argDef.name === 'LIST') {
            fields[argDef.name] = val.list;
          } else if (val.opcode) {
            inputs[argDef.name] = argToInputValue(val);
          } else {
            fields[argDef.name] = String(val);
          }
        } else {
          fields[argDef.name] = String(val);
        }
      } else {
        inputs[argDef.name] = argToInputValue(val);
      }
    }
  } else {
    for (let i = 0; i < args.length; i++) {
      inputs['ARG' + (i + 1)] = argToInputValue(args[i]);
    }
  }
  return { opcode, inputs, fields };
}

// Parse a single DSL line (already trimmed) into {opcode, args} where args is the raw token array.
function parseDslLine(content) {
  const wsMatch = content.match(/\s/);
  if (wsMatch === null) {
    return { opcode: content, args: [] };
  }
  const wsIdx = wsMatch.index;
  const opcode = content.substring(0, wsIdx);
  const argsStr = content.substring(wsIdx + 1);
  return { opcode, args: tokenizeArgs(argsStr) };
}

// Convert a tree node (with rawArgs and child node arrays) into a block descriptor with substack/substack2.
function convertNode(node) {
  const descriptor = mapArgsToDescriptor(node.opcode, node.rawArgs);
  if (node.substack && node.substack.length > 0) {
    descriptor.substack = node.substack.map(convertNode);
  }
  if (node.substack2 && node.substack2.length > 0) {
    descriptor.substack2 = node.substack2.map(convertNode);
  }
  return descriptor;
}

// Convert a JSON block object (e.g. {"opcode":"...","inputs":{},"next":{...}}) to DSL text lines.
// IMPORTANT: the DSL is positional — parseDslLine/mapArgsToDescriptor map tokens onto
// OPCODE_SCHEMA[opcode].args by index. So arguments must be emitted in schema order,
// not "all inputs then all fields". Emitting them out of order silently swaps values
// between slots (e.g. data_setvariableto would take the number as VARIABLE and the
// variable name as VALUE, creating a bogus variable named after the value).
// Resolve a VARIABLE / LIST field to a real VM variable descriptor.
// The VM binds a block's variable field by ID: if the id is missing/unknown, Scratch
// auto-creates a *local* variable on the sprite named after whatever it finds, which is
// how a stray variable named after a value ends up on the sprite. So look the name up
// (local first, then stage) and create the variable when it genuinely does not exist,
// always returning a concrete id.
function resolveVariableField(target, key, rawName) {
  const isList = key === 'LIST';
  const type = isList ? 'list' : '';
  const name = String(rawName == null ? '' : rawName);
  let variable = target.lookupVariableByNameAndType(name, type);
  if (!variable) {
    // Prefer creating globals on the stage so every sprite can see them, matching
    // how users normally declare variables in the editor.
    const stage = target.runtime && target.runtime.getTargetForStage ? target.runtime.getTargetForStage() : null;
    const owner = stage || target;
    const newId = 'aivar_' + Math.random().toString(36).slice(2, 10);
    if (isList) {
      owner.createVariable(newId, name, 'list');
    } else {
      owner.createVariable(newId, name, '');
    }
    variable = owner.lookupVariableByNameAndType(name, type) || { id: newId, name: name };
  }
  return { name: key, value: variable.name, id: variable.id, variableType: type };
}

function convertBlockObjToDsl(obj, indent) {
  indent = indent || 0;
  var pad = '  '.repeat(indent);
  if (!obj || !obj.opcode) return [];

  var rawInputs = obj.inputs || {};
  var rawFields = obj.fields || {};

  var fieldValue = function(key) {
    var fv = rawFields[key];
    if (fv && typeof fv === 'object') fv = fv.value;
    return fv;
  };
  var encodeInput = function(val) {
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'string') return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    if (val && typeof val === 'object') {
      if (val.opcode) return '(' + convertBlockObjToDsl(val, 0).join(' ') + ')';
      // Variable/list reporter shorthand used by some callers
      if (val.VARIABLE) return '$' + val.VARIABLE;
      if (val.LIST) return '@' + val.LIST;
    }
    return null;
  };
  var encodeField = function(key) {
    var fv = fieldValue(key);
    if (fv === undefined || fv === null) return null;
    if (key === 'VARIABLE') return '$' + fv;
    if (key === 'LIST') return '@' + fv;
    return '"' + String(fv).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  };

  var parts = [obj.opcode];
  var schema = OPCODE_SCHEMA[obj.opcode];
  var usedInputs = {};
  var usedFields = {};

  if (schema && Array.isArray(schema.args)) {
    // Walk the schema in order so each token lands in its declared slot.
    for (var ai = 0; ai < schema.args.length; ai++) {
      var argDef = schema.args[ai];
      var token = null;
      if (argDef.kind === 'field') {
        if (Object.prototype.hasOwnProperty.call(rawFields, argDef.name)) {
          token = encodeField(argDef.name);
          usedFields[argDef.name] = true;
        } else if (Object.prototype.hasOwnProperty.call(rawInputs, argDef.name)) {
          // Tolerate models that put a menu value under inputs
          token = encodeInput(rawInputs[argDef.name]);
          usedInputs[argDef.name] = true;
        }
      } else {
        if (Object.prototype.hasOwnProperty.call(rawInputs, argDef.name)) {
          token = encodeInput(rawInputs[argDef.name]);
          usedInputs[argDef.name] = true;
        } else if (Object.prototype.hasOwnProperty.call(rawFields, argDef.name)) {
          token = encodeField(argDef.name);
          usedFields[argDef.name] = true;
        }
      }
      // A missing middle argument would shift every later token, so emit a
      // placeholder to keep positions aligned.
      parts.push(token === null ? (argDef.kind === 'field' ? '""' : '0') : token);
    }
  }

  // Anything the schema didn't cover (unknown opcode, extra args) keeps the old
  // inputs-then-fields order as a best effort.
  Object.keys(rawInputs).forEach(function(key) {
    if (key === 'SUBSTACK' || key === 'SUBSTACK2' || usedInputs[key]) return;
    var token = encodeInput(rawInputs[key]);
    if (token !== null) parts.push(token);
  });
  Object.keys(rawFields).forEach(function(key) {
    if (usedFields[key]) return;
    var token = encodeField(key);
    if (token !== null) parts.push(token);
  });

  var lines = [pad + parts.join(' ')];
  // Substacks may arrive either under inputs.SUBSTACK or as obj.substack
  var subSource = (obj.inputs && obj.inputs.SUBSTACK) || obj.substack;
  if (subSource) {
    var subArr = Array.isArray(subSource) ? subSource : [subSource];
    subArr.forEach(function(b) {
      convertBlockObjToDsl(b, indent + 1).forEach(function(l) { lines.push(l); });
    });
  }
  var sub2Source = (obj.inputs && obj.inputs.SUBSTACK2) || obj.substack2;
  if (sub2Source) {
    lines.push(pad + 'else');
    var sub2Arr = Array.isArray(sub2Source) ? sub2Source : [sub2Source];
    sub2Arr.forEach(function(b) {
      convertBlockObjToDsl(b, indent + 1).forEach(function(l) { lines.push(l); });
    });
  }
  if (obj.next) {
    convertBlockObjToDsl(obj.next, indent).forEach(function(l) { lines.push(l); });
  }
  return lines;
}

// Parse Scratch block DSL text into {hat: descriptor, blocks: [descriptor, ...]}.
function parseScratchDSL(scriptText, target) {
  void target; // reserved for future use; variable/list id resolution happens in buildBlockStructure
  const warnings = [];
  const rawLines = String(scriptText == null ? '' : scriptText).split('\n');
  const parsedLines = [];
  for (let li = 0; li < rawLines.length; li++) {
    const line = rawLines[li];
    // Normalize: convert leading tabs to 2 spaces each for indent calculation
    const indentMatch = line.match(/^[\t ]*/);
    const indentRaw = indentMatch ? indentMatch[0] : '';
    const indentSpaces = indentRaw.replace(/\t/g, '  ').length;
    const indent = Math.floor(indentSpaces / 2);
    const trimmed = line.replace(/^[\t ]+/, '').replace(/\s+$/, '');
    if (trimmed.length === 0 || trimmed.charAt(0) === '#') continue;
    parsedLines.push({ indent, content: trimmed, lineNo: li + 1 });
  }

  if (parsedLines.length === 0) {
    return { hat: { opcode: 'event_whenflagclicked', inputs: {}, fields: {} }, blocks: [], warnings };
  }

  // Determine hat. First line (indent 0) is the hat if it looks like one.
  const firstLine = parsedLines[0];
  let firstParsed;
  try {
    firstParsed = parseDslLine(firstLine.content);
  } catch (e) {
    throw new Error('line ' + firstLine.lineNo + ': ' + e.message + ' (near: "' + firstLine.content.substring(0, 60) + '")');
  }
  let hatDescriptor;
  let bodyStartIdx;
  const isFirstHat = firstParsed.opcode.indexOf('event_') === 0 || firstParsed.opcode === 'control_start_as_clone';
  if (isFirstHat) {
    if (!OPCODE_SCHEMA[firstParsed.opcode]) {
      warnings.push('line ' + firstLine.lineNo + ': unknown opcode "' + firstParsed.opcode + '" (not in OPCODE_SCHEMA, block may not work correctly)');
    }
    hatDescriptor = mapArgsToDescriptor(firstParsed.opcode, firstParsed.args);
    bodyStartIdx = 1;
  } else {
    hatDescriptor = { opcode: 'event_whenflagclicked', inputs: {}, fields: {} };
    bodyStartIdx = 0;
  }

  // Build the body tree using a stack.
  const rootNodes = [];
  const stack = []; // entries: {node, indent, inElse}
  for (let bi = bodyStartIdx; bi < parsedLines.length; bi++) {
    const { indent, content, lineNo } = parsedLines[bi];

    if (content === 'else') {
      // Mark the matching C-block entry (same indent) as being in its else branch.
      for (let sj = stack.length - 1; sj >= 0; sj--) {
        if (stack[sj].indent === indent) {
          stack[sj].inElse = true;
          break;
        }
      }
      continue;
    }

    let parsed;
    try {
      parsed = parseDslLine(content);
    } catch (e) {
      throw new Error('line ' + lineNo + ': ' + e.message + ' (near: "' + content.substring(0, 60) + '")');
    }
    const schema = OPCODE_SCHEMA[parsed.opcode];
    if (!schema) {
      warnings.push('line ' + lineNo + ': unknown opcode "' + parsed.opcode + '" (not in OPCODE_SCHEMA, block may not work correctly)');
    }
    const hasSubstack = !!(schema && (schema.substack === true || schema.substack2 === true));
    const node = {
      opcode: parsed.opcode,
      rawArgs: parsed.args,
      indent,
      substack: [],
      substack2: []
    };

    // Pop until top has indent < current indent.
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootNodes.push(node);
    } else {
      const top = stack[stack.length - 1];
      if (top.inElse) {
        top.node.substack2.push(node);
      } else {
        top.node.substack.push(node);
      }
    }

    if (hasSubstack) {
      stack.push({ node, indent, inElse: false });
    }
  }

  const blocks = rootNodes.map(convertNode);
  return { hat: hatDescriptor, blocks, warnings };
}

const DesktopHOC = function (WrappedComponent) {
  class DesktopComponent extends React.Component {
    constructor (props) {
      super(props);
      this.state = {
        title: '',
        collaborationState: { isCollaborating: false, role: null, onlineCount: 0, permissions: null }
      };
      this.handleUpdateProjectTitle = this.handleUpdateProjectTitle.bind(this);
      this.handleClickEncryptedSave = this.handleClickEncryptedSave.bind(this);
      this.handleSaveAsViewsb3 = this.handleSaveAsViewsb3.bind(this);

      // Changing locale always re-mounts this component
      const stateFromMain = EditorPreload.setLocale(this.props.locale);
      this.messages = stateFromMain.strings;
      setStrings({
        ok: this.messages['prompt.ok'],
        cancel: this.messages['prompt.cancel']
      });
      setEncryptedSaveStrings({
        title: this.messages['encrypted-save.title'],
        titleLabel: this.messages['encrypted-save.title-label'],
        passwordLabel: this.messages['encrypted-save.password-label'],
        confirmPasswordLabel: this.messages['encrypted-save.confirm-password-label'],
        saveButton: this.messages['encrypted-save.save-button'],
        cancelButton: this.messages['encrypted-save.cancel-button'],
        passwordMismatch: this.messages['encrypted-save.password-mismatch'],
        emptyPassword: this.messages['encrypted-save.empty-password'],
        emptyTitle: this.messages['encrypted-save.empty-title'],
        wrongPassword: this.messages['encrypted-save.wrong-password'],
        okButton: this.messages['encrypted-save.ok-button']
      });

      const storedUsername = localStorage.getItem(USERNAME_KEY);
      if (typeof storedUsername === 'string') {
        this.props.onSetReduxUsername(storedUsername);
      } else {
        this.props.onSetReduxUsername(DEFAULT_USERNAME);
      }
    }
    componentDidMount () {
      EditorPreload.setExportForPackager(() => this.props.vm.saveProjectSb3('arraybuffer')
        .then((buffer) => ({
          name: this.state.title,
          data: buffer
        })));

      EditorPreload.onStageDetached(() => {
        isStageDetached = true;
        startFrameStreaming(this.props.vm);
      });

      EditorPreload.onStageReattached(() => {
        isStageDetached = false;
        stopFrameStreaming();
      });

      EditorPreload.onDetachedStageInput((inputData) => {
        handleDetachedStageInput(this.props.vm, inputData);
      });

      // NeoWarp: Listen for collaboration state changes
      EditorPreload.onCollaborationStateChange((data) => {
        this.setState({ collaborationState: data }, () => {
          this.wrapVMWithPermissions();
        });
      });

      // NeoWarp: Collaboration - Host receives request for project JSON
      EditorPreload.onCollabRequestProjectJSON((data) => {
        try {
          const json = this.props.vm.toJSON();
          EditorPreload.sendCollabProjectJSON(json, data.targetUsername);
        } catch (e) {
          console.error('Collab: failed to export project JSON', e);
        }
      });

      // NeoWarp: Collaboration - Receive project update from host/other participant
      this._collabLoadingProject = false;
      this._collabPendingProject = null;
      EditorPreload.onCollabProjectUpdate((data) => {
        if (this._collabLoadingProject) {
          // Keep only the latest remote state; it is applied once the
          // current load and its echo-guard cooldown have settled
          this._collabPendingProject = data;
          return;
        }
        this.applyCollabProjectUpdate(data);
      });

      // NeoWarp: Collaboration - Broadcast project changes to others (debounced)
      this._collabSyncTimer = null;
      this._collabBroadcastProject = () => {
        if (this._collabSyncTimer) clearTimeout(this._collabSyncTimer);
        this._collabSyncTimer = setTimeout(() => {
          try {
            const json = this.props.vm.toJSON();
            const collabState = this.state.collaborationState;
            if (collabState && collabState.isCollaborating) {
              if (collabState.role === 'host') {
                EditorPreload.sendCollabProjectJSON(json, null);
              } else {
                EditorPreload.sendCollabProjectUpdate(json);
              }
            }
          } catch (e) {
            // ignore
          }
        }, 1000);
      };

      // Listen for VM PROJECT_CHANGED events to trigger collaboration sync
      if (this.props.vm) {
        this.props.vm.on('PROJECT_CHANGED', () => {
          if (this._collabLoadingProject) return;
          const collabState = this.state.collaborationState;
          if (collabState && collabState.isCollaborating) {
            this._collabBroadcastProject();
          }
        });
      }

      // Wrap VM methods for permission control
      this._originalDeleteSprite = null;
      this._originalLoadExtensionURL = null;
      this._vmWrapped = false;
      setTimeout(() => this.wrapVMWithPermissions(), 500);

      // Apply code area background image
      const codeBackgroundImage = EditorPreload.getCodeAreaBackgroundImage();
      if (codeBackgroundImage) {
        this.applyCodeAreaBackground(codeBackgroundImage);
      }

      // Apply stage area background image
      if (EditorPreload.getStageAreaBackgroundImage) {
        const stageBackgroundImage = EditorPreload.getStageAreaBackgroundImage();
        if (stageBackgroundImage) {
          this.applyStageAreaBackground(stageBackgroundImage);
        }
      }

      // Setup frosted glass flyout overlay (delay to ensure Blockly is ready)
      setTimeout(() => this.setupFlyoutFrostedGlass(), 1000);
      setTimeout(() => this.setupFlyoutFrostedGlass(), 3000);

      // Listen for settings changes
      window.addEventListener('focus', () => {
        const newCodeBackgroundImage = EditorPreload.getCodeAreaBackgroundImage();
        this.applyCodeAreaBackground(newCodeBackgroundImage);
        if (EditorPreload.getStageAreaBackgroundImage) {
          const newStageBackgroundImage = EditorPreload.getStageAreaBackgroundImage();
          this.applyStageAreaBackground(newStageBackgroundImage);
        }
        this.updateTopBarDeviceStats();
      });

      // NeoWarp: Top bar device stats display
      this._topBarStatsElement = null;
      this._topBarStatsInterval = null;
      this.updateTopBarDeviceStats();

      // NeoWarp: Task Manager - per-sprite stats collection
      // Must be registered before removeAllAIListeners to avoid being cleared
      EditorPreload.onRequestSpriteStats((data) => {
        try {
          var vm = this.props.vm;
          if (!vm || !vm.runtime) {
            EditorPreload.sendSpriteStats({ requestId: data.requestId, sprites: [], totalThreads: 0 });
            return;
          }
          var runtime = vm.runtime;
          var targets = runtime.targets || [];
          var threads = runtime.threads || [];

          // Count threads per target
          // Thread status constants: 0=RUNNING, 1=PROMISE_WAIT, 2=YIELD, 3=YIELD_TICK
          // For clones, attribute threads to their parent original sprite
          var spriteToOriginalId = new Map();
          for (var oi = 0; oi < targets.length; oi++) {
            var origTarget = targets[oi];
            if (origTarget && origTarget.isOriginal && origTarget.sprite) {
              spriteToOriginalId.set(origTarget.sprite, origTarget.id);
            }
          }
          var threadCounts = {};
          var threadTimes = {};
          for (var i = 0; i < threads.length; i++) {
            var t = threads[i];
            if (t && t.target) {
              var tid = t.target.id;
              // 克隆的线程归属到其父原始角色
              if (!t.target.isOriginal && t.target.sprite && spriteToOriginalId.has(t.target.sprite)) {
                tid = spriteToOriginalId.get(t.target.sprite);
              }
              threadCounts[tid] = (threadCounts[tid] || 0) + 1;
              if (t.status === 0) { // STATUS_RUNNING
                threadTimes[tid] = (threadTimes[tid] || 0) + 1;
              } else if (t.status === 1) { // STATUS_PROMISE_WAIT
                threadTimes[tid] = (threadTimes[tid] || 0) + 0.3;
              } else if (t.status === 2) { // STATUS_YIELD
                threadTimes[tid] = (threadTimes[tid] || 0) + 0.2;
              } else if (t.status === 3) { // STATUS_YIELD_TICK
                threadTimes[tid] = (threadTimes[tid] || 0) + 0.5;
              }
            }
          }

          // Calculate total active time for percentage distribution
          var totalActiveTime = 0;
          for (var key in threadTimes) {
            totalActiveTime += threadTimes[key];
          }

          var sprites = targets.filter(function(target) {
            return !Object.prototype.hasOwnProperty.call(target, 'isOriginal') || target.isOriginal;
          }).map(function(target) {
            var tid = target.id;
            var threadCount = threadCounts[tid] || 0;
            var activeTime = threadTimes[tid] || 0;
            var cpuPercent = totalActiveTime > 0 ? (activeTime / totalActiveTime) * 100 : 0;

            // Estimate memory usage from asset data
            var memKB = 0;
            // Costumes - use asset.data.length for actual byte size
            var costumes = target.getCostumes ? target.getCostumes() : [];
            for (var ci = 0; ci < costumes.length; ci++) {
              var costume = costumes[ci];
              if (costume.asset && costume.asset.data) {
                memKB += Math.round(costume.asset.data.length / 1024);
              } else if (costume.width && costume.height) {
                // Fallback: estimate from dimensions for bitmap costumes
                memKB += Math.round(costume.width * costume.height * 4 / 1024);
              } else {
                memKB += 10;
              }
            }
            // Sounds - use asset.data.length for actual byte size
            var sounds = target.getSounds ? target.getSounds() : [];
            for (var si = 0; si < sounds.length; si++) {
              var sound = sounds[si];
              if (sound.asset && sound.asset.data) {
                memKB += Math.round(sound.asset.data.length / 1024);
              } else {
                memKB += 10;
              }
            }
            // Variables and lists overhead
            var varCount = target.variables ? Object.values(target.variables).filter(v => v.type !== 'list').length : 0;
            var listCount = target.variables ? Object.values(target.variables).filter(v => v.type === 'list').length : 0;
            memKB += varCount * 0.5 + listCount * 2;

            // Block count
            var blockCount = 0;
            if (target.blocks && target.blocks._blocks) {
              blockCount = Object.keys(target.blocks._blocks).length;
            }

            return {
              id: tid,
              name: target.getName ? target.getName() : 'Unknown',
              isStage: !!target.isStage,
              threads: threadCount,
              cpuPercent: Math.round(cpuPercent * 10) / 10,
              memEstimateKB: Math.max(memKB, 1),
              blockCount: blockCount,
              costumeCount: costumes.length,
              soundCount: sounds.length,
              visible: target.visible !== undefined ? target.visible : true,
              x: target.x || 0,
              y: target.y || 0
            };
          });

          EditorPreload.sendSpriteStats({
            requestId: data.requestId,
            sprites: sprites,
            totalThreads: threads.length
          });
        } catch (e) {
          EditorPreload.sendSpriteStats({ requestId: data.requestId, sprites: [], totalThreads: 0 });
        }
      });

      // NeoWarp: AI Assistant IPC listeners
      // Always re-register listeners on mount to ensure they are active
      // Remove old listeners first to avoid duplicates
      if (typeof EditorPreload.removeAllAIListeners === 'function') {
        EditorPreload.removeAllAIListeners();
      }

      EditorPreload.onRequestProjectJSON((data) => {
        try {
          const json = this.props.vm.toJSON();
          // Calculate total asset size from runtime VM objects
          let assetSize = 0;
          const runtimeTargets = this.props.vm.runtime.targets;
          if (runtimeTargets) {
            runtimeTargets.forEach(function(target) {
              var costumes = target.getCostumes ? target.getCostumes() : [];
              for (var ci = 0; ci < costumes.length; ci++) {
                var costume = costumes[ci];
                if (costume.asset && costume.asset.data && typeof costume.asset.data === 'string') {
                  assetSize += Math.round(costume.asset.data.length * 0.75);
                } else if (costume.width && costume.height) {
                  assetSize += costume.width * costume.height * 4;
                }
              }
              var sounds = target.getSounds ? target.getSounds() : [];
              for (var si = 0; si < sounds.length; si++) {
                var sound = sounds[si];
                if (sound.asset && sound.asset.data && typeof sound.asset.data === 'string') {
                  assetSize += Math.round(sound.asset.data.length * 0.75);
                }
              }
            });
          }
          EditorPreload.sendProjectJSON({
            requestId: data.requestId,
            projectJSON: json,
            assetSize: assetSize
          });
        } catch (e) {
          EditorPreload.sendProjectJSON({
            requestId: data ? data.requestId : null,
            projectJSON: null,
            assetSize: 0
          });
        }
      });

      EditorPreload.onApplyProject(async (data) => {
        try {
          const projectData = typeof data.projectJSON === 'string' ? data.projectJSON : JSON.stringify(data.projectJSON);
          await this.props.vm.loadProject(projectData);
        } catch (e) {
          console.error('Failed to apply project:', e);
        }
      });

      EditorPreload.onApplySprite(async (data) => {
        try {
          if (data.targetId) {
            this.props.vm.deleteSprite(data.targetId);
          }
          const spriteData = typeof data.spriteJSON === 'string' ? data.spriteJSON : JSON.stringify(data.spriteJSON);
          await this.props.vm.addSprite(spriteData);
        } catch (e) {
          console.error('Failed to apply sprite:', e);
        }
      });

      EditorPreload.onAIToolCall(async (data) => {
        const { requestId, toolName, params } = data;
        if (params) {
          // Generic snake_case → camelCase mapping for all params
          Object.keys(params).forEach(function(key) {
            if (key.indexOf('_') === -1) return;
            var camelKey = key.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase(); });
            if (!params[camelKey]) params[camelKey] = params[key];
          });
        }
        const vm = this.props.vm;
        let result = { success: false, error: 'Unknown tool' };
        try {
          switch (toolName) {
            case 'setSpriteProperty': {
              const target = vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName);
              if (!target) { result = { success: false, error: 'Sprite not found' }; break; }
              if (params.x !== undefined) target.setXY(params.x, target.y);
              if (params.y !== undefined) target.setXY(target.x, params.y);
              if (params.size !== undefined) target.setSize(params.size);
              if (params.direction !== undefined) target.setDirection(params.direction);
              if (params.visible !== undefined) target.setVisible(params.visible);
              if (params.draggable !== undefined) target.draggable = params.draggable;
              if (params.rotationStyle !== undefined) target.rotationStyle = params.rotationStyle;
              result = { success: true, data: { x: target.x, y: target.y, size: target.size, direction: target.direction, visible: target.visible, draggable: target.draggable, rotationStyle: target.rotationStyle } };
              break;
            }
            case 'getSpriteProperty': {
              const target = vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName);
              if (!target) { result = { success: false, error: 'Sprite not found' }; break; }
              result = { success: true, data: { name: target.getName(), x: target.x, y: target.y, size: target.size, direction: target.direction, visible: target.visible, draggable: target.draggable, rotationStyle: target.rotationStyle, currentCostume: target.currentCostume, costumeCount: target.getCostumes().length } };
              break;
            }
            case 'getSpriteScripts': {
              const target = vm.runtime.targets.find(t => t.getName() === params.spriteName);
              if (!target) { result = { success: false, error: 'Sprite "' + params.spriteName + '" not found' }; break; }
              const scripts = [];
              const allBlocks = target.blocks._blocks;
              Object.keys(allBlocks).forEach(function(blockId) {
                var b = allBlocks[blockId];
                if (b.topLevel && b.parent === null) {
                  var dslLines = [];
                  function emitBlock(blk, ind) {
                    var pad = '  '.repeat(ind);
                    var parts = [blk.opcode];
                    var handledFieldNames = new Set();
                    if (blk.inputs) {
                      Object.keys(blk.inputs).forEach(function(key) {
                        if (key === 'SUBSTACK' || key === 'SUBSTACK2') return;
                        var inp = blk.inputs[key];
                        if (!inp || !inp.block) return;
                        var sub = allBlocks[inp.block];
                        if (!sub) return;
                        // Check if this is a shadow block (inp.block === inp.shadow means it's the default shadow, not a plugged reporter)
                        if (inp.block === inp.shadow || inp.shadow === null) {
                          // Shadow block - extract field value directly
                          if (sub.opcode === 'math_number') {
                            parts.push(String(sub.fields.NUM.value));
                          } else if (sub.opcode === 'text') {
                            parts.push('"' + String(sub.fields.TEXT.value).replace(/"/g, '\\"') + '"');
                          } else if (sub.opcode === 'data_variable') {
                            parts.push('$' + sub.fields.VARIABLE.value);
                          } else if (sub.opcode === 'data_listcontents') {
                            parts.push('@' + sub.fields.LIST.value);
                          } else {
                            // Menu shadow block (sensing_keyoptions, motion_goto_menu, etc.)
                            // Extract the first field value
                            var menuFields = sub.fields;
                            if (menuFields) {
                              var fieldKeys = Object.keys(menuFields);
                              for (var fi = 0; fi < fieldKeys.length; fi++) {
                                var mf = menuFields[fieldKeys[fi]];
                                var mfv = mf && typeof mf === 'object' ? mf.value : mf;
                                if (mfv != null) {
                                  parts.push('"' + String(mfv) + '"');
                                  break;
                                }
                              }
                            }
                          }
                          handledFieldNames.add(key);
                        } else {
                          // Actual reporter block plugged in (not shadow)
                          var subParts = [sub.opcode];
                          if (sub.inputs) {
                            Object.keys(sub.inputs).forEach(function(iKey) {
                              if (iKey === 'SUBSTACK' || iKey === 'SUBSTACK2') return;
                              var iInp = sub.inputs[iKey];
                              if (iInp && iInp.block) {
                                var iSub = allBlocks[iInp.block];
                                if (iSub) {
                                  if (iSub.opcode === 'math_number') subParts.push(String(iSub.fields.NUM.value));
                                  else if (iSub.opcode === 'text') subParts.push('"' + String(iSub.fields.TEXT.value).replace(/"/g, '\\"') + '"');
                                  else if (iSub.opcode === 'data_variable') subParts.push('$' + iSub.fields.VARIABLE.value);
                                  else if (iSub.opcode === 'data_listcontents') subParts.push('@' + iSub.fields.LIST.value);
                                  else subParts.push('(' + iSub.opcode + ')');
                                }
                              }
                            });
                          }
                          if (sub.fields) {
                            Object.keys(sub.fields).forEach(function(fKey) {
                              if (fKey === 'VARIABLE') { subParts.push('$' + sub.fields[fKey].value); return; }
                              if (fKey === 'LIST') { subParts.push('@' + sub.fields[fKey].value); return; }
                              var ffv = sub.fields[fKey];
                              if (ffv && typeof ffv === 'object') ffv = ffv.value;
                              if (ffv != null) subParts.push('"' + String(ffv) + '"');
                            });
                          }
                          parts.push('(' + subParts.join(' ') + ')');
                        }
                      });
                    }
                    if (blk.fields) {
                      Object.keys(blk.fields).forEach(function(key) {
                        if (handledFieldNames.has(key)) return;
                        if (key === 'VARIABLE') { parts.push('$' + blk.fields[key].value); return; }
                        if (key === 'LIST') { parts.push('@' + blk.fields[key].value); return; }
                        var fv = blk.fields[key];
                        if (fv && typeof fv === 'object') fv = fv.value;
                        if (fv != null) parts.push('"' + String(fv) + '"');
                      });
                    }
                    dslLines.push(pad + parts.join(' '));
                    if (blk.inputs && blk.inputs.SUBSTACK && blk.inputs.SUBSTACK.block) {
                      var sub = allBlocks[blk.inputs.SUBSTACK.block];
                      while (sub) {
                        emitBlock(sub, ind + 1);
                        sub = sub.next ? allBlocks[sub.next] : null;
                      }
                    }
                    if (blk.inputs && blk.inputs.SUBSTACK2 && blk.inputs.SUBSTACK2.block) {
                      dslLines.push(pad + 'else');
                      var sub2 = allBlocks[blk.inputs.SUBSTACK2.block];
                      while (sub2) {
                        emitBlock(sub2, ind + 1);
                        sub2 = sub2.next ? allBlocks[sub2.next] : null;
                      }
                    }
                  }
                  emitBlock(b, 0);
                  scripts.push({ blockId: blockId, dsl: dslLines.join('\n') });
                }
              });
              result = { success: true, data: { spriteName: params.spriteName, scriptCount: scripts.length, scripts: scripts } };
              break;
            }
            case 'setVariable': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const variable = Object.values(target.variables).find(v => v.name === params.variableName);
              if (variable) {
                // Convert value type: numeric strings become numbers, matching Scratch behavior
                let val = params.value;
                if (typeof val === 'string') {
                  const numVal = Number(val);
                  if (val.trim() !== '' && !isNaN(numVal)) val = numVal;
                }
                variable.value = val;
                vm.runtime.emitProjectChanged();
                vm.emitWorkspaceUpdate();
                result = { success: true, data: { name: variable.name, value: variable.value } };
              }
              else { result = { success: false, error: 'Variable not found' }; }
              break;
            }
            case 'createVariable': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const existing = Object.values(target.variables).find(v => v.name === params.variableName && v.type !== 'list');
              if (existing) { result = { success: true, data: { name: params.variableName, value: existing.value, existed: true } }; break; }
              const varId = '_ai_var_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
              target.createVariable(varId, params.variableName, '', false);
              if (params.initial_value !== undefined && target.variables[varId]) {
                // Convert initial value type: numeric strings become numbers
                let initVal = params.initial_value;
                if (typeof initVal === 'string') {
                  const numVal = Number(initVal);
                  if (initVal.trim() !== '' && !isNaN(numVal)) initVal = numVal;
                }
                target.variables[varId].value = initVal;
              }
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { name: params.variableName, value: target.variables[varId] ? target.variables[varId].value : '0', existed: false } };
              break;
            }
            case 'createList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const existing = Object.values(target.variables).find(v => v.name === params.listName && v.type === 'list');
              if (existing) { result = { success: true, data: { name: params.listName, length: Array.isArray(existing.value) ? existing.value.length : 0, existed: true } }; break; }
              const listId = '_ai_list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
              target.createVariable(listId, params.listName, 'list', false);
              // Ensure list value is initialized as an empty array
              if (target.variables[listId]) {
                if (!Array.isArray(target.variables[listId].value)) {
                  target.variables[listId].value = [];
                }
                // Set initial items if provided
                if (Array.isArray(params.items)) {
                  target.variables[listId].value = params.items.map(function(item) {
                    if (typeof item === 'string') {
                      var numVal = Number(item);
                      if (item.trim() !== '' && !isNaN(numVal)) return numVal;
                    }
                    return item;
                  });
                }
              }
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { name: params.listName, length: target.variables[listId] ? target.variables[listId].value.length : 0, existed: false } };
              break;
            }
            case 'getVariable': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const variable = Object.values(target.variables).find(v => v.name === params.variableName);
              if (variable) { result = { success: true, data: { name: variable.name, value: variable.value, isCloud: variable.isCloud } }; }
              else { result = { success: false, error: 'Variable not found' }; }
              break;
            }
            case 'addToList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              if (params.item === undefined || params.item === null) { result = { success: false, error: 'No item provided' }; break; }
              let list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (!list) {
                const listId = '_ai_list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                target.createVariable(listId, params.listName, 'list', false);
                list = target.variables[listId];
                vm.emitWorkspaceUpdate();
              }
              // Convert item type: numeric strings become numbers, matching Scratch behavior
              let itemVal = params.item;
              if (typeof itemVal === 'string') {
                const numVal = Number(itemVal);
                if (itemVal.trim() !== '' && !isNaN(numVal)) itemVal = numVal;
              }
              if (list && Array.isArray(list.value)) {
                list.value.push(itemVal);
              } else if (list) {
                list.value = [itemVal];
              }
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { listName: params.listName, length: list ? list.value.length : 0 } };
              break;
            }
            case 'deleteFromList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (list && Array.isArray(list.value)) {
                if (params.index === 'all' || params.index === 'last') {
                  if (params.index === 'all') list.value = [];
                  else list.value.pop();
                } else {
                  const idx = parseInt(params.index);
                  if (!isNaN(idx) && idx >= 1 && idx <= list.value.length) {
                    list.value.splice(idx - 1, 1);
                  } else {
                    result = { success: false, error: 'Index out of range: ' + params.index };
                    break;
                  }
                }
                vm.runtime.emitProjectChanged();
                vm.emitWorkspaceUpdate();
                result = { success: true, data: { length: list.value.length } };
              }
              else { result = { success: false, error: 'List "' + params.listName + '" not found' }; }
              break;
            }
            case 'getList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (list) { result = { success: true, data: { name: list.name, value: list.value, length: list.value.length } }; }
              else { result = { success: false, error: 'List "' + params.listName + '" not found' }; }
              break;
            }
            case 'deleteSprite': {
              const target = vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName);
              if (!target) { result = { success: false, error: 'Sprite not found' }; break; }
              vm.deleteSprite(target.id);
              result = { success: true };
              break;
            }
            case 'getAllSprites': {
              const sprites = vm.runtime.targets.filter(t => !t.isStage).map(t => ({
                id: t.id, name: t.getName(), x: t.x, y: t.y, size: t.size, direction: t.direction,
                visible: t.visible, draggable: t.draggable, rotationStyle: t.rotationStyle,
                currentCostume: t.currentCostume, costumeCount: t.getCostumes().length,
                soundCount: t.getSounds().length, variableNames: Object.values(t.variables).filter(v => v.type !== 'list').map(v => v.name),
                listNames: Object.values(t.variables).filter(v => v.type === 'list').map(v => v.name)
              }));
              result = { success: true, data: sprites };
              break;
            }
            case 'getAllVariables': {
              const allVars = [];
              vm.runtime.targets.forEach(t => {
                Object.values(t.variables).forEach(v => {
                  allVars.push({ targetName: t.getName(), name: v.name, value: v.value, isCloud: v.isCloud });
                });
              });
              result = { success: true, data: allVars };
              break;
            }
            case 'getAllLists': {
              const allLists = [];
              vm.runtime.targets.forEach(t => {
                Object.values(t.variables).filter(v => v.type === 'list').forEach(l => {
                  allLists.push({ targetName: t.getName(), name: l.name, value: l.value, length: l.value.length });
                });
              });
              result = { success: true, data: allLists };
              break;
            }
            case 'getProjectSummary': {
              const targets = vm.runtime.targets;
              const stage = targets.find(t => t.isStage);
              function getScriptInfo(t) {
                var blks = t.blocks._blocks;
                var topBlocks = [];
                Object.keys(blks).forEach(function(bId) {
                  var b = blks[bId];
                  if (b.topLevel && b.parent === null) topBlocks.push(b.opcode);
                });
                return { scriptCount: topBlocks.length, scripts: topBlocks };
              }
              const spriteList = targets.filter(t => !t.isStage).map(t => ({
                name: t.getName(), x: t.x, y: t.y, size: t.size, direction: t.direction,
                visible: t.visible, costumeCount: t.getCostumes().length,
                variables: Object.values(t.variables).filter(v => v.type !== 'list').map(v => ({ name: v.name, value: v.value })),
                lists: Object.values(t.variables).filter(v => v.type === 'list').map(v => ({ name: v.name, length: v.value.length })),
                scriptCount: getScriptInfo(t).scriptCount, scripts: getScriptInfo(t).scripts
              }));
              var stageScriptInfo = stage ? getScriptInfo(stage) : { scriptCount: 0, scripts: [] };
              result = { success: true, data: {
                spriteCount: spriteList.length, sprites: spriteList,
                stageVariables: stage ? Object.values(stage.variables).filter(v => v.type !== 'list').map(v => ({ name: v.name, value: v.value })) : [],
                stageLists: stage ? Object.values(stage.variables).filter(v => v.type === 'list').map(v => ({ name: v.name, length: v.value.length })) : [],
                stageScriptCount: stageScriptInfo.scriptCount, stageScripts: stageScriptInfo.scripts
              } };
              break;
            }
            case 'getSpriteLibrary': {
              try {
                const libModule = await import(
                  /* webpackChunkName: "sprite-library" */
                  'scratch-gui/src/lib/libraries/tw-async-libraries'
                );
                const getLib = libModule.getSpriteLibrary;
                const library = getLib();
                const libData = library && library.then ? await library : library;
                if (!libData || !Array.isArray(libData)) {
                  result = { success: false, error: 'Sprite library not available' };
                  break;
                }
                const sprites = libData.map(function(s) {
                  return { name: s.name, tags: s.tags || [] };
                });
                result = { success: true, data: { count: sprites.length, sprites: sprites } };
              } catch (e) {
                result = { success: false, error: 'Failed to load sprite library: ' + (e.message || String(e)) };
              }
              break;
            }
            case 'addSprite': {
              const spriteName = (params.spriteName || params.name || '').trim();
              if (spriteName) {
                // Named sprite: load from built-in library
                const storage = vm.runtime.storage;
                const libModule = await import(
                  /* webpackChunkName: "sprite-library" */
                  'scratch-gui/src/lib/libraries/tw-async-libraries'
                );
                const getLib = libModule.getSpriteLibrary;
                const library = getLib();
                const libData = library && library.then ? await library : library;
                if (!libData || !Array.isArray(libData) || libData.length === 0) {
                  result = { success: false, error: 'Sprite library not available' };
                  break;
                }
                const searchLower = spriteName.toLowerCase();
                let match = libData.find(s => s.name.toLowerCase() === searchLower);
                if (!match) {
                  match = libData.find(s => s.name.toLowerCase().includes(searchLower) || searchLower.includes(s.name.toLowerCase()));
                }
                if (!match) {
                  const available = libData.slice(0, 30).map(s => s.name).join(', ');
                  result = { success: false, error: 'Sprite "' + spriteName + '" not found in library. Available: ' + available };
                  break;
                }
                // Data structure: match.costumes[] is the source of truth (no top-level md5/info/json)
                const firstCostume = (match.costumes && match.costumes[0]) || {};
                const md5ext = firstCostume.md5ext || (firstCostume.assetId ? firstCostume.assetId + '.' + (firstCostume.dataFormat || 'svg') : '');
                if (!md5ext) {
                  result = { success: false, error: 'Sprite "' + spriteName + '" has no costume md5ext in library data' };
                  break;
                }
                const dotIdx = md5ext.lastIndexOf('.');
                const assetId = dotIdx > 0 ? md5ext.substring(0, dotIdx) : md5ext;
                const dataFormat = dotIdx > 0 ? md5ext.substring(dotIdx + 1) : 'svg';
                const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                let asset = null;
                try {
                  asset = await storage.load(assetType, assetId);
                } catch (loadErr) {
                  // Multi-source fallback: assets.scratch.mit.edu → cdn.assets.scratch.mit.edu
                  const assetSources = [
                    'https://assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/',
                    'https://cdn.assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/'
                  ];
                  for (let srcIdx = 0; srcIdx < assetSources.length; srcIdx++) {
                    try {
                      const buffer = await EditorPreload.fetchImage(assetSources[srcIdx]);
                      const newAssetId = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                      asset = storage.builtinHelper.get(newAssetId);
                      break;
                    } catch (fetchErr) {
                      // try next source
                    }
                  }
                  if (!asset) {
                    result = { success: false, error: 'Failed to load sprite asset "' + md5ext + '": all sources failed (assets.scratch.mit.edu and cdn.assets.scratch.mit.edu)' };
                    break;
                  }
                }
                if (!asset) {
                  result = { success: false, error: 'Failed to load sprite asset "' + md5ext + '": asset is null' };
                  break;
                }
                const rcX = firstCostume.rotationCenterX != null ? firstCostume.rotationCenterX : 47;
                const rcY = firstCostume.rotationCenterY != null ? firstCostume.rotationCenterY : 47;
                const costume = {
                  assetId: assetId,
                  name: firstCostume.name || match.name,
                  md5ext: md5ext,
                  dataFormat: dataFormat,
                  rotationCenterX: rcX,
                  rotationCenterY: rcY,
                  bitmapResolution: firstCostume.bitmapResolution || (dataFormat === 'svg' ? 1 : 2),
                  asset: asset
                };
                const spriteObj = {
                  isStage: false,
                  name: spriteName,
                  variables: {},
                  lists: {},
                  broadcasts: {},
                  blocks: {},
                  comments: {},
                  currentCostume: 0,
                  costumes: [costume],
                  sounds: [],
                  volume: 100,
                  layerOrder: vm.runtime.targets.length,
                  visible: true,
                  x: 0,
                  y: 0,
                  size: 100,
                  direction: 90,
                  draggable: false,
                  rotationStyle: 'all around'
                };
                // Load additional costumes from match.costumes array (skip index 0, already loaded)
                try {
                  if (match.sounds && match.sounds.length > 0) {
                    spriteObj.sounds = match.sounds;
                  }
                  if (match.costumes && match.costumes.length > 1) {
                    for (let ci = 1; ci < match.costumes.length; ci++) {
                      const c = match.costumes[ci];
                      const cMd5ext = c.md5ext || (c.assetId ? c.assetId + '.' + (c.dataFormat || 'svg') : '');
                      if (!cMd5ext) continue;
                      const cDotIdx = cMd5ext.lastIndexOf('.');
                      const cAssetId = cDotIdx > 0 ? cMd5ext.substring(0, cDotIdx) : cMd5ext;
                      const cDataFormat = cDotIdx > 0 ? cMd5ext.substring(cDotIdx + 1) : 'svg';
                      const cAssetType = cDataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                      let cAsset = null;
                      try { cAsset = await storage.load(cAssetType, cAssetId); } catch (e) {}
                      if (!cAsset) {
                        const cSources = [
                          'https://assets.scratch.mit.edu/internalapi/asset/' + cMd5ext + '/get/',
                          'https://cdn.assets.scratch.mit.edu/internalapi/asset/' + cMd5ext + '/get/'
                        ];
                        for (let csIdx = 0; csIdx < cSources.length; csIdx++) {
                          try {
                            const cBuf = await EditorPreload.fetchImage(cSources[csIdx]);
                            const cAid = storage.builtinHelper._store(cAssetType, cDataFormat, new Uint8Array(cBuf), null);
                            cAsset = storage.builtinHelper.get(cAid);
                            break;
                          } catch (e2) {}
                        }
                      }
                      if (cAsset) {
                        spriteObj.costumes.push({
                          assetId: cAssetId,
                          name: c.name || 'costume' + (ci + 1),
                          md5ext: cMd5ext,
                          dataFormat: cDataFormat,
                          rotationCenterX: c.rotationCenterX != null ? c.rotationCenterX : 47,
                          rotationCenterY: c.rotationCenterY != null ? c.rotationCenterY : 47,
                          bitmapResolution: c.bitmapResolution || (cDataFormat === 'svg' ? 1 : 2),
                          asset: cAsset
                        });
                      }
                    }
                  }
                } catch (multiCostumeErr) {
                  // Multi-costume loading failed, continue with single costume
                }
                await vm.addSprite(spriteObj);
                const newTarget = vm.runtime.targets[vm.runtime.targets.length - 1];
                result = { success: true, data: { name: spriteName, id: newTarget ? newTarget.id : null, source: 'library', matchedName: match.name } };
              } else {
                // No spriteName: create blank rectangle sprite
                try {
                const blankName = 'Sprite' + (vm.runtime.targets.length);
                const storage = vm.runtime.storage;
                const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#4c97ff"/></svg>';
                const data = new TextEncoder().encode(svgContent);
                const assetId = storage.builtinHelper._store(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, null);
                const asset = storage.builtinHelper.get(assetId);
                const costume = { assetId: assetId, name: 'costume1', md5ext: assetId + '.svg', dataFormat: 'svg', rotationCenterX: 50, rotationCenterY: 50, bitmapResolution: 1, asset: asset };
                const spriteObj = { isStage: false, name: blankName, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [costume], sounds: [], volume: 100, layerOrder: vm.runtime.targets.length, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' };
                await vm.addSprite(spriteObj);
                const newTarget = vm.runtime.targets[vm.runtime.targets.length - 1];
                result = { success: true, data: { name: blankName, id: newTarget ? newTarget.id : null, source: 'blank' } };
                } catch (blankErr) { result = { success: false, error: 'Failed to add blank sprite: ' + (blankErr.message || String(blankErr)) }; }
              }
              break;
            }
            case 'addSpriteFromLibrary': {
              try {
                const spriteName = (params.spriteName || params.name || '').trim();
                if (!spriteName) { result = { success: false, error: 'No sprite name provided' }; break; }
                const storage = vm.runtime.storage;
                const libModule = await import(
                  /* webpackChunkName: "sprite-library" */
                  'scratch-gui/src/lib/libraries/tw-async-libraries'
                );
                const getLib = libModule.getSpriteLibrary;
                const library = getLib();
                const libData = library && library.then ? await library : library;
                if (!libData || !Array.isArray(libData) || libData.length === 0) {
                  result = { success: false, error: 'Sprite library not available' };
                  break;
                }
                const searchLower = spriteName.toLowerCase();
                let match = libData.find(s => s.name.toLowerCase() === searchLower);
                if (!match) {
                  match = libData.find(s => s.name.toLowerCase().includes(searchLower) || searchLower.includes(s.name.toLowerCase()));
                }
                if (!match) {
                  const available = libData.slice(0, 30).map(s => s.name).join(', ');
                  result = { success: false, error: 'Sprite "' + spriteName + '" not found in library. Available: ' + available };
                  break;
                }
                const firstCostume = (match.costumes && match.costumes[0]) || {};
                const md5ext = firstCostume.md5ext || (firstCostume.assetId ? firstCostume.assetId + '.' + (firstCostume.dataFormat || 'svg') : '');
                if (!md5ext) {
                  result = { success: false, error: 'Sprite "' + spriteName + '" has no costume md5ext in library data' };
                  break;
                }
                const dotIdx = md5ext.lastIndexOf('.');
                const assetId = dotIdx > 0 ? md5ext.substring(0, dotIdx) : md5ext;
                const dataFormat = dotIdx > 0 ? md5ext.substring(dotIdx + 1) : 'svg';
                const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                let asset = null;
                try {
                  asset = await storage.load(assetType, assetId);
                } catch (loadErr) {
                  // Multi-source fallback: assets.scratch.mit.edu → cdn.assets.scratch.mit.edu
                  const assetSources = [
                    'https://assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/',
                    'https://cdn.assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/'
                  ];
                  for (let srcIdx = 0; srcIdx < assetSources.length; srcIdx++) {
                    try {
                      const buffer = await EditorPreload.fetchImage(assetSources[srcIdx]);
                      const newAssetId = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                      asset = storage.builtinHelper.get(newAssetId);
                      break;
                    } catch (fetchErr) {
                      // try next source
                    }
                  }
                  if (!asset) {
                    result = { success: false, error: 'Failed to load sprite asset "' + md5ext + '": all sources failed' };
                    break;
                  }
                }
                if (!asset) {
                  result = { success: false, error: 'Failed to load sprite asset "' + md5ext + '": asset is null' };
                  break;
                }
                const rcX = firstCostume.rotationCenterX != null ? firstCostume.rotationCenterX : 47;
                const rcY = firstCostume.rotationCenterY != null ? firstCostume.rotationCenterY : 47;
                const costume = {
                  assetId: assetId,
                  name: firstCostume.name || match.name,
                  md5ext: md5ext,
                  dataFormat: dataFormat,
                  rotationCenterX: rcX,
                  rotationCenterY: rcY,
                  bitmapResolution: firstCostume.bitmapResolution || (dataFormat === 'svg' ? 1 : 2),
                  asset: asset
                };
                const spriteObj = {
                  isStage: false, name: match.name, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                  currentCostume: 0, costumes: [costume], sounds: match.sounds || [], volume: 100,
                  layerOrder: vm.runtime.targets.length, visible: true, x: 0, y: 0, size: 100, direction: 90,
                  draggable: false, rotationStyle: 'all around'
                };
                await vm.addSprite(spriteObj);
                const newTarget = vm.runtime.targets[vm.runtime.targets.length - 1];
                result = { success: true, data: { name: match.name, id: newTarget ? newTarget.id : null } };
              } catch (e2) { result = { success: false, error: 'Failed to add sprite from library: ' + (e2.message || String(e2)) }; }
              break;
            }
            case 'addCostumeFromLibrary': {
              try {
                const spriteName = params.spriteName || '';
                const costumeName = (params.costumeName || params.name || '').trim();
                if (!costumeName) { result = { success: false, error: 'No costume name provided' }; break; }
                const target = vm.runtime.targets.find(t => t.getName() === spriteName);
                if (!target) { result = { success: false, error: 'Sprite "' + spriteName + '" not found' }; break; }
                const storage = vm.runtime.storage;
                const libModule = await import(
                  /* webpackChunkName: "costume-library" */
                  'scratch-gui/src/lib/libraries/tw-async-libraries'
                );
                const getLib = libModule.getCostumeLibrary;
                const library = getLib();
                const libData = library && library.then ? await library : library;
                if (!libData || !Array.isArray(libData) || libData.length === 0) {
                  result = { success: false, error: 'Costume library not available' };
                  break;
                }
                const searchLower = costumeName.toLowerCase();
                let match = libData.find(c => c.name.toLowerCase() === searchLower);
                if (!match) {
                  match = libData.find(c => c.name.toLowerCase().includes(searchLower) || searchLower.includes(c.name.toLowerCase()));
                }
                if (!match) {
                  const available = libData.slice(0, 30).map(c => c.name).join(', ');
                  result = { success: false, error: 'Costume "' + costumeName + '" not found. Available: ' + available };
                  break;
                }
                const md5ext = match.md5ext;
                const dotIdx = md5ext.lastIndexOf('.');
                const assetId = dotIdx > 0 ? md5ext.substring(0, dotIdx) : md5ext;
                const dataFormat = dotIdx > 0 ? md5ext.substring(dotIdx + 1) : 'svg';
                const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                let asset = null;
                try {
                  asset = await storage.load(assetType, assetId);
                } catch (loadErr) {
                  // Multi-source fallback: assets.scratch.mit.edu → cdn.assets.scratch.mit.edu
                  const assetSources = [
                    'https://assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/',
                    'https://cdn.assets.scratch.mit.edu/internalapi/asset/' + md5ext + '/get/'
                  ];
                  for (let srcIdx = 0; srcIdx < assetSources.length; srcIdx++) {
                    try {
                      const buffer = await EditorPreload.fetchImage(assetSources[srcIdx]);
                      const newAssetId = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                      asset = storage.builtinHelper.get(newAssetId);
                      break;
                    } catch (fetchErr) {
                      // try next source
                    }
                  }
                  if (!asset) {
                    result = { success: false, error: 'Failed to load costume asset "' + md5ext + '": all sources failed (assets.scratch.mit.edu and cdn.assets.scratch.mit.edu)' };
                    break;
                  }
                }
                if (!asset) {
                  result = { success: false, error: 'Failed to load costume asset "' + md5ext + '": asset is null after load attempts' };
                  break;
                }
                const rcX = match.rotationCenterX != null ? match.rotationCenterX : 47;
                const rcY = match.rotationCenterY != null ? match.rotationCenterY : 47;
                const costume = {
                  assetId: assetId, name: match.name, md5ext: md5ext, dataFormat: dataFormat,
                  rotationCenterX: rcX, rotationCenterY: rcY,
                  bitmapResolution: match.bitmapResolution || (dataFormat === 'svg' ? 1 : 2), asset: asset
                };
                target.addCostume(costume);
                target.setCostume(target.getCostumes().length - 1);
                vm.runtime.emitProjectChanged();
                result = { success: true, data: { costumeName: match.name, spriteName: spriteName } };
              } catch (e2) { result = { success: false, error: 'Failed to add costume from library: ' + (e2.message || String(e2)) }; }
              break;
            }
            case 'addBackdrop': {
              try {
                const backdropName = params.backdropName || 'Backdrop';
                const storage = vm.runtime.storage;
                const bgColors = { space: '#0a0a2e', arctic: '#d6eaf8', underwater: '#1a5276', desert: '#e8c27a', forest: '#1e5631', night: '#0a0a1a', city: '#4a5568', castle: '#5c4033', garden: '#7dcea0', savanna: '#c9a96e', classroom: '#fef9e7', room: '#e8dcc8', beach: '#f9e79f', mountain: '#7f8c8d', rainbow: '#e8daef' };
                const searchName = (backdropName || '').toLowerCase();
                let bgColor = '#5cb1d6';
                Object.keys(bgColors).forEach(k => { if (searchName.includes(k)) bgColor = bgColors[k]; });
                const backdropSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + bgColor + '" stop-opacity="0.9"/><stop offset="100%" stop-color="' + bgColor + '" stop-opacity="0.5"/></linearGradient></defs><rect width="480" height="360" fill="url(#g)"/><rect width="480" height="360" fill="' + bgColor + '" opacity="0.4"/></svg>';
                const data = new TextEncoder().encode(backdropSvg);
                const assetId = storage.builtinHelper._store(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, null);
                const asset = storage.builtinHelper.get(assetId);
                const costume = { name: backdropName, assetId: assetId, md5ext: assetId + '.svg', dataFormat: 'svg', rotationCenterX: 240, rotationCenterY: 180, bitmapResolution: 1, asset: asset };
                await vm.addBackdrop(costume.md5ext, costume);
                result = { success: true, data: { name: backdropName } };
              } catch (e2) { result = { success: false, error: 'Failed to add backdrop: ' + (e2.message || String(e2)) }; }
              break;
            }
            case 'addScript': {
              try {
                const targetName = params.spriteName || params.sprite_name || 'Stage';
                const target = vm.runtime.targets.find(t => t.getName() === targetName);
                if (!target) { result = { success: false, error: 'Target "' + targetName + '" not found' }; break; }
                let scriptText = params.script || '';
                if (!scriptText) { result = { success: false, error: 'No script provided. You passed: ' + JSON.stringify(params).substring(0, 200) + '. The "script" parameter MUST be a DSL text string like "event_whenflagclicked\\n  motion_movesteps 10", NOT a JSON object.' }; break; }
                if (typeof scriptText === 'object') {
                  try {
                    var converted = convertBlockObjToDsl(scriptText, 0);
                    scriptText = converted.join('\n');
                  } catch (convErr) {
                    result = { success: false, error: 'Failed to convert script object to DSL text: ' + (convErr.message || String(convErr)) + '. Please pass a DSL text string instead. Example: "event_whenflagclicked\\n  motion_movesteps 10"' };
                    break;
                  }
                }
                if (typeof scriptText !== 'string') { result = { success: false, error: 'Script must be a DSL text string (not ' + typeof scriptText + '). Example: "event_whenflagclicked\\n  motion_movesteps 10"' }; break; }
                let parsed;
                try {
                  parsed = parseScratchDSL(scriptText, target);
                } catch (parseErr) {
                  result = { success: false, error: 'DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nScript text (first 500 chars):\n' + scriptText.substring(0, 500) };
                  break;
                }
                var dslWarnings = (parsed.warnings && parsed.warnings.length > 0)
                  ? parsed.warnings.join('; ')
                  : '';

                // Menu shadow opcodes: map of block opcode -> { inputName: menuOpcode }
                // These dropdown menus are required by Scratch for blocks to render correctly.
                const MENU_SHADOW_OPCODES = {
                  motion_goto: { TO: 'motion_goto_menu' },
                  motion_glideto: { TO: 'motion_glideto_menu' },
                  motion_pointtowards: { TOWARDS: 'motion_pointtowards_menu' },
                  sensing_touchingobject: { TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu' },
                  sensing_distanceto: { DISTANCETOMENU: 'sensing_distancetomenu' },
                  sensing_keypressed: { KEY_OPTION: 'sensing_keyoptions' },
                  control_create_clone_of: { CLONE_OPTION: 'control_create_clone_of_menu' }
                };

                function generateId() { return '_ai_' + Math.random().toString(36).substr(2, 9); }

                function createShadowBlock(parentId, inputName, value) {
                  const sid = generateId();
                  if (typeof value === 'number') {
                    return [{ id: sid, opcode: 'math_number', fields: { NUM: { name: 'NUM', value: value } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (typeof value === 'string') {
                    return [{ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (typeof value === 'boolean') {
                    return [{ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value ? 'true' : 'false' } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (value && typeof value === 'object' && value.VARIABLE) {
                    const vf = resolveVariableField(target, 'VARIABLE', value.VARIABLE);
                    return [{ id: sid, opcode: 'data_variable', fields: { VARIABLE: vf }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (value && typeof value === 'object' && value.LIST) {
                    const lf = resolveVariableField(target, 'LIST', value.LIST);
                    return [{ id: sid, opcode: 'data_listcontents', fields: { LIST: lf }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  return [null, { name: inputName, block: null, shadow: null }];
                }

                // Recursively build a block (and its nested reporters/substacks) into allBlocks.
                // Supports: nested reporter blocks (val.opcode), SUBSTACK/SUBSTACK2 arrays,
                // scriptObj.substack/substack2, scriptObj.next chaining, and menu shadow fields.
                function buildBlockStructure(scriptObj, allBlocks) {
                  if (!scriptObj || !scriptObj.opcode) return null;
                  const blockId = generateId();
                  const inputs = {};
                  const rawInputs = scriptObj.inputs || {};
                  const menuMap = MENU_SHADOW_OPCODES[scriptObj.opcode] || {};

                  Object.keys(rawInputs).forEach(key => {
                    const val = rawInputs[key];
                    if (val && typeof val === 'object' && val.opcode) {
                      // Nested reporter block (e.g. operator_add inside motion_movesteps)
                      const nestedId = buildBlockStructure(val, allBlocks);
                      if (nestedId) {
                        inputs[key] = { name: key, block: nestedId };
                        const nestedDef = allBlocks.find(ab => ab.id === nestedId);
                        if (nestedDef) nestedDef.parent = blockId;
                      }
                    } else if (key === 'SUBSTACK' || key === 'SUBSTACK2') {
                      if (Array.isArray(val)) {
                        const subId = buildSubstackChain(val, allBlocks);
                        if (subId) inputs[key] = { name: key, block: subId };
                      }
                    } else {
                      const [shadowBlock, inputRef] = createShadowBlock(blockId, key, val);
                      if (shadowBlock) allBlocks.push(shadowBlock);
                      if (inputRef) inputs[key] = inputRef;
                    }
                  });

                  const fields = {};
                  if (scriptObj.fields) {
                    Object.keys(scriptObj.fields).forEach(key => {
                      if (menuMap[key]) {
                        // Create a menu shadow dropdown block for this field
                        const menuOpcode = menuMap[key];
                        const menuId = generateId();
                        allBlocks.push({ id: menuId, opcode: menuOpcode, next: null, parent: blockId, inputs: {}, fields: { [key]: { name: key, value: String(scriptObj.fields[key]), id: undefined } }, shadow: true, topLevel: false, x: 0, y: 0 });
                        inputs[key] = { name: key, block: menuId, shadow: menuId };
                      } else if (key === 'VARIABLE') {
                        fields[key] = resolveVariableField(target, 'VARIABLE', scriptObj.fields[key]);
                      } else if (key === 'LIST') {
                        fields[key] = resolveVariableField(target, 'LIST', scriptObj.fields[key]);
                      } else {
                        fields[key] = { name: key, value: String(scriptObj.fields[key]), id: undefined };
                      }
                    });
                  }

                  const blockDef = { id: blockId, opcode: scriptObj.opcode, next: null, parent: null, inputs: inputs, fields: fields, shadow: false, topLevel: false, x: 0, y: 0 };
                  allBlocks.push(blockDef);

                  // Substack arrays passed via scriptObj.substack / scriptObj.substack2
                  if (scriptObj.substack && Array.isArray(scriptObj.substack)) {
                    const substackId = buildSubstackChain(scriptObj.substack, allBlocks, blockId);
                    if (substackId) blockDef.inputs.SUBSTACK = { name: 'SUBSTACK', block: substackId, shadow: null };
                  }
                  if (scriptObj.substack2 && Array.isArray(scriptObj.substack2)) {
                    const substack2Id = buildSubstackChain(scriptObj.substack2, allBlocks, blockId);
                    if (substack2Id) blockDef.inputs.SUBSTACK2 = { name: 'SUBSTACK2', block: substack2Id, shadow: null };
                  }

                  // Chained next block
                  if (scriptObj.next) {
                    const nextId = buildBlockStructure(scriptObj.next, allBlocks);
                    if (nextId) blockDef.next = nextId;
                  }

                  return blockId;
                }

                function buildSubstackChain(substackArray, allBlocks, parentBlockId) {
                  if (!Array.isArray(substackArray) || substackArray.length === 0) return null;
                  var firstId = null;
                  var prevId = null;
                  for (var si = 0; si < substackArray.length; si++) {
                    var subId = buildBlockStructure(substackArray[si], allBlocks);
                    if (!subId) continue;
                    if (firstId === null) firstId = subId;
                    var curDef = allBlocks.find(ab => ab.id === subId);
                    if (curDef) curDef.parent = prevId || parentBlockId;
                    if (prevId) {
                      var prevDef = allBlocks.find(ab => ab.id === prevId);
                      if (prevDef) prevDef.next = subId;
                    }
                    prevId = subId;
                  }
                  return firstId;
                }

                const allBlocks = [];
                const hatId = buildBlockStructure(parsed.hat, allBlocks);
                if (hatId) {
                  const hatBlockDef = allBlocks.find(b => b.id === hatId);
                  if (hatBlockDef) {
                    hatBlockDef.topLevel = true;
                    hatBlockDef.x = 100 + Math.random() * 200;
                    hatBlockDef.y = 100 + Math.random() * 200;
                  }
                }
                let prevId = hatId;
                parsed.blocks.forEach(block => {
                  const blockId = buildBlockStructure(block, allBlocks);
                  if (blockId) {
                    const prevBlock = allBlocks.find(b => b.id === prevId);
                    if (prevBlock) prevBlock.next = blockId;
                    const curBlock = allBlocks.find(b => b.id === blockId);
                    if (curBlock) curBlock.parent = prevId;
                    prevId = blockId;
                  }
                });
                allBlocks.forEach(b => { target.blocks.createBlock(b); });
                vm.runtime.emitProjectChanged();
                vm.emitWorkspaceUpdate();
                vm.emitTargetsUpdate();
                result = { success: true, data: { targetName: targetName, blocksAdded: allBlocks.length, warnings: dslWarnings || undefined } };
              } catch (e2) {
                result = {
                  success: false,
                  error: 'Failed to add blocks: ' + (e2.message || String(e2)) +
                    '\nBlocks attempted: ' + (typeof allBlocks !== 'undefined' ? allBlocks.length : 0) +
                    '\nLast opcode: ' + (typeof allBlocks !== 'undefined' && allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].opcode : 'unknown')
                };
              }
              break;
            }
            case 'executeOperations': {
              try {
                const operationsStr = params.operations || '[]';
                const contextMapping = params.contextMapping || {};
                const operations = typeof operationsStr === 'string' ? JSON.parse(operationsStr) : operationsStr;
                if (!Array.isArray(operations)) { result = { success: false, error: 'operations must be an array' }; break; }

                const opResults = [];

                function generateId() { return '_ai_' + Math.random().toString(36).substr(2, 9); }

                function resolveBlockId(tid) {
                  const entry = contextMapping[tid];
                  if (!entry) return null;
                  const target = vm.runtime.targets.find(t => t.getName() === entry.sprite);
                  if (!target) return null;
                  const block = target.blocks.getBlock(entry.blockId);
                  return block ? { blockId: entry.blockId, target: target } : null;
                }

                function getTarget(spriteName) {
                  return vm.runtime.targets.find(t => t.getName() === spriteName) || null;
                }

                function createShadowBlock(parentId, inputName, value, target) {
                  const sid = generateId();
                  if (typeof value === 'number') {
                    return [{ id: sid, opcode: 'math_number', fields: { NUM: { name: 'NUM', value: value } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (typeof value === 'string') {
                    return [{ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (typeof value === 'boolean') {
                    return [{ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value ? 'true' : 'false' } }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (value && typeof value === 'object' && value.VARIABLE) {
                    const vf = resolveVariableField(target, 'VARIABLE', value.VARIABLE);
                    return [{ id: sid, opcode: 'data_variable', fields: { VARIABLE: vf }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  if (value && typeof value === 'object' && value.LIST) {
                    const lf = resolveVariableField(target, 'LIST', value.LIST);
                    return [{ id: sid, opcode: 'data_listcontents', fields: { LIST: lf }, inputs: {}, next: null, parent: parentId, shadow: true, topLevel: false, x: 0, y: 0 }, { name: inputName, block: sid, shadow: sid }];
                  }
                  return [null, { name: inputName, block: null, shadow: null }];
                }

                function buildBlockStructure(scriptObj, target, allBlocks) {
                  if (!scriptObj || !scriptObj.opcode) return null;
                  const blockId = generateId();
                  const inputs = {};
                  const rawInputs = scriptObj.inputs || {};

                  const MENU_SHADOW_OPCODES = {
                    motion_goto: { TO: 'motion_goto_menu' },
                    motion_glideto: { TO: 'motion_glideto_menu' },
                    motion_pointtowards: { TOWARDS: 'motion_pointtowards_menu' },
                    sensing_touchingobject: { TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu' },
                    sensing_distanceto: { DISTANCETOMENU: 'sensing_distancetomenu' },
                    sensing_keypressed: { KEY_OPTION: 'sensing_keyoptions' },
                    control_create_clone_of: { CLONE_OPTION: 'control_create_clone_of_menu' }
                  };

                  const menuMap = MENU_SHADOW_OPCODES[scriptObj.opcode] || {};

                  Object.keys(rawInputs).forEach(key => {
                    const val = rawInputs[key];
                    if (val && typeof val === 'object' && val.opcode) {
                      const nestedId = buildBlockStructure(val, target, allBlocks);
                      if (nestedId) inputs[key] = { name: key, block: nestedId };
                    } else if (key === 'SUBSTACK' || key === 'SUBSTACK2') {
                      if (Array.isArray(val)) {
                        var prevSubId = null;
                        val.forEach(function(subBlock) {
                          const subId = buildBlockStructure(subBlock, target, allBlocks);
                          if (subId) {
                            if (!inputs[key]) inputs[key] = { name: key, block: subId };
                            if (prevSubId) {
                              var prevB = allBlocks.find(function(ab) { return ab.id === prevSubId; });
                              if (prevB) prevB.next = subId;
                            }
                            prevSubId = subId;
                          }
                        });
                      }
                    } else {
                      const [shadowBlock, inputRef] = createShadowBlock(blockId, key, val, target);
                      if (shadowBlock) allBlocks.push(shadowBlock);
                      if (inputRef) inputs[key] = inputRef;
                    }
                  });

                  const fields = {};
                  if (scriptObj.fields) {
                    Object.keys(scriptObj.fields).forEach(key => {
                      if (menuMap[key]) {
                        const menuOpcode = menuMap[key];
                        const menuId = generateId();
                        const menuBlock = { id: menuId, opcode: menuOpcode, next: null, parent: blockId, inputs: {}, fields: { [key]: { name: key, value: String(scriptObj.fields[key]), id: undefined } }, shadow: true, topLevel: false, x: 0, y: 0 };
                        allBlocks.push(menuBlock);
                        inputs[key] = { name: key, block: menuId, shadow: menuId };
                      } else if (key === 'VARIABLE') {
                        fields[key] = resolveVariableField(target, 'VARIABLE', scriptObj.fields[key]);
                      } else if (key === 'LIST') {
                        fields[key] = resolveVariableField(target, 'LIST', scriptObj.fields[key]);
                      } else {
                        fields[key] = { name: key, value: String(scriptObj.fields[key]), id: undefined };
                      }
                    });
                  }

                  const blockDef = { id: blockId, opcode: scriptObj.opcode, next: null, parent: null, inputs: inputs, fields: fields, shadow: false, topLevel: false, x: 0, y: 0 };
                  allBlocks.push(blockDef);

                  if (scriptObj.substack && Array.isArray(scriptObj.substack)) {
                    const substackId = buildSubstackChain(scriptObj.substack, target, allBlocks, blockId);
                    if (substackId) blockDef.inputs.SUBSTACK = { name: 'SUBSTACK', block: substackId, shadow: null };
                  }
                  if (scriptObj.substack2 && Array.isArray(scriptObj.substack2)) {
                    const substack2Id = buildSubstackChain(scriptObj.substack2, target, allBlocks, blockId);
                    if (substack2Id) blockDef.inputs.SUBSTACK2 = { name: 'SUBSTACK2', block: substack2Id, shadow: null };
                  }

                  if (scriptObj.next) {
                    const nextId = buildBlockStructure(scriptObj.next, target, allBlocks);
                    if (nextId) blockDef.next = nextId;
                  }

                  return blockId;
                }

                function buildSubstackChain(substackArray, target, allBlocks, parentBlockId) {
                  if (!Array.isArray(substackArray) || substackArray.length === 0) return null;
                  var firstId = null;
                  var prevId = null;
                  for (var si = 0; si < substackArray.length; si++) {
                    var subId = buildBlockStructure(substackArray[si], target, allBlocks);
                    if (!subId) continue;
                    if (firstId === null) firstId = subId;
                    var curDef = allBlocks.find(function(ab) { return ab.id === subId; });
                    if (curDef) curDef.parent = prevId || parentBlockId;
                    if (prevId) {
                      var prevDef = allBlocks.find(function(ab) { return ab.id === prevId; });
                      if (prevDef) prevDef.next = subId;
                    }
                    prevId = subId;
                  }
                  return firstId;
                }

                for (let opIdx = 0; opIdx < operations.length; opIdx++) {
                  const op = operations[opIdx];
                  try {
                    switch (op.type) {
                      case 'add_script': {
                        const target = getTarget(op.sprite);
                        if (!target) { opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'Sprite not found: ' + op.sprite }); break; }
                        let scriptText = op.script;
                        if (!scriptText) { opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'No script provided. You passed: ' + JSON.stringify(op).substring(0, 200) + '. The "script" field MUST be a DSL text string like "event_whenflagclicked\\n  motion_movesteps 10", NOT a JSON object.' }); break; }
                        if (typeof scriptText === 'object') {
                          try {
                            var eoConverted = convertBlockObjToDsl(scriptText, 0);
                            scriptText = eoConverted.join('\n');
                          } catch (eoConvErr) {
                            opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'Failed to convert script object to DSL: ' + (eoConvErr.message || String(eoConvErr)) });
                            break;
                          }
                        }
                        if (typeof scriptText !== 'string') { opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'Script must be a DSL text string (not ' + typeof scriptText + '). Example: "event_whenflagclicked\\n  motion_movesteps 10"' }); break; }
                        let parsed;
                        try {
                          parsed = parseScratchDSL(scriptText, target);
                        } catch (parseErr) {
                          opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nScript text (first 500 chars):\n' + scriptText.substring(0, 500) });
                          break;
                        }
                        var eoWarnings = (parsed.warnings && parsed.warnings.length > 0)
                          ? parsed.warnings.join('; ')
                          : '';
                        const allBlocks = [];
                        const hatId = buildBlockStructure(parsed.hat, target, allBlocks);
                        if (hatId) {
                          const hatDef = allBlocks.find(b => b.id === hatId);
                          if (hatDef) {
                            hatDef.topLevel = true;
                            hatDef.x = 100 + Math.random() * 200;
                            hatDef.y = 100 + Math.random() * 200;
                          }
                        }
                        let prevId = hatId;
                        parsed.blocks.forEach(block => {
                          const blockId = buildBlockStructure(block, target, allBlocks);
                          if (blockId) {
                            const prevBlock = allBlocks.find(b => b.id === prevId);
                            if (prevBlock) prevBlock.next = blockId;
                            const curBlock = allBlocks.find(b => b.id === blockId);
                            if (curBlock) curBlock.parent = prevId;
                            prevId = blockId;
                          }
                        });
                        if (allBlocks.length > 0) {
                          try {
                            allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            vm.runtime.emitProjectChanged();
                            vm.emitWorkspaceUpdate();
                            vm.emitTargetsUpdate();
                          } catch (createErr) {
                            opResults.push({
                              index: opIdx,
                              type: 'add_script',
                              success: false,
                              error: 'createBlock failed: ' + (createErr.message || String(createErr)) +
                                '\nBlocks attempted: ' + allBlocks.length +
                                '\nLast opcode: ' + (allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].opcode : 'unknown')
                            });
                            break;
                          }
                        }
                        opResults.push({ index: opIdx, type: 'add_script', success: true, blocksCreated: allBlocks.length, warnings: eoWarnings || undefined });
                        break;
                      }
                      case 'delete_block': {
                        const resolved = resolveBlockId(op.targetId);
                        if (!resolved) { opResults.push({ index: opIdx, type: 'delete_block', success: false, error: 'Block tid not found: ' + op.targetId }); break; }
                        const target = resolved.target;
                        const blockId = resolved.blockId;
                        const block = target.blocks.getBlock(blockId);
                        if (!block) { opResults.push({ index: opIdx, type: 'delete_block', success: false, error: 'Block not found' }); break; }
                        const mode = op.mode || 'with_children';
                        if (mode === 'with_children') {
                          const idsToDelete = [];
                          function collectChain(id) {
                            if (!id || idsToDelete.indexOf(id) >= 0) return;
                            idsToDelete.push(id);
                            const b = target.blocks.getBlock(id);
                            if (!b) return;
                            if (b.next) collectChain(b.next);
                            if (b.inputs && b.inputs.SUBSTACK && b.inputs.SUBSTACK.block) collectChain(b.inputs.SUBSTACK.block);
                            if (b.inputs && b.inputs.SUBSTACK2 && b.inputs.SUBSTACK2.block) collectChain(b.inputs.SUBSTACK2.block);
                          }
                          collectChain(blockId);
                          idsToDelete.forEach(function(id) { target.blocks.deleteBlock(id); });
                        } else {
                          const parentId = block.parent;
                          if (block.next) {
                            const nextBlock = target.blocks.getBlock(block.next);
                            if (nextBlock) nextBlock.parent = parentId;
                          }
                          target.blocks.deleteBlock(blockId);
                        }
                        vm.runtime.emitProjectChanged();
                        vm.emitWorkspaceUpdate();
                        vm.emitTargetsUpdate();
                        opResults.push({ index: opIdx, type: 'delete_block', success: true });
                        break;
                      }
                      case 'modify_input': {
                        const resolved = resolveBlockId(op.targetId);
                        if (!resolved) { opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'Block tid not found: ' + op.targetId }); break; }
                        const target = resolved.target;
                        const blockId = resolved.blockId;
                        const block = target.blocks.getBlock(blockId);
                        if (!block) { opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'Block not found' }); break; }
                        const inputName = op.inputName;
                        const value = op.value;
                        const oldInput = block.inputs[inputName];
                        function deleteOldShadow() {
                          if (oldInput && oldInput.shadow) {
                            target.blocks.deleteBlock(oldInput.shadow);
                          }
                          if (oldInput && oldInput.block) {
                            target.blocks.deleteBlock(oldInput.block);
                          }
                          if (oldInput && typeof oldInput === 'object' && oldInput.block === oldInput.shadow) {
                            target.blocks.deleteBlock(oldInput.block);
                          }
                        }
                        if (typeof value === 'string' && (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2')) {
                          // DSL text string for SUBSTACK/SUBSTACK2: parse and build chain
                          deleteOldShadow();
                          let parsedSub;
                          try {
                            parsedSub = parseScratchDSL(value, target);
                          } catch (parseErr) {
                            opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'SUBSTACK DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nText (first 300 chars): ' + value.substring(0, 300) });
                            break;
                          }
                          const subAllBlocks = [];
                          let subFirstId = null;
                          let subPrevId = null;
                          parsedSub.blocks.forEach(function(blk) {
                            const subId = buildBlockStructure(blk, target, subAllBlocks);
                            if (subId) {
                              const subDef = subAllBlocks.find(function(ab) { return ab.id === subId; });
                              if (subDef) subDef.parent = subPrevId || blockId;
                              if (!subFirstId) subFirstId = subId;
                              if (subPrevId) {
                                const prevDef = subAllBlocks.find(function(ab) { return ab.id === subPrevId; });
                                if (prevDef) prevDef.next = subId;
                              }
                              subPrevId = subId;
                            }
                          });
                          if (subFirstId) {
                            subAllBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            block.inputs[inputName] = { name: inputName, block: subFirstId, shadow: null };
                          } else {
                            opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'SUBSTACK DSL produced no blocks. Text was: ' + value.substring(0, 200) });
                            break;
                          }
                        } else if (value && typeof value === 'object' && value.opcode && (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2')) {
                          // Object format for SUBSTACK: build chain and set parent
                          deleteOldShadow();
                          const subAllBlocks = [];
                          const reporterId = buildBlockStructure(value, target, subAllBlocks);
                          if (reporterId) {
                            const firstDef = subAllBlocks.find(function(ab) { return ab.id === reporterId; });
                            if (firstDef) firstDef.parent = blockId;
                            subAllBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            block.inputs[inputName] = { name: inputName, block: reporterId, shadow: null };
                          }
                        } else if (typeof value === 'number') {
                          deleteOldShadow();
                          const sid = generateId();
                          target.blocks.createBlock({ id: sid, opcode: 'math_number', fields: { NUM: { name: 'NUM', value: value } }, inputs: {}, next: null, parent: blockId, shadow: true, topLevel: false, x: 0, y: 0 });
                          block.inputs[inputName] = { name: inputName, block: sid, shadow: sid };
                        } else if (typeof value === 'string') {
                          deleteOldShadow();
                          const sid = generateId();
                          target.blocks.createBlock({ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value } }, inputs: {}, next: null, parent: blockId, shadow: true, topLevel: false, x: 0, y: 0 });
                          block.inputs[inputName] = { name: inputName, block: sid, shadow: sid };
                        } else if (typeof value === 'boolean') {
                          deleteOldShadow();
                          const sid = generateId();
                          target.blocks.createBlock({ id: sid, opcode: 'text', fields: { TEXT: { name: 'TEXT', value: value ? 'true' : 'false' } }, inputs: {}, next: null, parent: blockId, shadow: true, topLevel: false, x: 0, y: 0 });
                          block.inputs[inputName] = { name: inputName, block: sid, shadow: sid };
                        } else if (value && typeof value === 'object' && value.opcode && inputName !== 'SUBSTACK' && inputName !== 'SUBSTACK2') {
                          deleteOldShadow();
                          const allBlocks = [];
                          const reporterId = buildBlockStructure(value, target, allBlocks);
                          if (reporterId) {
                            allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            block.inputs[inputName] = { name: inputName, block: reporterId };
                          }
                        } else if (value && typeof value === 'object' && value.VARIABLE) {
                          deleteOldShadow();
                          const vf = resolveVariableField(target, 'VARIABLE', value.VARIABLE);
                          const vsid = generateId();
                          target.blocks.createBlock({ id: vsid, opcode: 'data_variable', fields: { VARIABLE: vf }, inputs: {}, next: null, parent: blockId, shadow: true, topLevel: false, x: 0, y: 0 });
                          block.inputs[inputName] = { name: inputName, block: vsid, shadow: vsid };
                        }
                        vm.runtime.emitProjectChanged();
                        vm.emitWorkspaceUpdate();
                        vm.emitTargetsUpdate();
                        opResults.push({ index: opIdx, type: 'modify_input', success: true });
                        break;
                      }
                      case 'add_comment': {
                        const target = getTarget(op.sprite) || vm.runtime.getTargetForStage();
                        if (!target) { opResults.push({ index: opIdx, type: 'add_comment', success: false, error: 'Target not found: ' + op.sprite }); break; }
                        const commentId = '_ai_cmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                        const commentText = op.text || '';
                        const minimized = op.minimized === true;
                        if (op.targetId) {
                          // Block-attached comment
                          const resolved = resolveBlockId(op.targetId);
                          if (!resolved) { opResults.push({ index: opIdx, type: 'add_comment', success: false, error: 'Block tid not found: ' + op.targetId }); break; }
                          const block = resolved.target.blocks.getBlock(resolved.blockId);
                          if (!block) { opResults.push({ index: opIdx, type: 'add_comment', success: false, error: 'Block not found' }); break; }
                          target.createComment(commentId, resolved.blockId, commentText, block.x + 240, block.y, 200, 200, minimized);
                        } else {
                          // Standalone workspace comment
                          const cx = typeof op.x === 'number' ? op.x : 100 + Math.random() * 200;
                          const cy = typeof op.y === 'number' ? op.y : 100 + Math.random() * 200;
                          target.createComment(commentId, null, commentText, cx, cy, 200, 200, minimized);
                        }
                        vm.runtime.emitProjectChanged();
                        vm.emitWorkspaceUpdate();
                        vm.emitTargetsUpdate();
                        opResults.push({ index: opIdx, type: 'add_comment', success: true, data: { commentId: commentId } });
                        break;
                      }
                      case 'delete_comment': {
                        const target = getTarget(op.sprite) || vm.runtime.getTargetForStage();
                        if (!target) { opResults.push({ index: opIdx, type: 'delete_comment', success: false, error: 'Target not found: ' + op.sprite }); break; }
                        // targetId 可能是块 tid，也可能是 add_comment 返回的 commentId
                        // （独立工作区注释没有宿主块，只能按 commentId 删）。两种都接受，
                        // 并按 tid -> commentId -> 全 target 扫描的顺序回退。
                        const wanted = op.commentId || op.targetId;
                        let deleted = false;

                        const dropComment = (owner, cid) => {
                          if (!owner || !owner.comments || !owner.comments[cid]) return false;
                          const c = owner.comments[cid];
                          if (c && c.blockId) {
                            const b = owner.blocks.getBlock(c.blockId);
                            if (b) delete b.comment;
                          }
                          delete owner.comments[cid];
                          return true;
                        };

                        // 1) 当作块 tid：删掉该块挂着的注释
                        if (op.targetId) {
                          const resolved = resolveBlockId(op.targetId);
                          if (resolved) {
                            const block = resolved.target.blocks.getBlock(resolved.blockId);
                            if (block && block.comment) {
                              deleted = dropComment(resolved.target, block.comment);
                            }
                          }
                        }
                        // 2) 当作 commentId：先在指定 target 上找
                        if (!deleted && wanted) {
                          deleted = dropComment(target, wanted);
                        }
                        // 3) 仍未命中：跨所有 target 扫一遍（sprite 传错时的兜底）
                        if (!deleted && wanted) {
                          for (const t of vm.runtime.targets) {
                            if (dropComment(t, wanted)) { deleted = true; break; }
                          }
                        }

                        if (!deleted) {
                          opResults.push({
                            index: opIdx, type: 'delete_comment', success: false,
                            error: 'Comment not found: ' + String(wanted) +
                              '. Pass a block tid to remove that block\'s comment, or the commentId returned by add_comment for a standalone workspace comment.'
                          });
                          break;
                        }
                        vm.runtime.emitProjectChanged();
                        vm.emitWorkspaceUpdate();
                        vm.emitTargetsUpdate();
                        opResults.push({ index: opIdx, type: 'delete_comment', success: true });
                        break;
                      }
                      case 'explain': {
                        opResults.push({ index: opIdx, type: 'explain', success: true, text: op.text || '' });
                        break;
                      }
                      default: {
                        opResults.push({ index: opIdx, type: op.type, success: false, error: 'Unknown operation type: ' + op.type });
                      }
                    }
                  } catch (e3) {
                    opResults.push({ index: opIdx, type: op.type, success: false, error: e3.message || String(e3) });
                  }
                }

                result = { success: true, data: { results: opResults } };
              } catch (e2) { result = { success: false, error: 'Failed to execute operations: ' + (e2.message || String(e2)) }; }
              break;
            }
            case 'changeCostume': {
              const target = vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName);
              if (!target) { result = { success: false, error: 'Sprite not found' }; break; }
              const costumes = target.getCostumes();
              const searchName = (params.costumeName || '').toLowerCase();
              const idx = costumes.findIndex(c => (c.name || '').toLowerCase() === searchName);
              if (idx < 0) {
                result = { success: false, error: 'Costume "' + params.costumeName + '" not found. Available: ' + costumes.map(c => c.name).join(', ') };
                break;
              }
              target.setCostume(idx);
              result = { success: true, data: { costumeName: costumes[idx].name, costumeIndex: idx } };
              break;
            }
            case 'changeBackdrop': {
              const stage = vm.runtime.getTargetForStage();
              const costumes = stage.getCostumes();
              const searchName = (params.backdropName || '').toLowerCase();
              const idx = costumes.findIndex(c => (c.name || '').toLowerCase() === searchName);
              if (idx < 0) {
                result = { success: false, error: 'Backdrop "' + params.backdropName + '" not found. Available: ' + costumes.map(c => c.name).join(', ') };
                break;
              }
              stage.setCostume(idx);
              vm.runtime.emitProjectChanged();
              result = { success: true, data: { backdropName: costumes[idx].name, index: idx } };
              break;
            }
            case 'getStageInfo': {
              const stage = vm.runtime.getTargetForStage();
              if (!stage) { result = { success: false, error: 'Stage not found' }; break; }
              const backdropList = stage.getCostumes().map(c => ({ name: c.name, index: c === stage.getCostumes()[stage.currentCostume] ? 'current' : '' }));
              result = { success: true, data: { currentBackdrop: stage.getCostumes()[stage.currentCostume] ? stage.getCostumes()[stage.currentCostume].name : '', backdropCount: stage.getCostumes().length, backdrops: backdropList } };
              break;
            }
            case 'getInstalledExtensions': {
              try {
                const extensionManager = vm.extensionManager;
                if (!extensionManager) { result = { success: false, error: 'Extension manager not available' }; break; }
                const loadedExtensions = extensionManager._loadedExtensions || {};
                const extList = [];
                Object.keys(loadedExtensions).forEach(extId => {
                  const ext = loadedExtensions[extId];
                  try {
                    const info = ext.getInfo ? ext.getInfo() : null;
                    const blockList = info && info.blocks ? info.blocks.map(b => ({
                      opcode: b.opcode,
                      blockType: b.blockType,
                      text: b.text || '',
                      arguments: b.arguments || {},
                      argumentCount: b.arguments ? Object.keys(b.arguments).length : 0,
                      func: b.func || '',
                      hideFromPalette: b.hideFromPalette || false,
                      isTerminal: b.isTerminal || false,
                      blockAllThreads: b.blockAllThreads || false
                    })) : [];
                    const menuList = info && info.menus ? Object.keys(info.menus).map(m => ({
                      name: m,
                      items: info.menus[m].items || []
                    })) : [];
                    extList.push({
                      id: info ? info.id : extId,
                      name: info ? info.name : extId,
                      blockCount: blockList.length,
                      blocks: blockList,
                      menus: menuList,
                      hasGetter: typeof ext.getInfo === 'function'
                    });
                  } catch (e2) {
                    extList.push({ id: extId, name: extId, error: e2.message });
                  }
                });
                result = { success: true, data: { extensionCount: extList.length, extensions: extList } };
              } catch (e) { result = { success: false, error: e.message }; }
              break;
            }
            case 'searchExtensions': {
              try {
                const keyword = (params.keyword || '').toLowerCase();
                const KNOWN_EXTENSIONS = [
                  { id: 'text', name: 'Text', description: 'Display text on the stage with customizable fonts, colors, and sizes.', url: 'https://extensions.turbowarp.org/text.js' },
                  { id: 'pen', name: 'Pen', description: 'Draw on the stage with pen blocks - lines, stamps, colors.', url: 'https://extensions.turbowarp.org/pen.js' },
                  { id: 'music', name: 'Music', description: 'Play instruments, drums, and create musical sequences.', url: 'https://extensions.turbowarp.org/music.js' },
                  { id: 'translate', name: 'Translate', description: 'Translate text between languages using machine translation.', url: 'https://extensions.turbowarp.org/translate.js' },
                  { id: 'video sensing', name: 'Video Sensing', description: 'Detect motion and interact with webcam video.', url: 'https://extensions.turbowarp.org/videoSensing.js' },
                  { id: 'tts', name: 'Text to Speech', description: 'Speak text aloud with different voices and languages.', url: 'https://extensions.turbowarp.org/text2speech.js' },
                  { id: 'gdxfor', name: 'Go Direct Force', description: 'Connect to Vernier Go Direct Force and Acceleration sensor.', url: 'https://extensions.turbowarp.org/gdxfor.js' },
                  { id: 'ev3', name: 'LEGO EV3', description: 'Control LEGO MINDSTORMS EV3 motors and sensors.', url: 'https://extensions.turbowarp.org/ev3.js' },
                  { id: 'makeymakey', name: 'Makey Makey', description: 'Use Makey Makey to trigger keyboard events from physical inputs.', url: 'https://extensions.turbowarp.org/makeymakey.js' },
                  { id: 'microbit', name: 'micro:bit', description: 'Connect to BBC micro:bit and use its sensors and LED display.', url: 'https://extensions.turbowarp.org/microbit.js' },
                  { id: 'wedo2', name: 'LEGO WeDo 2.0', description: 'Control LEGO WeDo 2.0 motors and sensors.', url: 'https://extensions.turbowarp.org/wedo2.js' },
                  { id: 'boost', name: 'LEGO BOOST', description: 'Control LEGO BOOST motors and sensors.', url: 'https://extensions.turbowarp.org/boost.js' },
                  { id: 'gamepad', name: 'Gamepad', description: 'Read gamepad/joystick button presses and axis values.', url: 'https://extensions.turbowarp.org/gamepad.js' },
                  { id: 'cursor', name: 'Cursor', description: 'Hide/show mouse cursor and get cursor position.', url: 'https://extensions.turbowarp.org/cursor.js' },
                  { id: 'files', name: 'Files', description: 'Read and write files from the local filesystem.', url: 'https://extensions.turbowarp.org/files.js' },
                  { id: 'clocks', name: 'Clocks', description: 'Get current time, date, and create timers.', url: 'https://extensions.turbowarp.org/clocks.js' },
                  { id: 'fetch', name: 'Fetch', description: 'Make HTTP requests to APIs and websites.', url: 'https://extensions.turbowarp.org/fetch.js' },
                  { id: 'runtime', name: 'Runtime', description: 'Control project execution - pause, stop, FPS.', url: 'https://extensions.turbowarp.org/runtime.js' },
                  { id: 'cloudlink', name: 'CloudLink', description: 'Connect projects together over the internet.', url: 'https://extensions.turbowarp.org/cloudlink.js' },
                  { id: 'utilities', name: 'Utilities', description: 'JSON parsing, math functions, advanced string operations.', url: 'https://extensions.turbowarp.org/utilities.js' },
                  { id: 'encoding', name: 'Encoding', description: 'Base64, hex, URL encoding and decoding.', url: 'https://extensions.turbowarp.org/encoding.js' },
                  { id: 'sound', name: 'Sound', description: 'Advanced sound analysis - loudness, pitch, waveform.', url: 'https://extensions.turbowarp.org/sound.js' },
                  { id: 'box2d', name: 'Box2D Physics', description: 'Realistic 2D physics simulation with gravity, collisions.', url: 'https://extensions.turbowarp.org/box2d.js' },
                  { id: 'pointer', name: 'Pointer', description: 'Get pointer/mouse position on stage with advanced options.', url: 'https://extensions.turbowarp.org/pointerlock.js' },
                  { id: 'turbo', name: 'TurboWarp', description: 'Advanced TurboWarp-specific features like warp mode.', url: 'https://extensions.turbowarp.org/turbowarp.js' },
                  { id: 'tween', name: 'Tween', description: 'Smooth animations - move, rotate, scale sprites over time.', url: 'https://extensions.turbowarp.org/tween.js' },
                  { id: 'stretch', name: 'Stretch', description: 'Stretch sprites on the stage canvas.', url: 'https://extensions.turbowarp.org/stretch.js' },
                  { id: 'xml', name: 'XML', description: 'Parse and create XML documents.', url: 'https://extensions.turbowarp.org/xml.js' },
                  { id: 'iframe', name: 'iframe', description: 'Embed web content in your project.', url: 'https://extensions.turbowarp.org/iframe.js' }
                ];
                const matches = KNOWN_EXTENSIONS.filter(ext => {
                  return ext.name.toLowerCase().includes(keyword) ||
                    ext.id.toLowerCase().includes(keyword) ||
                    ext.description.toLowerCase().includes(keyword);
                });
                if (matches.length === 0) {
                  result = { success: true, data: { keyword: params.keyword, count: 0, results: [], allExtensions: KNOWN_EXTENSIONS.map(e => e.name) } };
                } else {
                  result = { success: true, data: { keyword: params.keyword, count: matches.length, results: matches } };
                }
              } catch (e) { result = { success: false, error: e.message }; }
              break;
            }
            case 'developExtension': {
              try {
                var extCode = params.extension_code || '';
                var extName = params.extension_name || 'custom_extension_' + Date.now();
                if (!extCode || extCode.trim().length < 10) { result = { success: false, error: 'Extension code is too short or empty' }; break; }
                var safeExtName = extName.replace(/[^a-zA-Z0-9_]/g, '_');
                var wrappedCode = '(function(Scratch) {\n' +
                  '  var ExtensionClass = ' + extCode + '\n' +
                  '  if (typeof ExtensionClass === "function" && ExtensionClass.prototype) {\n' +
                  '    Scratch.extensions.register(new ExtensionClass());\n' +
                  '  } else if (typeof ExtensionClass === "object" && !Array.isArray(ExtensionClass)) {\n' +
                  '    var info = ExtensionClass;\n' +
                  '    Scratch.extensions.register({ getInfo: function() { return info; }, _customInfo: info });\n' +
                  '  } else {\n' +
                  '    Scratch.extensions.register({ getInfo: function() { return { id: "' + safeExtName + '", name: "' + safeExtName + '", blocks: [] }; } });\n' +
                  '  }\n' +
                  '})(Scratch);';
                var dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(wrappedCode);

                // AI 生成的扩展代码需要直接访问 Scratch API（vm/runtime），沙箱化的
                // worker/iframe 里拿不到，注册回调也不会回传，表现为"两次超时且未注册"。
                // 这里临时把该 data: URL 判为 unsandboxed，加载结束后恢复原策略。
                var secMgr = vm.extensionManager.securityManager;
                var prevGetSandboxMode = secMgr.getSandboxMode;
                secMgr.getSandboxMode = function(url) {
                  if (url === dataUrl) return Promise.resolve('unsandboxed');
                  return prevGetSandboxMode.call(secMgr, url);
                };

                var loadedIds = [];
                try {
                  // loadExtensionURL 在注册回调迟迟不来时会一直挂着，加超时避免
                  // 阻塞整条工具调用链（主进程侧 30s 后会判定 Tool call timeout）。
                  await Promise.race([
                    vm.extensionManager.loadExtensionURL(dataUrl),
                    new Promise(function(_, rej) {
                      setTimeout(function() { rej(new Error('Extension registration timed out after 20s')); }, 20000);
                    })
                  ]);
                  try {
                    loadedIds = Array.from(vm.extensionManager._loadedExtensions.keys());
                  } catch (idErr) { void idErr; }
                } finally {
                  secMgr.getSandboxMode = prevGetSandboxMode;
                }

                result = {
                  success: true,
                  data: {
                    extensionName: extName,
                    safeId: safeExtName,
                    loadedExtensions: loadedIds,
                    message: 'Extension "' + extName + '" loaded successfully (unsandboxed)'
                  }
                };
              } catch (e) {
                result = {
                  success: false,
                  error: 'Failed to develop extension: ' + (e && e.message ? e.message : String(e)) +
                    '. Make sure extension_code is a class or object literal (no "const X =" prefix) whose getInfo() returns {id, name, blocks}.'
                };
              }
              break;
            }
            case 'installExtension': {
              try {
                var extUrl = params.extension_url || '';
                if (!extUrl) { result = { success: false, error: 'No extension URL provided' }; break; }
                var KNOWN_URLS = {
                  'text': 'https://extensions.turbowarp.org/text.js',
                  'pen': 'https://extensions.turbowarp.org/pen.js',
                  'music': 'https://extensions.turbowarp.org/music.js',
                  'translate': 'https://extensions.turbowarp.org/translate.js',
                  'video sensing': 'https://extensions.turbowarp.org/videoSensing.js',
                  'videoSensing': 'https://extensions.turbowarp.org/videoSensing.js',
                  'tts': 'https://extensions.turbowarp.org/text2speech.js',
                  'text2speech': 'https://extensions.turbowarp.org/text2speech.js',
                  'gdxfor': 'https://extensions.turbowarp.org/gdxfor.js',
                  'ev3': 'https://extensions.turbowarp.org/ev3.js',
                  'makeymakey': 'https://extensions.turbowarp.org/makeymakey.js',
                  'microbit': 'https://extensions.turbowarp.org/microbit.js',
                  'wedo2': 'https://extensions.turbowarp.org/wedo2.js',
                  'boost': 'https://extensions.turbowarp.org/boost.js',
                  'gamepad': 'https://extensions.turbowarp.org/gamepad.js',
                  'cursor': 'https://extensions.turbowarp.org/cursor.js',
                  'files': 'https://extensions.turbowarp.org/files.js',
                  'clocks': 'https://extensions.turbowarp.org/clocks.js',
                  'fetch': 'https://extensions.turbowarp.org/fetch.js',
                  'runtime': 'https://extensions.turbowarp.org/runtime.js',
                  'cloudlink': 'https://extensions.turbowarp.org/cloudlink.js',
                  'utilities': 'https://extensions.turbowarp.org/utilities.js',
                  'encoding': 'https://extensions.turbowarp.org/encoding.js',
                  'sound': 'https://extensions.turbowarp.org/sound.js',
                  'box2d': 'https://extensions.turbowarp.org/box2d.js',
                  'pointer': 'https://extensions.turbowarp.org/pointerlock.js',
                  'turbo': 'https://extensions.turbowarp.org/turbowarp.js',
                  'tween': 'https://extensions.turbowarp.org/tween.js',
                  'stretch': 'https://extensions.turbowarp.org/stretch.js',
                  'xml': 'https://extensions.turbowarp.org/xml.js',
                  'iframe': 'https://extensions.turbowarp.org/iframe.js'
                };
                if (KNOWN_URLS[extUrl]) extUrl = KNOWN_URLS[extUrl];
                if (KNOWN_URLS[extUrl.toLowerCase()]) extUrl = KNOWN_URLS[extUrl.toLowerCase()];
                if (!extUrl.startsWith('http')) { result = { success: false, error: 'Invalid URL. Provide a full URL or known extension ID.' }; break; }
                await vm.extensionManager.loadExtensionURL(extUrl);
                result = { success: true, data: { url: extUrl, message: 'Extension loaded successfully' } };
              } catch (e) { result = { success: false, error: 'Failed to install extension: ' + e.message }; }
              break;
            }
            case 'renameProject': {
              try {
                const newName = params.name;
                if (!newName) { result = { success: false, error: 'No name provided' }; break; }
                vm.runtime.projectName = newName;
                vm.runtime.emitProjectChanged();
                document.title = newName + ' - NeoWarp';
                result = { success: true, data: { name: newName } };
              } catch (e) { result = { success: false, error: 'Failed to rename project: ' + e.message }; }
              break;
            }
            case 'setStageSize': {
              try {
                const width = Number(params.width);
                const height = Number(params.height);
                if (!width || !height || width < 240 || height < 180) {
                  result = { success: false, error: 'Invalid stage size. Width must be >= 240, height >= 180.' };
                  break;
                }
                vm.setStageSize(width, height);
                result = { success: true, data: { width: width, height: height, message: 'Stage size set to ' + width + 'x' + height } };
              } catch (e) { result = { success: false, error: 'Failed to set stage size: ' + e.message }; }
              break;
            }
            case 'clickGreenFlag': {
              try {
                vm.greenFlag();
                result = { success: true, data: { message: 'Green flag clicked' } };
              } catch (e) { result = { success: false, error: 'Failed to click green flag: ' + e.message }; }
              break;
            }
            case 'getSystemTime': {
              const now = new Date();
              result = { success: true, data: {
                timestamp: now.getTime(),
                iso: now.toISOString(),
                local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                date: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
                time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0'),
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate(),
                hours: now.getHours(),
                minutes: now.getMinutes(),
                seconds: now.getSeconds(),
                weekday: now.getDay(),
                timezoneOffset: now.getTimezoneOffset()
              }};
              break;
            }
            case 'getSystemInfo': {
              try {
                const info = await EditorPreload.getAISystemInfo();
                result = info;
              } catch (e) { result = { success: false, error: 'Failed to get system info: ' + e.message }; }
              break;
            }
            case 'addCostumeFromUrl': {
              try {
                const spriteName = params.spriteName || '';
                const url = params.url || '';
                const costumeName = params.costumeName || 'costume';
                if (!url) { result = { success: false, error: 'No URL provided' }; break; }
                const target = vm.runtime.targets.find(t => t.getName() === spriteName);
                if (!target) { result = { success: false, error: 'Sprite "' + spriteName + '" not found' }; break; }

                // Fetch the image via main process (bypasses CORS, sets proper User-Agent)
                const buffer = await EditorPreload.fetchImage(url);

                // Determine format from URL
                const urlLower = url.toLowerCase();
                let dataFormat = 'png';
                if (urlLower.endsWith('.svg')) dataFormat = 'svg';
                else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) dataFormat = 'jpg';
                else if (urlLower.endsWith('.gif')) dataFormat = 'gif';
                else if (urlLower.endsWith('.bmp')) dataFormat = 'bmp';

                const storage = vm.runtime.storage;
                const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                const asset = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                const storedAsset = storage.builtinHelper.get(asset);

                const costume = {
                  name: costumeName,
                  assetId: asset,
                  md5ext: asset + '.' + dataFormat,
                  dataFormat: dataFormat,
                  rotationCenterX: dataFormat === 'svg' ? 240 : 0,
                  rotationCenterY: dataFormat === 'svg' ? 180 : 0,
                  bitmapResolution: dataFormat === 'svg' ? 1 : 2,
                  asset: storedAsset
                };

                target.addCostume(costume);
                target.setCostume(target.getCostumes().length - 1);
                vm.runtime.emitProjectChanged();
                result = { success: true, data: { costumeName: costumeName, spriteName: spriteName, format: dataFormat } };
              } catch (e) { result = { success: false, error: 'Failed to add costume from URL: ' + e.message }; }
              break;
            }
            case 'searchAndAddCostume': {
              try {
                const spriteName = params.spriteName || '';
                const query = params.query || '';
                const costumeName = params.costumeName || query || 'costume';
                if (!query) { result = { success: false, error: 'No search query provided' }; break; }
                const target = vm.runtime.targets.find(t => t.getName() === spriteName);
                if (!target) { result = { success: false, error: 'Sprite "' + spriteName + '" not found' }; break; }

                // Search Wikimedia Commons API for freely licensed images
                const searchUrl = 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=' +
                  encodeURIComponent(query) + '&format=json&origin=*&srnamespace=6&srlimit=10';
                const searchResponse = await globalThis.fetch(searchUrl);
                if (!searchResponse.ok) { result = { success: false, error: 'Wikimedia search failed: HTTP ' + searchResponse.status }; break; }
                const searchData = await searchResponse.json();
                const pages = searchData?.query?.search || [];
                if (pages.length === 0) { result = { success: false, error: 'No images found for query: ' + query }; break; }

                // Filter to image files only
                const imagePages = pages.filter(p => p.title && p.title.startsWith('File:'));
                if (imagePages.length === 0) { result = { success: false, error: 'No image files found for query: ' + query }; break; }

                // Try each result until we find a usable image
                let imageUrl = null;
                let chosenTitle = '';
                for (var si = 0; si < imagePages.length; si++) {
                  const pageTitle = imagePages[si].title;
                  const infoUrl = 'https://commons.wikimedia.org/w/api.php?action=query&titles=' +
                    encodeURIComponent(pageTitle) + '&prop=imageinfo&iiprop=url|size|mime&format=json&origin=*';
                  const infoResponse = await globalThis.fetch(infoUrl);
                  if (!infoResponse.ok) continue;
                  const infoData = await infoResponse.json();
                  const pagesObj = infoData?.query?.pages || {};
                  for (var pk in pagesObj) {
                    const p = pagesObj[pk];
                    if (p.imageinfo && p.imageinfo.length > 0) {
                      const firstImg = p.imageinfo[0];
                      // Skip very large images (>5MB) and SVG (complex parsing)
                      if (firstImg.size && firstImg.size > 5 * 1024 * 1024) continue;
                      // Prefer small-medium images for Scratch
                      if (firstImg.width && firstImg.width > 2000) continue;
                      if (firstImg.mime && firstImg.mime === 'image/svg+xml') continue;
                      imageUrl = firstImg.url;
                      chosenTitle = pageTitle;
                      break;
                    }
                  }
                  if (imageUrl) break;
                }
                if (!imageUrl) { result = { success: false, error: 'No suitable image found for query: ' + query }; break; }

                // Download the image via main process (bypasses CORS, sets proper User-Agent)
                const buffer = await EditorPreload.fetchImage(imageUrl);

                // Determine format from URL
                const urlLower = imageUrl.toLowerCase();
                let dataFormat = 'png';
                if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) dataFormat = 'jpg';
                else if (urlLower.endsWith('.gif')) dataFormat = 'gif';
                else if (urlLower.endsWith('.bmp')) dataFormat = 'bmp';

                const storage = vm.runtime.storage;
                const assetType = storage.AssetType.ImageBitmap;
                const asset = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                const storedAsset = storage.builtinHelper.get(asset);

                const costume = {
                  name: costumeName,
                  assetId: asset,
                  md5ext: asset + '.' + dataFormat,
                  dataFormat: dataFormat,
                  rotationCenterX: 0,
                  rotationCenterY: 0,
                  bitmapResolution: 2,
                  asset: storedAsset
                };

                target.addCostume(costume);
                target.setCostume(target.getCostumes().length - 1);
                vm.runtime.emitProjectChanged();
                result = { success: true, data: { costumeName: costumeName, spriteName: spriteName, query: query, source: chosenTitle, format: dataFormat } };
              } catch (e) { result = { success: false, error: 'Failed to search and add costume: ' + e.message }; }
              break;
            }
            case 'addSpriteFromUrl': {
              try {
                const spriteName = params.spriteName || 'Sprite';
                const url = params.url || '';
                if (!url) { result = { success: false, error: 'No URL provided' }; break; }

                // Fetch the image via main process (bypasses CORS, sets proper User-Agent)
                const buffer = await EditorPreload.fetchImage(url);

                // Determine format from URL
                const urlLower = url.toLowerCase();
                let dataFormat = 'png';
                if (urlLower.endsWith('.svg')) dataFormat = 'svg';
                else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) dataFormat = 'jpg';
                else if (urlLower.endsWith('.gif')) dataFormat = 'gif';
                else if (urlLower.endsWith('.bmp')) dataFormat = 'bmp';

                const storage = vm.runtime.storage;
                const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
                const asset = storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null);
                const storedAsset = storage.builtinHelper.get(asset);

                const costume = {
                  name: 'costume1',
                  assetId: asset,
                  md5ext: asset + '.' + dataFormat,
                  dataFormat: dataFormat,
                  rotationCenterX: dataFormat === 'svg' ? 47 : 0,
                  rotationCenterY: dataFormat === 'svg' ? 47 : 0,
                  bitmapResolution: dataFormat === 'svg' ? 1 : 2,
                  asset: storedAsset
                };

                const spriteObj = {
                  isStage: false, name: spriteName, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                  currentCostume: 0, costumes: [costume], sounds: [], volume: 100,
                  layerOrder: vm.runtime.targets.length, visible: true, x: 0, y: 0, size: 100, direction: 90,
                  draggable: false, rotationStyle: 'all around'
                };
                await vm.addSprite(spriteObj);
                const newTarget = vm.runtime.targets[vm.runtime.targets.length - 1];
                result = { success: true, data: { name: spriteName, id: newTarget ? newTarget.id : null, format: dataFormat } };
              } catch (e) { result = { success: false, error: 'Failed to add sprite from URL: ' + e.message }; }
              break;
            }
            case 'getStageScreenshot': {
              try {
                if (!vm.renderer || !vm.renderer.requestSnapshot) {
                  result = { success: false, error: 'Renderer snapshot not available' };
                  break;
                }
                const screenshotDataUrl = await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject(new Error('Screenshot timeout')), 5000);
                  vm.renderer.requestSnapshot((dataURL) => {
                    clearTimeout(timeout);
                    resolve(dataURL);
                  });
                });
                // Extract base64 data from data URL
                const base64Match = screenshotDataUrl.match(/^data:image\/png;base64,(.+)$/);
                if (base64Match) {
                  result = { success: true, data: { image: base64Match[1], format: 'png', mimeType: 'image/png' } };
                } else {
                  result = { success: true, data: { image: screenshotDataUrl, format: 'png', mimeType: 'image/png' } };
                }
              } catch (e) { result = { success: false, error: 'Failed to capture stage screenshot: ' + e.message }; }
              break;
            }
            case 'clickStage': {
              try {
                const scratchX = Number(params.x);
                const scratchY = Number(params.y);
                if (isNaN(scratchX) || isNaN(scratchY)) {
                  result = { success: false, error: 'Invalid coordinates. x and y must be numbers.' };
                  break;
                }
                // Get stage dimensions from renderer, fallback to 480x360
                let canvasWidth = 480;
                let canvasHeight = 360;
                if (vm.runtime && vm.runtime.renderer) {
                  canvasWidth = vm.runtime.renderer._width || canvasWidth;
                  canvasHeight = vm.runtime.renderer._height || canvasHeight;
                }
                // Convert Scratch coordinates (center origin, y-up) to canvas pixel coordinates (top-left origin, y-down)
                const canvasX = scratchX + canvasWidth / 2;
                const canvasY = canvasHeight / 2 - scratchY;
                // Simulate mouse down
                vm.postIOData('mouse', {
                  x: canvasX, y: canvasY,
                  canvasWidth: canvasWidth, canvasHeight: canvasHeight,
                  isDown: true, button: 0
                });
                // Brief delay to register the click
                await new Promise(resolve => setTimeout(resolve, 50));
                // Simulate mouse up
                vm.postIOData('mouse', {
                  x: canvasX, y: canvasY,
                  canvasWidth: canvasWidth, canvasHeight: canvasHeight,
                  isDown: false, button: 0
                });
                result = { success: true, data: { x: scratchX, y: scratchY, message: 'Clicked at (' + scratchX + ', ' + scratchY + ')' } };
              } catch (e) { result = { success: false, error: 'Failed to click stage: ' + e.message }; }
              break;
            }
            case 'setFramerate': {
              try {
                const fps = Number(params.fps);
                if (!fps || fps < 1 || fps > 240) {
                  result = { success: false, error: 'Invalid FPS. Must be between 1 and 240.' };
                  break;
                }
                if (typeof vm.setFramerate === 'function') {
                  vm.setFramerate(fps);
                } else if (vm.runtime && typeof vm.runtime.setFramerate === 'function') {
                  vm.runtime.setFramerate(fps);
                } else {
                  result = { success: false, error: 'setFramerate not available in this VM version' };
                  break;
                }
                const currentFps = (vm.runtime && vm.runtime._framerate) || fps;
                result = { success: true, data: { fps: currentFps, message: 'Frame rate set to ' + currentFps + ' FPS' } };
              } catch (e) { result = { success: false, error: 'Failed to set frame rate: ' + e.message }; }
              break;
            }
            case 'setListItem': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (!list) { result = { success: false, error: 'List "' + params.listName + '" not found' }; break; }
              if (!Array.isArray(list.value)) { result = { success: false, error: 'Variable "' + params.listName + '" is not a list' }; break; }
              const idx = parseInt(params.index);
              if (isNaN(idx) || idx < 1 || idx > list.value.length) {
                result = { success: false, error: 'Index out of range: ' + params.index + '. List length: ' + list.value.length };
                break;
              }
              // Convert item type: numeric strings become numbers
              let itemVal = params.item;
              if (typeof itemVal === 'string') {
                const numVal = Number(itemVal);
                if (itemVal.trim() !== '' && !isNaN(numVal)) itemVal = numVal;
              }
              list.value[idx - 1] = itemVal;
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { listName: params.listName, index: idx, value: itemVal, length: list.value.length } };
              break;
            }
            case 'insertToList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              if (params.item === undefined || params.item === null) { result = { success: false, error: 'No item provided' }; break; }
              let list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (!list) {
                const listId = '_ai_list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                target.createVariable(listId, params.listName, 'list', false);
                list = target.variables[listId];
                vm.emitWorkspaceUpdate();
              }
              if (!Array.isArray(list.value)) list.value = [];
              // Convert item type
              let itemVal = params.item;
              if (typeof itemVal === 'string') {
                const numVal = Number(itemVal);
                if (itemVal.trim() !== '' && !isNaN(numVal)) itemVal = numVal;
              }
              if (params.index === 'last' || params.index === undefined) {
                list.value.push(itemVal);
              } else if (params.index === 'first') {
                list.value.unshift(itemVal);
              } else {
                const idx = parseInt(params.index);
                if (isNaN(idx) || idx < 1 || idx > list.value.length + 1) {
                  result = { success: false, error: 'Index out of range: ' + params.index };
                  break;
                }
                list.value.splice(idx - 1, 0, itemVal);
              }
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { listName: params.listName, length: list.value.length } };
              break;
            }
            case 'clearList': {
              const target = params.spriteName ? (vm.runtime.getTargetById(params.targetId) || vm.runtime.targets.find(t => t.getName() === params.spriteName)) : vm.runtime.getTargetForStage();
              if (!target) { result = { success: false, error: 'Target not found' }; break; }
              const list = target.lookupVariableByNameAndType(params.listName, 'list');
              if (!list) { result = { success: false, error: 'List "' + params.listName + '" not found' }; break; }
              if (!Array.isArray(list.value)) { result = { success: false, error: 'Variable "' + params.listName + '" is not a list' }; break; }
              list.value = [];
              vm.runtime.emitProjectChanged();
              vm.emitWorkspaceUpdate();
              result = { success: true, data: { listName: params.listName, length: 0 } };
              break;
            }
            case 'getExtensionCode': {
              try {
                const extensionManager = vm.extensionManager;
                if (!extensionManager) { result = { success: false, error: 'Extension manager not available' }; break; }
                const loadedExtensions = extensionManager._loadedExtensions;
                if (!loadedExtensions) { result = { success: false, error: 'No loaded extensions' }; break; }
                // Collect all extension entries (handle both Map and plain object)
                const entries = [];
                if (typeof loadedExtensions.entries === 'function') {
                  for (const [k, v] of loadedExtensions.entries()) entries.push([k, v]);
                } else {
                  Object.keys(loadedExtensions).forEach(k => entries.push([k, loadedExtensions[k]]));
                }
                if (entries.length === 0) { result = { success: false, error: 'No loaded extensions found' }; break; }
                const queryId = (params.extensionId || '').toLowerCase();
                const queryName = (params.extensionName || '').toLowerCase();
                // Find matching extension by URL/ID or by name
                let matchedKey = null;
                let matchedExt = null;
                for (const [key, ext] of entries) {
                  if (key && key.toLowerCase().includes(queryId)) { matchedKey = key; matchedExt = ext; break; }
                  try {
                    const info = ext && ext.getInfo ? ext.getInfo() : null;
                    if (info) {
                      if (info.id && info.id.toLowerCase() === queryId) { matchedKey = key; matchedExt = ext; break; }
                      if (info.name && info.name.toLowerCase() === queryName) { matchedKey = key; matchedExt = ext; break; }
                      if (info.name && info.name.toLowerCase().includes(queryName) && queryName) { matchedKey = key; matchedExt = ext; break; }
                    }
                  } catch (e2) { /* ignore */ }
                }
                if (!matchedKey) {
                  // Return list of available extensions for the user
                  const available = entries.map(([key, ext]) => {
                    let name = key;
                    try { const info = ext && ext.getInfo ? ext.getInfo() : null; if (info && info.name) name = info.name + ' (id: ' + (info.id || key) + ')'; } catch (e2) { /* ignore */ }
                    return name;
                  });
                  result = { success: false, error: 'Extension not found. Available: ' + available.join(', ') };
                  break;
                }
                // Try to get the source code
                let sourceCode = '';
                let sourceType = '';
                if (matchedKey.startsWith('data:')) {
                  // Data URL - decode the source
                  sourceType = 'data-url';
                  try {
                    const commaIdx = matchedKey.indexOf(',');
                    if (commaIdx >= 0) sourceCode = decodeURIComponent(matchedKey.substring(commaIdx + 1));
                  } catch (e2) { sourceCode = '(Failed to decode data URL)'; }
                } else if (matchedKey.startsWith('http://') || matchedKey.startsWith('https://')) {
                  // HTTP URL - fetch the source
                  sourceType = 'url';
                  try {
                    const response = await fetch(matchedKey);
                    sourceCode = await response.text();
                  } catch (e2) { sourceCode = '(Failed to fetch from ' + matchedKey + ': ' + e2.message + ')'; }
                } else {
                  // Built-in or unknown - try to get constructor source
                  sourceType = 'builtin';
                  try {
                    if (matchedExt && matchedExt.constructor) {
                      sourceCode = '// Extension: ' + matchedKey + '\n// Type: ' + sourceType + '\n// Constructor source:\n' + matchedExt.constructor.toString();
                    } else if (matchedExt && typeof matchedExt === 'function') {
                      sourceCode = matchedExt.toString();
                    } else {
                      // Try to serialize the extension info
                      const info = matchedExt && matchedExt.getInfo ? matchedExt.getInfo() : null;
                      sourceCode = '// Extension: ' + matchedKey + '\n// Type: ' + sourceType + ' (source not available)\n// Extension info:\n' + JSON.stringify(info, null, 2);
                    }
                  } catch (e2) { sourceCode = '(Failed to get source: ' + e2.message + ')'; }
                }
                // Truncate if too long
                const maxLength = 50000;
                let truncated = false;
                if (sourceCode.length > maxLength) { sourceCode = sourceCode.substring(0, maxLength) + '\n\n... (truncated, total ' + sourceCode.length + ' chars)'; truncated = true; }
                // Get extension info for context
                let extInfo = null;
                try { extInfo = matchedExt && matchedExt.getInfo ? matchedExt.getInfo() : null; } catch (e2) { /* ignore */ }
                result = {
                  success: true,
                  data: {
                    extensionKey: matchedKey,
                    sourceType: sourceType,
                    sourceCode: sourceCode,
                    truncated: truncated,
                    info: extInfo ? { id: extInfo.id, name: extInfo.name, blockCount: extInfo.blocks ? extInfo.blocks.length : 0 } : null
                  }
                };
              } catch (e) { result = { success: false, error: 'Failed to get extension code: ' + e.message }; }
              break;
            }
            case 'sendKeyToStage': {
              try {
                const key = params.key;
                if (!key) { result = { success: false, error: 'No key provided' }; break; }
                const duration = Number(params.duration) || 100;
                // Key code mapping for common keys
                const keyCodeMap = {
                  'space': 32, 'enter': 13, 'return': 13, 'tab': 9, 'escape': 27, 'esc': 27,
                  'backspace': 8, 'delete': 46, 'home': 36, 'end': 35, 'page up': 33, 'page down': 34,
                  'up': 38, 'down': 40, 'left': 37, 'right': 39,
                  'shift': 16, 'control': 17, 'ctrl': 17, 'alt': 18, 'option': 18, 'meta': 91, 'command': 91
                };
                const normalizedKey = key.toLowerCase();
                const keyCode = keyCodeMap[normalizedKey] || (normalizedKey.length === 1 ? normalizedKey.charCodeAt(0) : 0);
                // Send key down
                vm.postIOData('keyboard', {
                  key: normalizedKey,
                  code: keyCode,
                  isDown: true
                });
                // Hold the key for the specified duration
                await new Promise(resolve => setTimeout(resolve, duration));
                // Send key up
                vm.postIOData('keyboard', {
                  key: normalizedKey,
                  code: keyCode,
                  isDown: false
                });
                result = { success: true, data: { key: normalizedKey, keyCode: keyCode, duration: duration, message: 'Key "' + key + '" sent to stage' } };
              } catch (e) { result = { success: false, error: 'Failed to send key: ' + e.message }; }
              break;
            }
            case 'duplicateSprite': {
              try {
                const sourceName = params.sourceName || '';
                const newName = params.newName || '';
                if (!sourceName) { result = { success: false, error: 'No source sprite name provided' }; break; }
                if (!newName) { result = { success: false, error: 'No new sprite name provided' }; break; }
                const target = vm.runtime.targets.find(t => t.getName() === sourceName);
                if (!target) { result = { success: false, error: 'Sprite "' + sourceName + '" not found' }; break; }
                await vm.duplicateSprite(target.id);
                vm.renameSprite(vm.editingTarget.id, newName);
                result = { success: true, data: { sourceName: sourceName, newName: newName, message: 'Sprite "' + sourceName + '" duplicated as "' + newName + '"' } };
              } catch (e) { result = { success: false, error: 'Failed to duplicate sprite: ' + e.message }; }
              break;
            }
            default:
              result = { success: false, error: 'Unknown tool: ' + toolName };
          }
        } catch (e) {
          result = { success: false, error: e.message };
        }
        EditorPreload.sendAIToolResponse({ requestId, result });
      });

      EditorPreload.onRequestSpriteLibrary(() => {
        try {
          import(
            /* webpackChunkName: "sprite-library" */
            'scratch-gui/src/lib/libraries/tw-async-libraries'
          ).then(module => {
            const library = module.getSpriteLibrary();
            const resolveLibrary = (data) => {
              EditorPreload.sendSpriteLibrary(data);
            };
            if (library && library.then) {
              library.then(resolveLibrary);
            } else {
              resolveLibrary(library);
            }
          }).catch(() => {
            EditorPreload.sendSpriteLibrary([]);
          });
        } catch (e) {
          EditorPreload.sendSpriteLibrary([]);
        }
      });

      EditorPreload.onRequestTheme((data) => {
        try {
          const raw = localStorage.getItem('tw:theme');
          let isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          if (raw) {
            if (raw === '"dark"' || raw === 'dark') {
              isDark = true;
            } else if (raw === '"light"' || raw === 'light') {
              isDark = false;
            } else {
              try {
                const parsed = JSON.parse(raw);
                if (parsed.gui === 'dark') isDark = true;
                if (parsed.gui === 'light') isDark = false;
              } catch(e) {}
            }
          }
          EditorPreload.sendTheme({ requestId: data.requestId, theme: isDark ? 'dark' : 'light' });
        } catch (e) {
          EditorPreload.sendTheme({ requestId: data.requestId, theme: 'light' });
        }
      });

      var lastTheme = null;
      var checkThemeChange = function() {
        try {
          var raw = localStorage.getItem('tw:theme');
          var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          if (raw) {
            if (raw === '"dark"' || raw === 'dark') {
              isDark = true;
            } else if (raw === '"light"' || raw === 'light') {
              isDark = false;
            } else {
              try {
                var parsed = JSON.parse(raw);
                if (parsed.gui === 'dark') isDark = true;
                if (parsed.gui === 'light') isDark = false;
              } catch(e) {}
            }
          }
          var current = isDark ? 'dark' : 'light';
          if (lastTheme !== null && lastTheme !== current) {
            lastTheme = current;
            document.documentElement.setAttribute('data-gui-theme', current);
            EditorPreload.notifyThemeChanged(current);
          } else if (lastTheme === null) {
            lastTheme = current;
            document.documentElement.setAttribute('data-gui-theme', current);
          }
        } catch(e) {}
      };
      var themeInterval = setInterval(checkThemeChange, 1000);

      // This component is re-mounted when the locale changes, but we only want to load
      // the initial project once.
      if (mountedOnce) {
        return;
      }
      mountedOnce = true;

      this.props.onLoadingStarted();
      (async () => {
        // Note that 0 is a valid ID and does mean there is a file open
        const id = await EditorPreload.getInitialFile();
        if (id === null) {
          this.props.onHasInitialProject(false, this.props.loadingState);
          this.props.onLoadingCompleted();
          return;
        }

        this.props.onHasInitialProject(true, this.props.loadingState);
        const fileInfo = await EditorPreload.getFile(id);

        let projectData = fileInfo.data;

        // Handle encrypted .npnp files
        if (fileInfo.isEncrypted) {
          let decrypted = false;
          while (!decrypted) {
            const password = await showPasswordDialog();
            if (!password) {
              // User cancelled - load default project instead
              this.props.onLoadingCompleted();
              this.props.onLoadedProject(this.props.loadingState, false);
              this.props.onHasInitialProject(false, this.props.loadingState);
              this.props.onRequestNewProject();
              return;
            }
            try {
              projectData = await EditorPreload.decryptNpnpFile(id, password);
              decrypted = true;
            } catch (e) {
              // Wrong password, show dialog again
              continue;
            }
          }
        }

        await this.props.vm.loadProject(projectData);
        this.props.onLoadingCompleted();
        this.props.onLoadedProject(this.props.loadingState, true);

        const title = getDefaultProjectTitle(fileInfo.name);
        if (title) {
          this.setState({
            title
          });
        }

        if (fileInfo.type === 'file' && (fileInfo.name.endsWith('.sb3') || fileInfo.name.endsWith('.np1') || fileInfo.name.endsWith('.npnp'))) {
          this.props.onSetFileHandle(new WrappedFileHandle(id, fileInfo.name));
        }

        // Handle .viewsb3 view-only mode: lock to fullscreen stage
        if (fileInfo.isViewOnly) {
          this.props.onSetViewOnly(true);
          // Delay fullscreen slightly to ensure stage is rendered
          setTimeout(() => {
            this.props.onSetFullScreen(true);
          }, 100);
        }
      })().catch(error => {
        console.error(error);

        this.props.onShowErrorModal(error);
        this.props.onLoadingCompleted();
        this.props.onLoadedProject(this.props.loadingState, false);
        this.props.onHasInitialProject(false, this.props.loadingState);
        this.props.onRequestNewProject();
      });
    }
    updateTopBarDeviceStats () {
      const enabled = EditorPreload.getTopBarDeviceStats ? EditorPreload.getTopBarDeviceStats() : false;
      if (enabled) {
        if (!this._topBarStatsElement) {
          this._topBarStatsElement = document.createElement('div');
          this._topBarStatsElement.style.cssText = 'position:fixed;top:4px;right:12px;z-index:99999;display:flex;gap:8px;align-items:center;font-size:11px;font-family:monospace;pointer-events:none;background:rgba(0,0,0,0.45);color:#fff;padding:2px 8px;border-radius:4px;backdrop-filter:blur(4px);';
          this._topBarStatsElement.innerHTML = '<span class="tw-cpu-stat">CPU: --</span><span class="tw-mem-stat">RAM: --</span>';
          document.body.appendChild(this._topBarStatsElement);
          this._topBarStatsInterval = setInterval(() => {
            if (!this._topBarStatsElement) return;
            EditorPreload.getSystemStats().then(stats => {
              if (!this._topBarStatsElement) return;
              const cpuEl = this._topBarStatsElement.querySelector('.tw-cpu-stat');
              const memEl = this._topBarStatsElement.querySelector('.tw-mem-stat');
              if (cpuEl) cpuEl.textContent = 'CPU: ' + stats.cpuPercent + '%';
              if (memEl) {
                const memUsed = Math.round(stats.usedMemory / 1024 / 1024);
                const memTotal = Math.round(stats.totalMemory / 1024 / 1024);
                const memPercent = Math.round(stats.usedMemory / stats.totalMemory * 100);
                memEl.textContent = 'RAM: ' + memPercent + '% (' + memUsed + '/' + memTotal + 'MB)';
              }
            }).catch(() => {});
          }, 2000);
        }
      } else {
        if (this._topBarStatsElement) {
          this._topBarStatsElement.remove();
          this._topBarStatsElement = null;
        }
        if (this._topBarStatsInterval) {
          clearInterval(this._topBarStatsInterval);
          this._topBarStatsInterval = null;
        }
      }
    }
    componentDidUpdate (prevProps, prevState) {
      if (this.props.projectChanged !== prevProps.projectChanged) {
        EditorPreload.setChanged(this.props.projectChanged);
      }

      if (this.state.title !== prevState.title) {
        document.title = this.state.title;
      }

      if (this.props.fileHandle !== prevProps.fileHandle) {
        if (this.props.fileHandle) {
          EditorPreload.openedFile(this.props.fileHandle.id);
        } else {
          EditorPreload.closedFile();
        }
      }

      if (this.props.reduxUsername !== prevProps.reduxUsername) {
        localStorage.setItem(USERNAME_KEY, this.props.reduxUsername);
      }

      if (this.props.isFullScreen !== prevProps.isFullScreen) {
        EditorPreload.setIsFullScreen(this.props.isFullScreen);
      }

      // NeoWarp: 当新建项目加载完成时，自动添加标记了“自动添加到新项目”的扩展
      if (prevProps.loadingState === LoadingState.LOADING_VM_NEW_DEFAULT &&
          this.props.loadingState === LoadingState.SHOWING_WITHOUT_ID) {
        this.loadAutoAddExtensions();
      }
    }
    // NeoWarp: 加载标记了“自动添加到新项目”的我的扩展
    loadAutoAddExtensions () {
      const vm = this.props.vm;
      if (!vm || !vm.extensionManager || !vm.extensionManager.loadExtensionURL) return;
      const extensions = getAutoAddExtensions();
      if (!extensions.length) return;
      // 顺序加载，避免并发冲突；单个失败不影响其它
      extensions.reduce((promise, ext) => promise.then(() => {
        const url = ext.extensionURL;
        if (!url) return Promise.resolve();
        // 若扩展需要脱离沙盒运行，先信任它
        if (ext.unsandboxed) {
          manuallyTrustExtension(url);
        }
        return vm.extensionManager.loadExtensionURL(url).catch(e => {
          console.error('Auto-add extension failed:', ext.name, e);
        });
      }), Promise.resolve());
    }
    componentWillUnmount () {
      stopFrameStreaming();
      isStageDetached = false;
      if (this._flyoutFrostInterval) {
        clearInterval(this._flyoutFrostInterval);
        this._flyoutFrostInterval = null;
      }
      if (this._codeAreaBackgroundObserver) {
        this._codeAreaBackgroundObserver.disconnect();
        this._codeAreaBackgroundObserver = null;
      }
      if (this._stageAreaBackgroundObserver) {
        this._stageAreaBackgroundObserver.disconnect();
        this._stageAreaBackgroundObserver = null;
      }
      if (this._codeAreaBackgroundTimeouts) {
        this._codeAreaBackgroundTimeouts.forEach(id => clearTimeout(id));
        this._codeAreaBackgroundTimeouts = [];
      }
      if (this._stageAreaBackgroundTimeouts) {
        this._stageAreaBackgroundTimeouts.forEach(id => clearTimeout(id));
        this._stageAreaBackgroundTimeouts = [];
      }
      if (this._topBarStatsElement) {
        this._topBarStatsElement.remove();
        this._topBarStatsElement = null;
      }
      if (this._topBarStatsInterval) {
        clearInterval(this._topBarStatsInterval);
        this._topBarStatsInterval = null;
      }
    }
    setupFlyoutFrostedGlass () {
      const injectionDiv = document.querySelector('.injectionDiv');
      if (!injectionDiv) return;

      const existing = injectionDiv.querySelector('#neowarp-flyout-frost');
      if (existing) existing.remove();

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const bgColor = isDark ? 'rgba(17, 17, 17, 0.35)' : 'rgba(255, 255, 255, 0.35)';

      const frostDiv = document.createElement('div');
      frostDiv.id = 'neowarp-flyout-frost';
      frostDiv.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        backdrop-filter: blur(12px) saturate(1.5);
        -webkit-backdrop-filter: blur(12px) saturate(1.5);
        background: ${bgColor};
        z-index: 2;
        pointer-events: none;
        display: none;
      `;
      injectionDiv.appendChild(frostDiv);

      const toggleFrost = () => {
        const flyout = document.querySelector('.blocklyFlyout');
        if (!flyout) {
          frostDiv.style.display = 'none';
          return;
        }
        let visible = false;
        if (flyout.style.display !== 'none') {
          const bg = flyout.querySelector('.blocklyFlyoutBackground');
          if (bg) {
            try {
              if (bg.getAttribute('width') && parseFloat(bg.getAttribute('width')) > 0) {
                visible = true;
              }
            } catch (e) {
              visible = true;
            }
          } else {
            visible = true;
          }
        }
        frostDiv.style.display = visible ? 'block' : 'none';
      };

      toggleFrost();
      this._flyoutFrostInterval = setInterval(toggleFrost, 300);

      const flyoutEl = document.querySelector('.blocklyFlyout');
      if (flyoutEl) {
        const observer = new MutationObserver(toggleFrost);
        observer.observe(flyoutEl, { attributes: true, childList: true, subtree: true });
      }
    }
    // NeoWarp: Apply a project state received from a collaborator.
    // The cooldown after loadProject swallows PROJECT_CHANGED events that
    // fire after deserialization, so remote updates don't echo back out.
    applyCollabProjectUpdate (data) {
      this._collabLoadingProject = true;
      // The incoming remote state supersedes any broadcast still pending
      if (this._collabSyncTimer) {
        clearTimeout(this._collabSyncTimer);
        this._collabSyncTimer = null;
      }
      try {
        const project = typeof data.project === 'string' ? JSON.parse(data.project) : data.project;
        this.props.vm.loadProject(project).then(() => {
          this._collabLoadCooldown = setTimeout(() => {
            this._collabLoadingProject = false;
            const pending = this._collabPendingProject;
            if (pending) {
              this._collabPendingProject = null;
              this.applyCollabProjectUpdate(pending);
            }
          }, 1200);
        }).catch(() => {
          this._collabLoadingProject = false;
        });
      } catch (e) {
        this._collabLoadingProject = false;
      }
    }

    wrapVMWithPermissions () {
      const vm = this.props.vm;
      if (!vm) return;

      const collabState = this.state.collaborationState;
      const isParticipant = collabState && collabState.isCollaborating && collabState.role === 'participant';

      // Only wrap once
      if (!this._vmWrapped) {
        this._originalDeleteSprite = vm.deleteSprite.bind(vm);
        if (vm.extensionManager) {
          this._originalLoadExtensionURL = vm.extensionManager.loadExtensionURL
            ? vm.extensionManager.loadExtensionURL.bind(vm.extensionManager)
            : null;
        }
        this._vmWrapped = true;
      }

      const self = this;

      // Wrap deleteSprite
      vm.deleteSprite = function (...args) {
        if (isParticipant) {
          const perms = collabState.permissions || {};
          if (perms.allowDeleteSprite === false) {
            alert('无权限执行此操作');
            return;
          }
        }
        return self._originalDeleteSprite(...args);
      };

      // Wrap extensionManager.loadExtensionURL
      if (vm.extensionManager && this._originalLoadExtensionURL) {
        vm.extensionManager.loadExtensionURL = function (...args) {
          if (isParticipant) {
            const perms = collabState.permissions || {};
            if (perms.allowAddExtension === false) {
              alert('无权限执行此操作');
              return Promise.reject(new Error('Permission denied: add extension'));
            }
          }
          return self._originalLoadExtensionURL(...args);
        };
      }
    }

    handleUpdateProjectTitle (newTitle) {
      this.setState({
        title: newTitle
      });
    }
    async handleClickEncryptedSave () {
      const result = await showEncryptedSaveDialog(this.state.title);
      if (!result) return;

      try {
        const sb3Data = await this.props.vm.saveProjectSb3('arraybuffer');
        const saveResult = await EditorPreload.showEncryptedSaveFilePicker(result.title);
        if (!saveResult) return;

        await EditorPreload.encryptAndSave(saveResult.id, sb3Data, result.password);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error('Encrypted save failed:', e);
      }
    }
    async handleSaveAsViewsb3 () {
      try {
        const sb3Data = await this.props.vm.saveProjectSb3('arraybuffer');
        const title = this.state.title || 'project';
        const saveResult = await EditorPreload.showViewsb3SaveFilePicker(title);
        if (!saveResult) return;

        await EditorPreload.encryptAndSaveViewsb3(saveResult.id, sb3Data);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error('View-only save failed:', e);
      }
    }
    applyCodeAreaBackground (backgroundImage) {
        this._codeAreaBackgroundImage = backgroundImage;

        // Clear pending timeouts
        if (this._codeAreaBackgroundTimeouts) {
            this._codeAreaBackgroundTimeouts.forEach(id => clearTimeout(id));
        }
        this._codeAreaBackgroundTimeouts = [];

        // Clear existing observer
        if (this._codeAreaBackgroundObserver) {
            this._codeAreaBackgroundObserver.disconnect();
            this._codeAreaBackgroundObserver = null;
        }

        this._isApplyingCodeBackground = false;

        const applyBackground = () => {
            this._isApplyingCodeBackground = true;

            const injectionDiv = document.querySelector('.injectionDiv');
            if (injectionDiv) {
                if (this._codeAreaBackgroundImage) {
                    injectionDiv.style.backgroundImage = `url(${this._codeAreaBackgroundImage})`;
                    injectionDiv.style.backgroundSize = 'cover';
                    injectionDiv.style.backgroundPosition = 'center';
                    injectionDiv.style.backgroundRepeat = 'no-repeat';
                    injectionDiv.style.backgroundColor = 'transparent';
                    injectionDiv.setAttribute('data-custom-background', 'true');
                } else {
                    injectionDiv.style.backgroundImage = '';
                    injectionDiv.style.backgroundSize = '';
                    injectionDiv.style.backgroundPosition = '';
                    injectionDiv.style.backgroundRepeat = '';
                    injectionDiv.style.backgroundColor = '';
                    injectionDiv.removeAttribute('data-custom-background');
                }
            }
            const blocklySvg = injectionDiv ? injectionDiv.querySelector('.blocklySvg') : document.querySelector('.blocklySvg');
            if (blocklySvg) {
                if (this._codeAreaBackgroundImage) {
                    blocklySvg.style.backgroundColor = 'transparent';
                } else {
                    blocklySvg.style.backgroundColor = '';
                }
            }

            // Reset flag after current frame so observer can catch future external changes
            requestAnimationFrame(() => {
                this._isApplyingCodeBackground = false;
            });
        };

        applyBackground();

        // Use MutationObserver to immediately restore background when overridden by Blockly/React
        if (backgroundImage) {
            const setupObserver = () => {
                const injectionDiv = document.querySelector('.injectionDiv');
                if (!injectionDiv) return false;

                this._codeAreaBackgroundObserver = new MutationObserver(() => {
                    if (this._isApplyingCodeBackground) return;
                    if (!this._codeAreaBackgroundImage) return;

                    const div = document.querySelector('.injectionDiv');
                    if (div && div.getAttribute('data-custom-background') !== 'true') {
                        applyBackground();
                    }
                });

                this._codeAreaBackgroundObserver.observe(injectionDiv, {
                    attributes: true,
                    subtree: true,
                    attributeFilter: ['style']
                });
                return true;
            };

            // Try to set up observer immediately; if element doesn't exist yet, retry once
            if (!setupObserver()) {
                const retryId = setTimeout(() => {
                    if (!this._codeAreaBackgroundObserver) {
                        setupObserver();
                    }
                }, 500);
                this._codeAreaBackgroundTimeouts.push(retryId);
            }
        }
    }
    applyStageAreaBackground (backgroundImage) {
        this._stageAreaBackgroundImage = backgroundImage;

        // Clear pending timeouts
        if (this._stageAreaBackgroundTimeouts) {
            this._stageAreaBackgroundTimeouts.forEach(id => clearTimeout(id));
        }
        this._stageAreaBackgroundTimeouts = [];

        // Clear existing observer
        if (this._stageAreaBackgroundObserver) {
            this._stageAreaBackgroundObserver.disconnect();
            this._stageAreaBackgroundObserver = null;
        }

        this._isApplyingStageBackground = false;

        const applyBackground = () => {
            this._isApplyingStageBackground = true;

            const stageArea = document.querySelector('[class*="stage-and-target-wrapper"]');
            if (stageArea) {
                if (this._stageAreaBackgroundImage) {
                    stageArea.style.backgroundImage = `url(${this._stageAreaBackgroundImage})`;
                    stageArea.style.backgroundSize = 'cover';
                    stageArea.style.backgroundPosition = 'center';
                    stageArea.style.backgroundRepeat = 'no-repeat';
                    stageArea.setAttribute('data-custom-background', 'true');
                } else {
                    stageArea.style.backgroundImage = '';
                    stageArea.style.backgroundSize = '';
                    stageArea.style.backgroundPosition = '';
                    stageArea.style.backgroundRepeat = '';
                    stageArea.removeAttribute('data-custom-background');
                }
            }

            requestAnimationFrame(() => {
                this._isApplyingStageBackground = false;
            });
        };

        applyBackground();

        // Use MutationObserver to immediately restore background when overridden
        if (backgroundImage) {
            const setupObserver = () => {
                const stageArea = document.querySelector('[class*="stage-and-target-wrapper"]');
                if (!stageArea) return false;

                this._stageAreaBackgroundObserver = new MutationObserver(() => {
                    if (this._isApplyingStageBackground) return;
                    if (!this._stageAreaBackgroundImage) return;

                    const area = document.querySelector('[class*="stage-and-target-wrapper"]');
                    if (area && area.getAttribute('data-custom-background') !== 'true') {
                        applyBackground();
                    }
                });

                this._stageAreaBackgroundObserver.observe(stageArea, {
                    attributes: true,
                    attributeFilter: ['style']
                });
                return true;
            };

            if (!setupObserver()) {
                const retryId = setTimeout(() => {
                    if (!this._stageAreaBackgroundObserver) {
                        setupObserver();
                    }
                }, 500);
                this._stageAreaBackgroundTimeouts.push(retryId);
            }
        }
    }
    render() {
      const {
        locale,
        loadingState,
        projectChanged,
        fileHandle,
        reduxUsername,
        onFetchedInitialProjectData,
        onHasInitialProject,
        onLoadedProject,
        onLoadingCompleted,
        onLoadingStarted,
        onRequestNewProject,
        onSetFileHandle,
        onSetReduxUsername,
        onShowErrorModal,
        vm,
        ...props
      } = this.props;
      return (
        <WrappedComponent
          projectTitle={this.state.title}
          onUpdateProjectTitle={this.handleUpdateProjectTitle}
          onClickAddonSettings={handleClickAddonSettings}
          onClickNewWindow={handleClickNewWindow}
          onClickPackager={handleClickPackager}
          onClickEncryptedSave={this.handleClickEncryptedSave}
          onViewsb3Save={this.handleSaveAsViewsb3}
          onClickAbout={[
            {
              title: this.messages['in-app-about.desktop-settings'],
              onClick: handleClickDesktopSettings
            },
            {
              title: this.messages['in-app-about.privacy'],
              onClick: handleClickPrivacy
            },
            {
              title: this.messages['in-app-about.about'],
              onClick: handleClickAbout
            },
            {
              title: this.messages['in-app-about.contact-us'] || 'Contact Us',
              onClick: handleClickContact
            },
            {
              title: this.messages['in-app-about.source-code'],
              onClick: handleClickSourceCode
            },
            {
              title: this.messages['in-app-about.feedback'] || 'NeoWarp Feedback',
              onClick: handleClickFeedback
            },
          ]}
          onClickDesktopSettings={handleClickDesktopSettings}
          onClickAI={handleClickAI}
          onClickTodoList={handleClickTodoList}
          onClickProjectAnalysis={handleClickProjectAnalysis}
          onClickMobilePreview={handleClickMobilePreview}
          onClickDetachStage={isStageDetached ? handleReattachStage : () => handleDetachStage(this.props.vm)}
          onClickCollaborationHost={handleClickCollaborationHost}
          onClickCollaborationJoin={handleClickCollaborationJoin}
          onClickCollaborationChat={handleClickCollaborationChat}
          onClickEndCollaboration={handleClickEndCollaboration}
          onClickLeaveCollaboration={handleClickLeaveCollaboration}
          collaborationState={this.state.collaborationState}
          securityManager={securityManager}
          {...props}
        />
      );
    }
  }

  DesktopComponent.propTypes = {
    locale: PropTypes.string.isRequired,
    loadingState: PropTypes.string.isRequired,
    projectChanged: PropTypes.bool.isRequired,
    fileHandle: PropTypes.shape({
      id: PropTypes.string.isRequired
    }),
    isFullScreen: PropTypes.bool.isRequired,
    isViewOnly: PropTypes.bool.isRequired,
    reduxUsername: PropTypes.string.isRequired,
    onFetchedInitialProjectData: PropTypes.func.isRequired,
    onHasInitialProject: PropTypes.func.isRequired,
    onLoadedProject: PropTypes.func.isRequired,
    onLoadingCompleted: PropTypes.func.isRequired,
    onLoadingStarted: PropTypes.func.isRequired,
    onRequestNewProject: PropTypes.func.isRequired,
    onSetFileHandle: PropTypes.func.isRequired,
    onSetReduxUsername: PropTypes.func.isRequired,
    onSetViewOnly: PropTypes.func.isRequired,
    onSetFullScreen: PropTypes.func.isRequired,
    onShowErrorModal: PropTypes.func.isRequired,
    onViewsb3Save: PropTypes.func,
    vm: PropTypes.shape({
      loadProject: PropTypes.func.isRequired
    }).isRequired
  };

  const mapStateToProps = state => ({
    locale: state.locales.locale,
    loadingState: state.scratchGui.projectState.loadingState,
    isFullScreen: state.scratchGui.mode.isFullScreen,
    isViewOnly: state.scratchGui.mode.isViewOnly,
    projectChanged: state.scratchGui.projectChanged,
    fileHandle: state.scratchGui.tw.fileHandle,
    reduxUsername: state.scratchGui.tw.username,
    vm: state.scratchGui.vm
  });

  const mapDispatchToProps = dispatch => ({
    onLoadingStarted: () => dispatch(openLoadingProject()),
    onLoadingCompleted: () => dispatch(closeLoadingProject()),
    onHasInitialProject: (hasInitialProject, loadingState) => {
      if (hasInitialProject) {
        return dispatch(requestProjectUpload(loadingState));
      }
      return dispatch(setProjectId(defaultProjectId));
    },
    onFetchedInitialProjectData: (projectData, loadingState) => dispatch(onFetchedProjectData(projectData, loadingState)),
    onLoadedProject: (loadingState, loadSuccess) => {
      return dispatch(onLoadedProject(loadingState, /* canSave */ false, loadSuccess));
    },
    onRequestNewProject: () => dispatch(requestNewProject(false)),
    onSetFileHandle: fileHandle => dispatch(setFileHandle(fileHandle)),
    onSetReduxUsername: username => dispatch(setUsername(username)),
    onSetViewOnly: isViewOnly => dispatch(setViewOnly(isViewOnly)),
    onSetFullScreen: isFullScreen => dispatch(setFullScreen(isFullScreen)),
    onShowErrorModal: error => {
      dispatch(setProjectError(error));
      dispatch(openInvalidProjectModal());
    }
  });

  return connect(
    mapStateToProps,
    mapDispatchToProps
  )(DesktopComponent);
};

export default DesktopHOC;
