const test = require('tape-catch');
const { spawn } = require('child_process');
const concat = require('concat-stream');
const WebSocket = require('ws');

test('reflector.js should log "process" notices with event "start" and "end"', function (t) {
    // we plan for 1 assertion. See https://github.com/substack/tape#tplann
    t.plan(2);
    
    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    // we use concatStream to buffer stdout so we can parse/search it more easily.
    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'process' && logObj.event === 'start');
        t.ok(foundStart, "should find a log object with scope=process and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'process' && logObj.event === 'end');
        t.ok(foundEnd, "should find a log object with scope=process and event=end");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', (code, signal) => {
        t.end();
    });

    // give the server 2 seconds to start up before sending a kill signal.
    const timeoutID = setTimeout(() => {
        reflector.kill('SIGTERM'); // Send SIGTERM to process.
    }, 2000);
});


test('reflector should log "connection" notices with event "start" and "end"', function (t) {
    t.plan(2);
    
    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'connection' && logObj.event === 'start');
        t.ok(foundStart, "should find a log object with scope=connection and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'connection' && logObj.event === 'end');
        t.ok(foundEnd, "should find a log object with scope=connection and event=end");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', (code, signal) => {
        t.end();
    });

    t.teardown(() => {
        reflector.kill('SIGTERM');
    });

    // we set a timeout before trying to connect to the web socket server.
    // without this, we would get an error because the server wouldn't be ready yet.
    const timeoutID = setTimeout(() => {
        const ws = new WebSocket('ws://localhost:9090/test-session-id');

        ws.on('open', function open() {
            // after opening, we now want to close the connection
            this.close();
        });

        ws.on('close', function close() {
            reflector.kill('SIGTERM');
        });
    }, 1000);
    
});

test('reflector should log "session" notices with event "start" and "end"', function (t) {
    t.plan(2);

    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'session' && logObj.event === 'start');
        t.ok(foundStart, "should find a log object with scope=session and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'session' && logObj.event === 'end');
        t.ok(foundEnd, "should find a log object with scope=session and event=end");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', (code, signal) => {
        t.end();
    });

    t.teardown(() => {
        reflector.kill('SIGTERM');
    });

    // we set a timeout before trying to connect to the web socket server.
    // without this, we would get an error because the server wouldn't be ready yet.
    const timeoutID = setTimeout(() => {
        const ws = new WebSocket('ws://localhost:9090/test-session-id');

        ws.on('open', function open() {
            // first we send a JOIN action
            ws.send(JSON.stringify({
                action: 'JOIN',
                args: {
                    version: 1,
                }
            }));

            // close the connection
            this.close();
        });

        ws.on('close', function close() {
            reflector.kill('SIGTERM');
        });
    }, 1000);
});
