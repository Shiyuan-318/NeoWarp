// NeoWarp: Override scratch-gui's screen-utils.js to fix fullscreen stage sizing.
// The original menuHeightAdjustment of 88 is too large, causing a blank strip
// at the bottom when the stage is in fullscreen mode.
//
// In fullscreen mode:
// - The stageHeaderWrapperOverlay is position:fixed at top:0 (44px tall)
// - The stageWrapper is position:fixed at top:44px, bottom:0
// - Inside stageWrapper, the stageMenuWrapper Box has 0 height because
//   StageHeader renders a position:fixed overlay that doesn't take up flow space
// - So the canvas starts at top:44px + 3px(padding) = 47px from viewport top
// - menuHeightAdjustment should be 44 (just the wrapper top offset),
//   not 88 (which double-counts the 44px overlay space)

import {
    STAGE_DISPLAY_SCALE_METADATA,
    STAGE_SIZE_MODES,
    STAGE_DISPLAY_SIZES,
    FIXED_WIDTH
} from 'scratch-gui/src/lib/layout-constants';

const maxScaleParam = typeof URLSearchParams !== 'undefined' && new URLSearchParams(location.search).get('scale');

const STAGE_DIMENSION_DEFAULTS = {
    fullScreenSpacingBorderAdjustment: 8,
    menuHeightAdjustment: 44
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
            STAGE_DIMENSION_DEFAULTS.menuHeightAdjustment -
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
