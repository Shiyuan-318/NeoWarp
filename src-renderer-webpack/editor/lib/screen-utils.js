// NeoWarp: Override scratch-gui's screen-utils.js to fix fullscreen stage sizing.
// The original menuHeightAdjustment of 88 is too large, causing a blank strip
// at the bottom when the stage is in fullscreen mode.
//
// In fullscreen mode (NeoWarp 2026-11):
// - The stage wrapper is position:fixed at top:var(--neowarp-fullscreen-top),
//   bottom:0. That variable is published by the desktop app's gui.css and is
//   the real stage offset from the viewport top:
//     * app menu bar height while the menu bar stays visible
//       (3rem normal, 2.25rem narrow / compact dark)
//     * self-drawn title bar height (2rem) when the menu bar is hidden in
//       full screen because the Windows window style is off
//     * 0 when the OS-level fullscreen hides the title bar too
// - Inside stageWrapper, the stageMenuWrapper Box has 0 height because
//   StageHeader renders the controls as a vertical column that doesn't take
//   up flow space
// - menuHeightAdjustment must equal that same offset, read live

import {
    STAGE_DISPLAY_SCALE_METADATA,
    STAGE_SIZE_MODES,
    STAGE_DISPLAY_SIZES,
    FIXED_WIDTH
} from 'scratch-gui/src/lib/layout-constants';

const maxScaleParam = typeof URLSearchParams !== 'undefined' && new URLSearchParams(location.search).get('scale');

const STAGE_DIMENSION_DEFAULTS = {
    fullScreenSpacingBorderAdjustment: 8
};

const fullscreenStageTop = () => {
    try {
        const style = getComputedStyle(document.documentElement);
        const raw = style.getPropertyValue('--neowarp-fullscreen-top').trim();
        const value = parseFloat(raw);
        if (!isNaN(value) && value >= 0) {
            // Custom properties keep their specified unit; only rem needs converting.
            if (/rem$/.test(raw)) {
                return Math.round(value * parseFloat(style.fontSize || '16'));
            }
            return Math.round(value);
        }
    } catch (e) {
        // DOM not ready; fall through to the default below
    }
    return 48;
};

const resolveStageSize = (stageSizeMode, isUnconstrained) => {
    if (stageSizeMode === STAGE_SIZE_MODES.full && !isUnconstrained) {
        return STAGE_DISPLAY_SIZES.constrained;
    }
    return stageSizeMode;
};

const getStageDimensions = (stageSize, customStageSize, isFullScreen) => {
    const stageDimensions = {
        heightDefault: customStageSize.height,
        widthDefault: customStageSize.width,
        height: 0,
        width: 0,
        scale: 0
    };

    if (isFullScreen) {
        stageDimensions.height = window.innerHeight -
            fullscreenStageTop() -
            STAGE_DIMENSION_DEFAULTS.fullScreenSpacingBorderAdjustment;

        stageDimensions.width = stageDimensions.height * (customStageSize.width / customStageSize.height);

        const maxWidth = maxScaleParam ? (
            Math.min(window.innerWidth, maxScaleParam * customStageSize.width)
        ) : window.innerWidth;
        if (stageDimensions.width > maxWidth) {
            stageDimensions.width = maxWidth;
            stageDimensions.height = stageDimensions.width * (customStageSize.height / customStageSize.width);
        }

        stageDimensions.scale = stageDimensions.width / stageDimensions.widthDefault;
    } else {
        const metadata = STAGE_DISPLAY_SCALE_METADATA[stageSize];
        if (metadata.width) {
            stageDimensions.width = metadata.width;
            stageDimensions.scale = stageDimensions.width / stageDimensions.widthDefault;
            stageDimensions.height = stageDimensions.scale * stageDimensions.heightDefault;
        } else {
            stageDimensions.scale = metadata.scale;
            stageDimensions.height = stageDimensions.scale * stageDimensions.heightDefault;
            stageDimensions.width = stageDimensions.scale * stageDimensions.widthDefault;
        }
    }

    stageDimensions.height = Math.round(stageDimensions.height);
    stageDimensions.width = Math.round(stageDimensions.width);

    return stageDimensions;
};

const getMinWidth = stageSize => {
    const metadata = STAGE_DISPLAY_SCALE_METADATA[stageSize];
    if (metadata.width) {
        return metadata.width;
    }
    return FIXED_WIDTH * metadata.scale;
};

const stageSizeToTransform = ({width, height, widthDefault, heightDefault}) => {
    const scaleX = width / widthDefault;
    const scaleY = height / heightDefault;
    if (scaleX === 1 && scaleY === 1) {
        return;
    }
    return {transform: `scale(${scaleX},${scaleY})`};
};

export {
    getStageDimensions,
    getMinWidth,
    resolveStageSize,
    stageSizeToTransform
};
