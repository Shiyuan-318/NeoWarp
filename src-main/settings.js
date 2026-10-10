const fs = require('fs');
const path = require('path');
const {app} = require('electron');
const {writeFileAtomic} = require('./atomic-write-stream');

const PATH = path.resolve(app.getPath('userData'), 'tw_config.json');

/**
 * Migrates settings from before v1.9.0.
 * @param {unknown} legacyData
 * @returns {object}
 */
const migrateLegacyData = (legacyData) => {
  const options = {};
  if (typeof legacyData.locale === 'string') {
    options.locale = legacyData.locale;
  }
  if (legacyData.disable_update_checker === true) {
    options.updateChecker = 'never';
  }
  if (legacyData.bypass_cors === true) {
    options.bypassCORS = true;
  }
  if (legacyData.hardware_acceleration === false) {
    options.hardwareAcceleration = false;
  }
  if (legacyData.background_throttling === false) {
    options.backgroundThrottling = false;
  }
  if (typeof legacyData.last_accessed_directory === 'string') {
    options.lastDirectory = legacyData.last_accessed_directory;
  }
  return options;
};

class Settings {
  constructor () {
    try {
      const parsedFile = JSON.parse(fs.readFileSync(PATH, 'utf-8'));
      if (!parsedFile) throw new Error('data is null');

      if (parsedFile.v2) {
        this.data = parsedFile.v2;
      } else {
        this.data = migrateLegacyData(parsedFile);
      }
    } catch (e) {
      // File does not exist or is corrupted
      this.data = {};
    }
  }

  async save () {
    const serialized = {
      v2: this.data
    };
    await writeFileAtomic(PATH, JSON.stringify(serialized, null, 2));
  }

  /**
   * Tracks which manual data migration was most recently have been performed.
   */
  get dataVersion () {
    return this.data.dataVersion || 0;
  }
  set dataVersion (dataVersion) {
    this.data.dataVersion = dataVersion;
  }

  /**
   * Contains the version of the desktop app that was run previously.
   */
  get desktopVersion() {
    return this.data.desktopVersion || '0.0.0';
  }
  set desktopVersion (desktopVersion) {
    this.data.desktopVersion = desktopVersion;
  }

  /**
   * Contains the Electron version used by the version of the desktop app that was run previously.
   */
  get electronVersion() {
    return this.data.electronVersion || '0.0.0';
  }
  set electronVersion(electronVersion) {
    this.data.electronVersion = electronVersion;
  }

  get locale () {
    const locale = this.data.locale || 'en';
    // 引导页旧版本曾写入基础码 "zh"：l10n 与 scratch-gui 都只认 zh-cn/zh-tw，
    // 读取时统一归一化，保证已存在的 "zh" 配置也能加载到中文翻译
    return locale === 'zh' ? 'zh-cn' : locale;
  }
  set locale (locale) {
    this.data.locale = locale === 'zh' ? 'zh-cn' : (locale || 'en');
  }

  get updateChecker () {
    return this.data.updateChecker || 'stable';
  }
  set updateChecker (updateChecker) {
    this.data.updateChecker = updateChecker;
  }

  // 全局 UI 主题：system（跟随系统/编辑器自身设置）、light、dark
  get uiTheme () {
    return this.data.uiTheme || 'system';
  }
  set uiTheme (uiTheme) {
    this.data.uiTheme = uiTheme;
  }

  get ignoredUpdate () {
    return this.data.ignoredUpdate || null;
  }
  set ignoredUpdate (ignoredUpdate) {
    this.data.ignoredUpdate = ignoredUpdate;
  }

  get ignoredUpdateUntil () {
    return this.data.ignoredUpdateUntil || 0;
  }
  set ignoredUpdateUntil (ignoredUpdateUntil) {
    this.data.ignoredUpdateUntil = ignoredUpdateUntil;
  }

  get camera () {
    return this.data.camera || null;
  }
  set camera (camera) {
    this.data.camera = camera;
  }

  get microphone () {
    return this.data.microphone || null;
  }
  set microphone (microphone) {
    this.data.microphone = microphone;
  }

  get bypassCORS () {
    return this.data.bypassCORS === true;
  }
  set bypassCORS (bypassCORS) {
    this.data.bypassCORS = bypassCORS;
  }

  get hardwareAcceleration () {
    return this.data.hardwareAcceleration !== false;
  }
  set hardwareAcceleration (hardwareAcceleration) {
    this.data.hardwareAcceleration = hardwareAcceleration;
  }

  get backgroundThrottling () {
    return this.data.backgroundThrottling !== false;
  }
  set backgroundThrottling (backgroundThrottling) {
    this.data.backgroundThrottling = backgroundThrottling;
  }

  get lastDirectory () {
    return this.data.lastDirectory || app.getPath('downloads');
  }
  set lastDirectory (lastDirectory) {
    this.data.lastDirectory = lastDirectory;
  }

  get spellchecker () {
    return this.data.spellchecker !== false;
  }
  set spellchecker (spellchecker) {
    this.data.spellchecker = spellchecker;
  }

  get exitFullscreenOnEscape () {
    return this.data.exitFullscreenOnEscape !== false;
  }
  set exitFullscreenOnEscape(exitFullscreenOnEscape) {
    this.data.exitFullscreenOnEscape = exitFullscreenOnEscape;
  }

  get richPresence () {
    return this.data.richPresence === true;
  }
  set richPresence (richPresence) {
    this.data.richPresence = richPresence;
  }

  get codeAreaBackgroundImage () {
    return this.data.codeAreaBackgroundImage || null;
  }
  set codeAreaBackgroundImage (codeAreaBackgroundImage) {
    this.data.codeAreaBackgroundImage = codeAreaBackgroundImage;
  }

  get stageAreaBackgroundImage () {
    return this.data.stageAreaBackgroundImage || null;
  }
  set stageAreaBackgroundImage (stageAreaBackgroundImage) {
    this.data.stageAreaBackgroundImage = stageAreaBackgroundImage;
  }

  get aiProviders () {
    return this.data.aiProviders || {};
  }
  set aiProviders (aiProviders) {
    this.data.aiProviders = aiProviders;
  }

  /**
   * 统一的 AI 模型配置列表（AI 助手 / SOLO / 扩展编辑器 / 桌面设置共用）。
   * 每项形状：{id, name, provider, model, apiKey, apiFormat, customEndpoint,
   * customModelId, customContextLimit, thinkingLevel}，与 AI 助手原有
   * savedConfigs 一致。
   */
  get aiModelConfigs () {
    return Array.isArray(this.data.aiModelConfigs) ? this.data.aiModelConfigs : [];
  }
  set aiModelConfigs (aiModelConfigs) {
    this.data.aiModelConfigs = Array.isArray(aiModelConfigs) ? aiModelConfigs : [];
  }

  /**
   * 当前激活的 AI 模型配置 id（所有 AI 界面共用同一激活项）。
   */
  get activeAiModelConfigId () {
    return this.data.activeAiModelConfigId || null;
  }
  set activeAiModelConfigId (activeAiModelConfigId) {
    this.data.activeAiModelConfigId = activeAiModelConfigId || null;
  }

  get topBarDeviceStats () {
    return this.data.topBarDeviceStats === true;
  }
  set topBarDeviceStats (topBarDeviceStats) {
    this.data.topBarDeviceStats = topBarDeviceStats;
  }

  get lastUpdateCheckDate () {
    return this.data.lastUpdateCheckDate || null;
  }
  set lastUpdateCheckDate (lastUpdateCheckDate) {
    this.data.lastUpdateCheckDate = lastUpdateCheckDate;
  }

  /**
   * 主页自定义 Logo：null 表示默认；以 data:image 开头时视为图片，
   * 否则视为自定义 HTML 片段。
   */
  get homeLogo () {
    return this.data.homeLogo || null;
  }
  set homeLogo (homeLogo) {
    this.data.homeLogo = homeLogo;
  }

  /**
   * 主页标题文字：null 表示默认的 "NeoWarp"。
   */
  get homeLogoText () {
    return this.data.homeLogoText || null;
  }
  set homeLogoText (homeLogoText) {
    this.data.homeLogoText = homeLogoText;
  }

  /**
   * 主页自定义背景图：null 表示默认的环境光背景；
   * 以 data:image 开头时视为图片，主页按钮随之切换为液态玻璃效果。
   */
  get homeBackground () {
    return this.data.homeBackground || null;
  }
  set homeBackground (homeBackground) {
    this.data.homeBackground = homeBackground;
  }

  /**
   * 最近打开的本地项目（Scratch 工程与 .js 扩展工程）。
   */
  get recentProjects () {
    return Array.isArray(this.data.recentProjects) ? this.data.recentProjects : [];
  }
  set recentProjects (recentProjects) {
    this.data.recentProjects = recentProjects;
  }

  /**
   * 是否在主页显示"最近项目"。
   */
  get showRecentProjects () {
    return this.data.showRecentProjects !== false;
  }
  set showRecentProjects (showRecentProjects) {
    this.data.showRecentProjects = showRecentProjects === true;
  }

  /**
   * 已完成安装引导的版本（用于判断是否需要展示引导页）。
   * 未设置或低于当前目标版本时，启动时展示引导；完成后写入当前版本。
   */
  get onboardingCompletedVersion () {
    return this.data.onboardingCompletedVersion || '';
  }
  set onboardingCompletedVersion (version) {
    this.data.onboardingCompletedVersion = version || '';
  }
}

module.exports = new Settings();
