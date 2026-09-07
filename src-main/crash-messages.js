const {app, dialog, BrowserWindow} = require('electron');
const {translate} = require('./l10n');
const {APP_NAME} = require('./brand');
const AbstractWindow = require('./windows/abstract');

const showCrashMessage = (window, type, code, reason) => {
  // non-technical users won't know what "OOM" means but may be able to understand
  // what "out of memory" means
  if (reason === 'oom') {
    reason = 'out of memory';
  }

  dialog.showMessageBoxSync(window, {
    title: APP_NAME,
    type: 'error',
    message: translate('crash.title'),
    detail: translate('crash.description')
      .replace('{type}', type)
      .replace('{code}', code)
      .replace('{reason}', reason),
    noLink: true
  });
};

app.on('render-process-gone', (event, webContents, details) => {
  // 把崩溃原因打到控制台，便于在终端里直接看到确切原因（而非只能看弹窗文字）
  const abstractWindow = AbstractWindow.getWindowByWebContents(webContents);
  console.error('[crash] renderer process gone:', JSON.stringify({
    reason: details.reason,
    exitCode: details.exitCode
  }));
  const handled = (
    abstractWindow &&
    abstractWindow.handleRendererProcessGone(details)
  );
  if (!handled) {
    const browserWindow = BrowserWindow.fromWebContents(webContents);
    showCrashMessage(browserWindow, 'Renderer', details.exitCode, details.reason);
  }
});

app.on('child-process-gone', (event, details) => {
  console.error('[crash] child process gone:', JSON.stringify({
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode
  }));
  showCrashMessage(null, details.type, details.exitCode, details.reason);
});
