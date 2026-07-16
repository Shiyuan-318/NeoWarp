const {Notification} = require('electron');
const settings = require('./settings');
const UpdateWindow = require('./windows/update');
const packageJSON = require('../package.json');
const privilegedFetch = require('./fetch');
const openExternal = require('./open-external');

const currentVersion = packageJSON.version;
const GITHUB_REPO = 'Shiyuan-318/NeoWarp';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/**
 * Determines whether the update checker is even allowed to be enabled
 * in this build of the app.
 * @returns {boolean}
 */
const isUpdateCheckerAllowed = () => {
  if (process.env.TW_DISABLE_UPDATE_CHECKER) {
    return false;
  }

  // Allow updates for production builds (tw_update set by build script)
  // Also allow updates for self-built or development versions
  // This enables GitHub Release updates for your own distributions
  if (packageJSON.tw_update) {
    return true;
  }

  // For development or self-built versions, allow update checker
  // You can set TW_DISABLE_UPDATE_CHECKER=1 to disable in development
  return true;
};

/**
 * Parse version string from release tag (removes 'v' prefix if present)
 * @param {string} tagName
 * @returns {string}
 */
const parseVersionFromTag = (tagName) => {
  return tagName.startsWith('v') ? tagName.slice(1) : tagName;
};

/**
 * Fetch releases from GitHub
 * @returns {Promise<{stable: object|null, unstable: object|null}>}
 */
const fetchReleases = async () => {
  try {
    const releases = await privilegedFetch.json(GITHUB_API_URL);

    let stable = null;
    let unstable = null;

    for (const release of releases) {
      if (!release.draft) {
        const version = parseVersionFromTag(release.tag_name);

        if (!release.prerelease && !stable) {
          stable = {
            version,
            url: release.html_url,
            name: release.name,
            body: release.body
          };
        } else if (release.prerelease && !unstable) {
          unstable = {
            version,
            url: release.html_url,
            name: release.name,
            body: release.body
          };
        }

        // Stop if we found both
        if (stable && unstable) {
          break;
        }
      }
    }

    return { stable, unstable };
  } catch (error) {
    console.error('Failed to fetch releases from GitHub:', error);
    return { stable: null, unstable: null };
  }
};

/**
 * Get today's date as a string (YYYY-MM-DD format)
 * @returns {string}
 */
const getTodayDateString = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

/**
 * Show a system notification for available update
 * @param {string} version
 * @param {string} releaseUrl
 */
const showUpdateNotification = (version, releaseUrl) => {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: 'NeoWarp 更新可用',
    body: `新版本 ${version} 已发布，点击查看详情`,
    silent: false
  });

  notification.on('click', () => {
    openExternal(releaseUrl);
    notification.close();
  });

  notification.show();
};

/**
 * Check for updates on app startup (once per day)
 */
const checkForUpdatesOnStartup = async () => {
  if (!isUpdateCheckerAllowed()) {
    return;
  }

  const today = getTodayDateString();
  const lastCheckDate = settings.lastUpdateCheckDate;

  // Only check once per day
  if (lastCheckDate === today) {
    return;
  }

  // Update last check date
  settings.lastUpdateCheckDate = today;
  await settings.save();

  const { stable } = await fetchReleases();

  if (!stable) {
    return;
  }

  const semverLt = require('semver/functions/lt');

  // Check if current version is older than latest
  if (semverLt(currentVersion, stable.version)) {
    showUpdateNotification(stable.version, stable.url);
  }
};

/**
 * Manually check for updates (called from desktop settings)
 * @returns {Promise<{hasUpdate: boolean, currentVersion: string, latestVersion?: string, releaseUrl?: string}>}
 */
const manualCheck = async () => {
  if (!isUpdateCheckerAllowed()) {
    return {
      hasUpdate: false,
      currentVersion,
      error: 'Update checker not allowed'
    };
  }

  const { stable } = await fetchReleases();

  if (!stable) {
    return {
      hasUpdate: false,
      currentVersion,
      error: 'No releases found'
    };
  }

  const semverLt = require('semver/functions/lt');
  const hasUpdate = semverLt(currentVersion, stable.version);

  return {
    hasUpdate,
    currentVersion,
    latestVersion: stable.version,
    releaseUrl: stable.url,
    releaseNotes: stable.body
  };
};

/**
 * @param {string} version
 * @param {Date} until
 */
const ignoreUpdate = async (version, until) => {
  settings.ignoredUpdate = version;
  settings.ignoredUpdateUntil = Math.floor(until.getTime() / 1000);
  await settings.save();
};

module.exports = {
  isUpdateCheckerAllowed,
  checkForUpdatesOnStartup,
  manualCheck,
  ignoreUpdate
};
