const test = require('tape');
const { spawn } = require('child_process');
const concat = require('concat-stream');

test('reflector.js should log a "process start" event upon start', function (t) {
    // we plan for 1 assertion. See https://github.com/substack/tape#tplann
    t.plan(1);
    
    const reflector = spawn('node', ['./reflector.js', '--standalone', '--no-logtime']);

    // we use concatStream to buffer stdout so we can parse/search it more easily.
    const concatStream = concat({encoding: 'string'}, stdoutBuffered => {
        const lines = stdoutBuffered.trim().split('\n');
        const logObjects = lines.map(JSON.parse);
        const found = logObjects.find(logObj => logObj.scope === 'process' && logObj.event == 'start');
        t.ok(found, "should find a log object with scope=process and event=start");
    });

    reflector.stdout.pipe(concatStream);

    reflector.on('close', (code, signal) => {
        t.end();
    });

    // give the server 2 seconds to start up before sending a kill signal.
    const timeoutID = setTimeout(() => {
        reflector.kill('SIGHUP'); // Send SIGHUP to process.
    }, 2000);
});
