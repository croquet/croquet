const test = require('tape');
const { spawn } = require('child_process');
const concat = require('concat-stream');

test('reflector.js should log "process" notices with event "start" and "end"', function (t) {
    // we plan for 1 assertion. See https://github.com/substack/tape#tplann
    t.plan(2);
    
    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    // we use concatStream to buffer stdout so we can parse/search it more easily.
    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const foundStart = logObjects.find(logObj => logObj.scope === 'process' && logObj.event == 'start');
        t.ok(foundStart, "should find a log object with scope=process and event=start");
        const foundEnd = logObjects.find(logObj => logObj.scope === 'process' && logObj.event == 'end');
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
