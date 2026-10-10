const {app, nativeTheme} = require('electron');
const fs = require('fs');
const path = require('path');
const AbstractWindow = require('./abstract');
const settings = require('../settings');
const {getLocale, updateLocale} = require('../l10n');
const {APP_NAME} = require('../brand');
const {getEffectiveTheme} = require('../effective-theme');
const {registerAiModelConfigIpc} = require('../ai-model-configs');
const packageJSON = require('../../package.json');

const LIGHT_BACKGROUND = '#f2f2f7';
const DARK_BACKGROUND = '#0a0a0d';

// 主页默认 Logo，以 data URL 形式提供给引导页（tw-onboarding 协议根目录
// 之外无法直接引用主页的 logo.png）
const LOGO_PATH = path.resolve(__dirname, '../../src-renderer/home/logo.png');
const getLogoDataURL = () => {
  try {
    return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch (e) {
    return null;
  }
};

// 触发引导页的最低版本：已记录的完成版本低于此值时启动时展示。
// 升级此常量即可在后续版本重新引导用户（完成后写入当前版本）。
const ONBOARDING_TARGET = '2.0.1';

/**
 * 解析给定全局主题设置下的实际外观。
 * 固定浅/深色直接返回；跟随系统时取系统外观。
 * @param {'system'|'light'|'dark'} uiTheme
 * @returns {'light'|'dark'}
 */
const resolveThemeFor = (uiTheme) => {
  if (uiTheme === 'light' || uiTheme === 'dark') return uiTheme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

/**
 * 是否需要在本次启动时展示引导页。
 * 新安装（未记录）与已记录版本低于目标版本（如升级到 2.0.1）的用户都会看到。
 * @returns {boolean}
 */
const shouldShowOnboarding = () => {
  const done = settings.onboardingCompletedVersion;
  if (!done) return true;
  try {
    const semverLt = require('semver/functions/lt');
    return semverLt(done, ONBOARDING_TARGET);
  } catch (e) {
    // semvar 不可用时退化为字符串不等比较
    return done !== ONBOARDING_TARGET;
  }
};

class OnboardingWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(APP_NAME);

    this.promise = new Promise((resolve) => {
      this.resolveCallback = resolve;
    });

    // 统一的 AI 模型配置存储（与 AI 助手 / SOLO / 扩展编辑器 / 桌面设置共用）
    registerAiModelConfigIpc(this.ipc);

    this.ipc.on('onboarding-get-info', (event) => {
      event.returnValue = {
        locale: getLocale(),
        version: packageJSON.version,
        uiTheme: settings.uiTheme,
        logo: getLogoDataURL()
      };
    });

    this.ipc.handle('onboarding-get-theme', () => getEffectiveTheme());

    // 渲染进程应用主题后回带，用于同步窗口背景色，避免边缘露底
    this.ipc.on('onboarding-theme-applied', (event, theme) => {
      this.applyWindowBackground(theme);
    });

    this.ipc.handle('onboarding-set-locale', async (event, locale) => {
      if (typeof locale !== 'string' || !locale) return;
      if (settings.locale !== locale) {
        settings.locale = locale;
        updateLocale(locale);
        try {
          const rebuildMenuBar = require('../menu-bar');
          rebuildMenuBar();
        } catch (e) {
          // menu-bar 不可用时忽略
        }
        await settings.save();
        // 广播给可能已打开的 AI 助手 / SOLO 窗口（引导期间通常没有）
        const AIAssistantWindow = require('./ai-assistant');
        for (const w of AbstractWindow.getWindowsByClass(AIAssistantWindow)) {
          if (!w.window.isDestroyed()) {
            w.window.webContents.send('ai-locale-changed', {locale});
          }
        }
        // 桌面设置窗口可能已打开，重载使其与新语言同步
        const DesktopSettingsWindow = require('./desktop-settings');
        DesktopSettingsWindow.reloadAll();
      }
      return {locale};
    });

    this.ipc.handle('onboarding-set-ui-theme', async (event, uiTheme) => {
      if (uiTheme !== 'light' && uiTheme !== 'dark' && uiTheme !== 'system') {
        return null;
      }
      settings.uiTheme = uiTheme;
      await settings.save();
      const theme = resolveThemeFor(uiTheme);
      // 即时更新本引导窗口外观
      this.pushTheme(theme);
      // 同步主页与 AI 助手窗口（引导期间通常尚未打开，但保持一致）
      const HomeWindow = require('./home');
      HomeWindow.broadcastTheme(theme);
      const AIAssistantWindow = require('./ai-assistant');
      AIAssistantWindow.broadcastTheme(theme);
      return {theme};
    });

    this.ipc.handle('onboarding-done', async () => {
      await this.finish();
    });

    // 跟随系统主题时，系统外观变化即时反映到引导页
    this.nativeThemeListener = () => {
      if (settings.uiTheme === 'system' && !this.window.isDestroyed()) {
        this.pushTheme(resolveThemeFor('system'));
      }
    };
    nativeTheme.on('updated', this.nativeThemeListener);

    this.window.on('closed', () => {
      nativeTheme.removeListener('updated', this.nativeThemeListener);
      // 通过标题栏关闭按钮退出时，视作跳过全部并标记完成，避免反复弹出
      if (this.resolveCallback) {
        settings.onboardingCompletedVersion = packageJSON.version;
        settings.save().catch(() => {});
        const resolve = this.resolveCallback;
        this.resolveCallback = null;
        resolve();
      }
    });

    this.loadURL('tw-onboarding://./onboarding.html');
    this.show();
  }

  applyWindowBackground (theme) {
    try {
      this.window.setBackgroundColor(theme === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND);
    } catch (e) {
      // window destroyed
    }
  }

  /**
   * 把主题推给本引导窗口（同时同步背景色）。
   * @param {'light'|'dark'} theme
   */
  pushTheme (theme) {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('onboarding-theme-changed', {theme});
    this.applyWindowBackground(theme);
  }

  /**
   * 标记引导完成并关闭窗口，让启动流程继续打开主页。
   */
  async finish () {
    if (!this.resolveCallback) return;
    settings.onboardingCompletedVersion = packageJSON.version;
    await settings.save();
    const resolve = this.resolveCallback;
    this.resolveCallback = null;
    resolve();
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
  }

  getDimensions () {
    // 与主页保持一致，避免引导窗口显得过小
    return {
      width: 1280,
      height: 800
    };
  }

  getPreload () {
    return 'onboarding';
  }

  isPopup () {
    return false;
  }

  getBackgroundColor () {
    return resolveThemeFor(settings.uiTheme) === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND;
  }

  canExitFullscreenByPressingEscape () {
    return false;
  }

  static run () {
    const window = new OnboardingWindow();
    return window.promise;
  }
}

OnboardingWindow.shouldShowOnboarding = shouldShowOnboarding;
OnboardingWindow.ONBOARDING_TARGET = ONBOARDING_TARGET;

module.exports = OnboardingWindow;
