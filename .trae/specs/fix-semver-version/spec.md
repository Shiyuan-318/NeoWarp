# 修复 semver 版本号不合法 Spec

## Why
版本号 `1.0.17.1` 不是合法的 semver 格式（仅支持 MAJOR.MINOR.PATCH 三段），导致 `migrate.js` 中 `semver.lt()` 抛出 `TypeError: Invalid Version`，应用无法启动。

## What Changes
- 将 `package.json` 中 `version` 从 `1.0.17.1` 改为 `1.0.18`

## Impact
- Affected code: `package.json`（版本号）、`src-main/migrate.js`（消费版本号进行 semver 比较）
- 无 breaking change，仅修正版本号格式

## ADDED Requirements
### Requirement: 版本号必须为合法 semver
系统 SHALL 使用符合 semver 规范的三段版本号（MAJOR.MINOR.PATCH）。

#### Scenario: 应用启动时 semver 比较正常
- **WHEN** 用户执行 `npm run electron:start`
- **THEN** `migrate.js` 中 `semver.lt()` 正常执行，不抛出 TypeError
