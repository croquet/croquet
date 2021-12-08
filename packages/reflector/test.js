/* eslint-disable import/no-extraneous-dependencies */
const test = require('tape-catch');
const { spawn } = require('child_process');
const concat = require('concat-stream');
const WebSocket = require('ws');

test('reflector.js should log "process" notices with event "start" and "end"', t => {
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

    reflector.on('close', () => t.end());

    // give the server 2 seconds to start up before sending a kill signal.
    setTimeout(() => reflector.kill('SIGTERM'), 2000);
});


test('reflector should log "connection" notices with event "start" and "end"', t => {
    t.plan(5);

    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'connection' && logObj.event === 'start');
        t.ok(foundStart, "should find a log object with scope=connection and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'connection' && logObj.event === 'end');
        t.ok(foundEnd, "should find a log object with scope=connection and event=end");
        const startId = foundStart.connection;
        t.ok(startId, "start object should have a connection id");
        const endId = foundEnd.connection;
        t.ok(endId, "end object should have a connection id");
        t.ok(startId === endId, "both start and end should have matching connection ids");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', () => t.end());

    t.teardown(() => reflector.kill('SIGTERM'));

    // we set a timeout before trying to connect to the web socket server.
    // without this, we would get an error because the server wouldn't be ready yet.
    setTimeout(() => {
        const ws = new WebSocket('ws://localhost:9090/test-session-id');

        ws.on('open', () => ws.close());

        ws.on('close', () => reflector.kill('SIGTERM'));
    }, 1000);

});

test('reflector should log "session" notices with event "start" and "end"', t => {
    t.plan(5);

    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'session' && logObj.event === 'start');
        t.ok(foundStart, "should find a log object with scope=session and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'session' && logObj.event === 'end');
        t.ok(foundEnd, "should find a log object with scope=session and event=end");
        const startId = foundStart.sessionId;
        t.ok(startId, "start object should have a session id");
        const endId = foundEnd.sessionId;
        t.ok(endId, "end object should have a session id");
        t.ok(startId === endId, "both start and end should have matching session ids");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', () => t.end());

    t.teardown(() => reflector.kill('SIGTERM'));

    // we set a timeout before trying to connect to the web socket server.
    // without this, we would get an error because the server wouldn't be ready yet.
    setTimeout(() => {
        const ws = new WebSocket('ws://localhost:9090/test-session-id');

        ws.on('open', () => {
            // first we send a JOIN action
            ws.send(JSON.stringify({
                action: 'JOIN',
                args: {
                    version: 1,
                }
            }));

            // close the connection
            ws.close();
        });

        ws.on('close', () => reflector.kill('SIGTERM'));
    }, 1000);
});
