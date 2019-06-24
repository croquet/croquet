import ReactDom from 'react-dom';
import React from 'react';
import {ObservableModel, usePublish, useModelRoot, useObservable, InCroquetSession} from 'croquet-react';

class HelloWorldModel extends ObservableModel({count: 0}) {
    init() {
        super.init();
        this.future(1000).tick();
        this.subscribe("counter", "reset", () => this.resetCounter());
    }

    resetCounter() {
        this.count = 0;
    }

    tick() {
        this.count += 1;
        this.future(1000).tick();
    }
}

HelloWorldModel.register();

function HelloWorldApp() {
    return <InCroquetSession name="helloWorld" modelRoot={HelloWorldModel}>
        <Counter/>
    </InCroquetSession>;
}

function Counter() {
    /** @type {HelloWorldModel} */
    const model = useModelRoot();

    const {count} = useObservable(model);
    const publishReset = usePublish(() => ["counter", "reset"], []);

    return <div onClick={publishReset} style={{margin: "1em", fontSize: "3em", cursor: "pointer"}}>
        {count}
    </div>;
}

ReactDom.render(<HelloWorldApp/>, document.getElementById("app"));
