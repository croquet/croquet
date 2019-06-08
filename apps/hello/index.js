import { startSession, Model, View } from "@croquet/teatime";

async function go() {

    console.log("xxx");

    const session = await startSession("hello", Model, View);

    console.log("yyy");

    // -- Main loop --

    window.requestAnimationFrame(frame);
    function frame(now) {
        session.step(now);

        window.requestAnimationFrame(frame);
    }
}

go();
