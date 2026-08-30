import styles from './encrypted-save-dialog.css';

let strings = {
  title: 'Encrypted Save',
  titleLabel: 'Title',
  passwordLabel: 'Password',
  confirmPasswordLabel: 'Confirm Password',
  saveButton: 'Encrypt & Save',
  cancelButton: 'Cancel',
  passwordMismatch: 'Passwords do not match',
  emptyPassword: 'Password cannot be empty',
  emptyTitle: 'Title cannot be empty',
  wrongPassword: 'Wrong password. Please try again.',
  okButton: 'OK'
};

const setStrings = (newStrings) => {
  if (newStrings) {
    strings = { ...strings, ...newStrings };
  }
};

let previousDialog = Promise.resolve(null);

const _showDialog = (defaultTitle) => new Promise((resolve) => {
  const interactiveElements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [tabindex]'));
  const oldInteractiveElementState = new WeakMap();
  for (const el of interactiveElements) {
    oldInteractiveElementState.set(el, el.tabIndex);
    el.tabIndex = -1;
  }

  const outer = document.createElement('div');
  outer.className = styles.outer;

  const inner = document.createElement('div');
  inner.className = styles.inner;
  outer.appendChild(inner);

  // Title
  const titleLabel = document.createElement('label');
  titleLabel.className = styles.label;
  titleLabel.textContent = strings.titleLabel;
  inner.appendChild(titleLabel);

  const titleInput = document.createElement('input');
  titleInput.className = styles.input;
  titleInput.value = defaultTitle || '';
  titleInput.autocomplete = 'off';
  titleInput.placeholder = strings.titleLabel;
  inner.appendChild(titleInput);

  // Password
  const passwordLabel = document.createElement('label');
  passwordLabel.className = styles.label;
  passwordLabel.textContent = strings.passwordLabel;
  inner.appendChild(passwordLabel);

  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = styles.inputWrapper;
  inner.appendChild(passwordWrapper);

  const passwordInput = document.createElement('input');
  passwordInput.className = styles.input;
  passwordInput.type = 'password';
  passwordInput.autocomplete = 'new-password';
  passwordInput.placeholder = strings.passwordLabel;
  passwordWrapper.appendChild(passwordInput);

  const passwordToggle = document.createElement('button');
  passwordToggle.className = styles.toggleButton;
  passwordToggle.type = 'button';
  passwordToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  passwordToggle.setAttribute('aria-label', strings.showPasswordLabel || 'Show password');
  passwordWrapper.appendChild(passwordToggle);

  passwordToggle.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    passwordToggle.innerHTML = isPassword
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  });

  // Confirm Password
  const confirmPasswordLabel = document.createElement('label');
  confirmPasswordLabel.className = styles.label;
  confirmPasswordLabel.textContent = strings.confirmPasswordLabel;
  inner.appendChild(confirmPasswordLabel);

  const confirmPasswordWrapper = document.createElement('div');
  confirmPasswordWrapper.className = styles.inputWrapper;
  inner.appendChild(confirmPasswordWrapper);

  const confirmPasswordInput = document.createElement('input');
  confirmPasswordInput.className = styles.input;
  confirmPasswordInput.type = 'password';
  confirmPasswordInput.autocomplete = 'new-password';
  confirmPasswordInput.placeholder = strings.confirmPasswordLabel;
  confirmPasswordWrapper.appendChild(confirmPasswordInput);

  const confirmPasswordToggle = document.createElement('button');
  confirmPasswordToggle.className = styles.toggleButton;
  confirmPasswordToggle.type = 'button';
  confirmPasswordToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  confirmPasswordToggle.setAttribute('aria-label', strings.showPasswordLabel || 'Show password');
  confirmPasswordWrapper.appendChild(confirmPasswordToggle);

  confirmPasswordToggle.addEventListener('click', () => {
    const isPassword = confirmPasswordInput.type === 'password';
    confirmPasswordInput.type = isPassword ? 'text' : 'password';
    confirmPasswordToggle.innerHTML = isPassword
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  });

  // Error message
  const errorDiv = document.createElement('div');
  errorDiv.className = styles.error;
  errorDiv.style.display = 'none';
  inner.appendChild(errorDiv);

  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = styles.buttonRow;
  inner.appendChild(buttonRow);

  const cancelButton = document.createElement('button');
  cancelButton.className = styles.cancelButton;
  cancelButton.textContent = strings.cancelButton;
  buttonRow.append(cancelButton);

  const saveButton = document.createElement('button');
  saveButton.className = styles.saveButton;
  saveButton.textContent = strings.saveButton;
  buttonRow.append(saveButton);

  const finish = (value) => {
    for (const el of interactiveElements) {
      el.tabIndex = oldInteractiveElementState.get(el);
    }
    document.removeEventListener('keydown', globalOnKeyDown);
    outer.remove();
    resolve(value);
  };

  const showError = (msg) => {
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  };

  const handleSave = () => {
    const title = titleInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!title) {
      showError(strings.emptyTitle);
      titleInput.focus();
      return;
    }
    if (!password) {
      showError(strings.emptyPassword);
      passwordInput.focus();
      return;
    }
    if (password !== confirmPassword) {
      showError(strings.passwordMismatch);
      confirmPasswordInput.focus();
      return;
    }

    finish({ title, password });
  };

  const globalOnKeyDown = (e) => {
    if (e.key === 'Escape') {
      finish(null);
    }
  };
  document.addEventListener('keydown', globalOnKeyDown);

  outer.addEventListener('click', (e) => {
    if (e.target === outer) {
      finish(null);
    }
  });

  cancelButton.addEventListener('click', () => {
    finish(null);
  });

  saveButton.addEventListener('click', handleSave);

  confirmPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  });

  document.body.appendChild(outer);
  titleInput.focus();
  titleInput.select();
});

const showEncryptedSaveDialog = (defaultTitle) => {
  previousDialog = previousDialog.then(() => _showDialog(defaultTitle));
  return previousDialog;
};

// Password dialog for opening .npnp files
const _showPasswordDialog = () => new Promise((resolve) => {
  const interactiveElements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [tabindex]'));
  const oldInteractiveElementState = new WeakMap();
  for (const el of interactiveElements) {
    oldInteractiveElementState.set(el, el.tabIndex);
    el.tabIndex = -1;
  }

  const outer = document.createElement('div');
  outer.className = styles.outer;

  const inner = document.createElement('div');
  inner.className = styles.inner;
  outer.appendChild(inner);

  // Title
  const dialogTitle = document.createElement('div');
  dialogTitle.className = styles.dialogTitle;
  dialogTitle.textContent = strings.passwordLabel;
  inner.appendChild(dialogTitle);

  // Password
  const passwordLabel = document.createElement('label');
  passwordLabel.className = styles.label;
  passwordLabel.textContent = strings.passwordLabel;
  inner.appendChild(passwordLabel);

  const passwordInput = document.createElement('input');
  passwordInput.className = styles.input;
  passwordInput.type = 'password';
  passwordInput.autocomplete = 'current-password';
  passwordInput.placeholder = strings.passwordLabel;
  passwordInput.focus();
  inner.appendChild(passwordInput);

  // Error message
  const errorDiv = document.createElement('div');
  errorDiv.className = styles.error;
  errorDiv.style.display = 'none';
  inner.appendChild(errorDiv);

  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = styles.buttonRow;
  inner.appendChild(buttonRow);

  const cancelButton = document.createElement('button');
  cancelButton.className = styles.cancelButton;
  cancelButton.textContent = strings.cancelButton;
  buttonRow.append(cancelButton);

  const okButton = document.createElement('button');
  okButton.className = styles.saveButton;
  okButton.textContent = strings.okButton || 'OK';
  buttonRow.append(okButton);

  const finish = (value) => {
    for (const el of interactiveElements) {
      el.tabIndex = oldInteractiveElementState.get(el);
    }
    document.removeEventListener('keydown', globalOnKeyDown);
    outer.remove();
    resolve(value);
  };

  const showError = (msg) => {
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  };

  const globalOnKeyDown = (e) => {
    if (e.key === 'Escape') {
      finish(null);
    }
  };
  document.addEventListener('keydown', globalOnKeyDown);

  outer.addEventListener('click', (e) => {
    if (e.target === outer) {
      finish(null);
    }
  });

  cancelButton.addEventListener('click', () => {
    finish(null);
  });

  okButton.addEventListener('click', () => {
    const password = passwordInput.value;
    if (!password) {
      showError(strings.emptyPassword);
      passwordInput.focus();
      return;
    }
    finish(password);
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const password = passwordInput.value;
      if (!password) {
        showError(strings.emptyPassword);
        passwordInput.focus();
        return;
      }
      finish(password);
    }
  });

  document.body.appendChild(outer);
  passwordInput.focus();
});

let previousPasswordDialog = Promise.resolve(null);

const showPasswordDialog = () => {
  previousPasswordDialog = previousPasswordDialog.then(() => _showPasswordDialog());
  return previousPasswordDialog;
};

export {
  setStrings,
  showEncryptedSaveDialog,
  showPasswordDialog
};
