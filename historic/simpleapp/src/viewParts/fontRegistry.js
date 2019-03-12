import * as THREE from 'three';
import { TextLayout } from '../stateParts/textlayout.js';

const fontPaths = {
    /* eslint-disable global-require */
    Barlow: {
        json: require('../../assets/fonts/Barlow-Medium-msdf.json'),
        atlas: require('../../assets/fonts/Barlow-Medium.png')
    },
    Lora: {
        json: require('../../assets/fonts/Lora-Regular-msdf.json'),
        atlas: require('../../assets/fonts/Lora-Regular.png')
    },
    Roboto: {
        json: require('../../assets/fonts/Roboto.json'),
        atlas: require('../../assets/fonts/Roboto.png')
    },
};
const defaultFont = "Roboto";

class FontRegistry {
    constructor() {
        this.fonts = {}; // {name<string>: aTexture}
        this.measurers = {}; // {name<string>: TextLayout}
    }

    getAtlasFor(font) {
        return new Promise((resolve, _reject) => {
            const texPath = fontPaths[font].atlas;
            if (this.fonts[font]) {
                resolve(this.fonts[font]);
            } else {
                console.log("start loading");
                new THREE.TextureLoader().load(texPath, tex => {
                    this.fonts[font] = tex;
                    this.measurers[font] = new TextLayout({font: this.getInfo(font)});
                    console.log("loaded", tex);
                    resolve(tex);
                });
            }
        });
    }

    getInfo(font) {
        return fontPaths[font].json;
    }

    getTexture(font) {
        return this.fonts[font];
    }

    getMeasurer(font) {
        return this.measurers[font];
    }

    defaultFont() {
        return defaultFont;
    }

    measureText(text, formatting) {
        if (formatting === undefined) formatting = {};
        let fontName = formatting.font || defaultFont;
        let scale = (formatting.size || 10) / 10;
        if (!this.measurers[fontName]) {
            if (!this.measurers[defaultFont]) {
                return {ascent: 1, height: 2, descent: 1, width: 1};
            }
        }
        fontName = defaultFont;
        return this.measurers[fontName].measureText(text, scale);
    }
}

export let fontRegistry = new FontRegistry();
let debugFontRegistry = fontRegistry;
