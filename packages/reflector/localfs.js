const fs = require("node:fs/promises");
const path = require("node:path");

class LocalFileHandle {
    constructor(path, mode) {
        this.path = path;
        this.mode = mode;
        this.handle = null;
        this.finishHandler = null;
        this.errorHandler = null;
        this.errored = null;
    }

    open() {
        const dir = path.dirname(this.path);
        if (this.mode === "w") {
            return fs.mkdir(dir, { recursive: true })
                .then(() => fs.open(this.path, this.mode))
                .then((handle) => {
                    this.handle = handle;
                    return this;
                });
        } else if (this.mode === "r") {
            return fs.open(this.path, this.mode)
                .then((handle) => {
                    this.handle = handle;
                    return this;
                });
        } else {
            this.errored = "unknown mode";
            return this.end();
        }
    }

    async write(str) {
        try {
            const result = await this.handle.write(str);
            return result;
        } catch (err) {
            errored = err;
        }
        return null;
    }

    async end() {
        if (this.handle) {
            await this.handle.close();
            this.handle = null;
        }
        if (this.errored) {
            if (this.errorHandler) {
                this.errorHandler(this.errored);
            }
            return;
        }
        if (this.finishHandler) {
            return this.finishHandler(this);
        }
    }

    on(evt, handler) {
        if (evt === "finish") {
            this.finishHandler = handler;
            return;
        }
        if (evt === "error") {
            this.errorHandler = handler;
            return;
        }
        if (evt === "data") {
            this.dataHandler = handler;
        }
        if (evt === "end") {
            setTimeout(async () => {
                this.endHandler = handler;
                if (this.mode === "r") {
                    let more = true;
                    while (more) {
                        let object = await this.handle.read();
                        // console.log("bytesRead", object.bytesRead);
                        if (object.bytesRead > 0) {
                            let str = object.buffer.toString("utf8", 0, object.bytesRead);
                            // console.log("read", str);
                            if (this.dataHandler) {
                                this.dataHandler(str);
                            }
                        } else {
                            more = false;
                            if (this.endHandler) {
                                this.endHandler(this);
                            }
                            await this.handle.close();
                            this.handle = null;
                        }
                    }
                }
            }, 1);
        }
    }
}

class LocalFile {
    constructor(path) {
            console.log("local file", path)
        this.path = path;
        this.handle = null;
    }

    async createWriteStream(options = {}) {
        this.handle = new LocalFileHandle(this.path, "w");
        await this.handle.open();
        return this.handle;
    }

    async createReadStream(options = {}) {
        this.handle = new LocalFileHandle(this.path, "r");
        await this.handle.open();
        return this.handle;
    }

    async delete() {
        return fs.unlink(this.path);
    }
}

class LocalDirectory {
    constructor(path) {
        this.path = path;
    }

    file(filename) {
        return new LocalFile(path.resolve(this.path, filename));
    }
}

exports.LocalDirectory = LocalDirectory;
