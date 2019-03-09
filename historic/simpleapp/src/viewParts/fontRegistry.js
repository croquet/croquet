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
                    this.measurers[font] = new TextLayout({font});
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
}

export let fontRegistry = new FontRegistry();

let debugFontRegistry = fontRegistry;

