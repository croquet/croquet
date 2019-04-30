import * as THREE from "three";
import { GlyphLayout } from "./glyphLayout";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const fontPaths = {
    /* eslint-disable global-require */
    Barlow: {
        json: require('../../assets/fonts/Barlow-Medium-msdf.json'),
        atlas: require('../../assets/fonts/Barlow-Medium.png'),
        offsetY: 0,
        cursorOffset: [0, 4],
    },
    Lora: {
        json: require('../../assets/fonts/Lora-Regular-msdf.json'),
        atlas: require('../../assets/fonts/Lora-Regular.png'),
        offsetY: 0,
        cursorOffset: [0, 0],
    },
    Roboto: {
        json: require('../../assets/fonts/Roboto.json'),
        atlas: require('../../assets/fonts/Roboto.png'),
        offsetY: 38,
        cursorOffset: [5, 5],
    },
};

export const defaultFont = "Barlow";

/** @typedef {{atlas: THREE.Texture, measurer: TextLayout, info: {}, offsetY: number, cursorOffset: [number, number]}} LoadedFontEntry */

class FontRegistry {
    constructor() {
        /** @type {Object<string, LoadedFontEntry>} */
        this.loadedFonts = {};
        this.load(defaultFont);
    }

    /** @returns {Promise<LoadedFontEntry>} */
    load(font) {
        return new Promise((resolve, _reject) => {
            if (this.loadedFonts[font]) {
                resolve(this.loadedFonts[font]);
            } else {
                const atlasPath = fontPaths[font].atlas;
                console.log("start loading " + font);
                new THREE.TextureLoader().load(atlasPath, tex => {
                    tex.anisotropy = 4;
                    const fontEntry = {
                        atlas: tex,
                        measurer: new GlyphLayout({font: fontPaths[font].json}),
                        info: fontPaths[font].json,
                        offsetY: fontPaths[font].offsetY,
                        cursorOffset: fontPaths[font].cursorOffset
                    };
                    this.loadedFonts[font] = fontEntry;
                    console.log("loaded", font, fontEntry);
                    resolve(fontEntry);
                });
            }
        });
    }

    expect(font) {
        return this.loadedFonts[font];
    }

    getAtlasFor(font) {
        return this.load(font).then(entry => entry.atlas);
    }

    getInfo(font) {
        return this.expect(font).info;
    }

    getOffsetY(font) {
        return this.expect(font).offsetY;
    }

    getCursorOffset(font) {
        return this.expect(font).cursorOffset;
    }

    getMeasurer(font) {
        return this.expect(font).measurer;
    }

    measureText(text, formatting, font) {
        if (formatting === undefined) formatting = {};
        const fontName = (formatting && formatting.font) || font || defaultFont;
        const scale = ((formatting &&formatting.size) || 10) / 10;
        let m = this.expect(fontName);
        if (!m) {debugger;}
        return m.measurer.measureText(text, scale);
    }
}

export const fontRegistry = new FontRegistry();
