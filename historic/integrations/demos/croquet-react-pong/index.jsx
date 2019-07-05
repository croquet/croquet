import ReactDom from 'react-dom';
import React from 'react';
import {ObservableModel} from 'croquet';
import {useViewId, usePublish, useModelRoot, useObservable, InCroquetSession} from 'croquet-react';

// MODEL

const FIELD_HEIGHT = 1;
const FIELD_WIDTH = 2;
const BALL_INIT_VEL = 0.01;
const PADDLE_HEIGHT = 0.3;
const BALL_RADIUS = 0.05;
const TICK_LENGTH = 10;

const INITIAL_STATE = {
    ballX: FIELD_WIDTH/2, ballVelX: -BALL_INIT_VEL,
    ballY: FIELD_HEIGHT/2, ballVelY: 0,
    leftPaddleY: 0.5, leftPaddleVelY: 0,
    rightPaddleY: 0.5, rightPaddleVelY: 0,
    leftPoints: 0, leftPlayerId: null,
    rightPoints: 0, rightPlayerId: null,
    spectators: [], playerNames: {}
};

class PongModel extends ObservableModel(INITIAL_STATE) {
    init() {
        super.init();
        this.future(TICK_LENGTH).tick();
        this.subscribe(this.sessionId, "view-join", viewId => this.userEnter(viewId));
        this.subscribe(this.sessionId, "view-exit", viewId => this.userExit(viewId));
        this.subscribe("playerName", "set", data => this.setPlayerName(data));
        this.subscribe("paddle", "move", data => this.movePaddle(data));
    }

    userEnter(enteringViewId) {
        if (!this.leftPlayerId) {this.leftPlayerId = enteringViewId;}
        else if (!this.rightPlayerId) {this.rightPlayerId = enteringViewId;}
        else {this.spectators.push(enteringViewId)}
    }

    userExit(exitingViewId) {
        if (this.leftPlayerId === exitingViewId) this.leftPlayerId = this.spectators.shift() || null;
        else if (this.rightPlayerId === exitingViewId) this.rightPlayerId = this.spectators.shift() || null;
        delete this.playerNames[exitingViewId];
    }

    setPlayerName({playerId, name}) {
        this.playerNames[playerId] = name;
    }

    movePaddle({newY, playerId}) {
        if (this.leftPlayerId && playerId === this.leftPlayerId) {
            this.leftPaddleVelY = newY - this.leftPaddleY;
            this.leftPaddleY = newY;
        } else if (this.rightPlayerId && playerId === this.rightPlayerId) {
            this.rightPaddleVelY = newY - this.rightPaddleY;
            this.rightPaddleY = newY;
        }
    }

    tick() {
        this.ballX += this.ballVelX;
        this.ballY += this.ballVelY;
        this.leftPaddleVelY *= 0.5;
        this.rightPaddleVelY *= 0.5;

        // bounce off top and bottom walls
        if (this.ballY < 0) { this.ballVelY *= -1; this.ballY = 0; }
        else if (this.ballY > FIELD_HEIGHT) { this.ballVelY *= -1; this.ballY = FIELD_HEIGHT; }

        if (this.ballX < 0) {
            if (Math.abs(this.ballY - this.leftPaddleY) - BALL_RADIUS < PADDLE_HEIGHT / 2) {
                this.ballVelX *= -1; // reflect off left paddle
                this.ballVelY += 0.5 * this.leftPaddleVelY; // give it some "spin"
                this.ballX = 0;
            } else {
                this.rightPoints += 1; // left missed
                this.ballX = FIELD_WIDTH/2;
                this.ballY = FIELD_HEIGHT/2;
                this.ballVelX = BALL_INIT_VEL;
                this.ballVelY = 0;
            }
        } else if (this.ballX > FIELD_WIDTH) {
            if (Math.abs(this.ballY - this.rightPaddleY) - BALL_RADIUS < PADDLE_HEIGHT / 2) {
                this.ballVelX *= -1; // reflect off right paddle
                this.ballVelY += 0.5 * this.rightPaddleVelY; // give it some "spin"
                this.ballX = FIELD_WIDTH;
            } else {
                this.leftPoints += 1; // right missed
                this.ballX = FIELD_WIDTH/2;
                this.ballY = FIELD_HEIGHT/2;
                this.ballVelX = -BALL_INIT_VEL;
                this.ballVelY = 0;
            }
        }

        this.future(TICK_LENGTH).tick();
    }
}

PongModel.register();

// VIEW

function PongApp() {
    return <InCroquetSession name="pong" modelRoot={PongModel}>
        <PlayingField/>
    </InCroquetSession>;
}

function PlayingField() {
    /** @type {PongModel} */
    const model = useModelRoot();
    const user = {id: useViewId(), name: null}; // TODO

    const {
        leftPaddleY, rightPaddleY, ballX, ballY,
        leftPoints, rightPoints, leftPlayerId, rightPlayerId, playerNames,
    } = useObservable(model);

    // const publishPlayerName = usePublish((playerId, name) => ["playerName", "set", {playerId, name}]);
    // useEffect(() => publishPlayerName(user.id, user.name), []); // set our player name once

    const publishMovePaddle = usePublish((posFraction) => {
        if (user.id === leftPlayerId || (user.id === rightPlayerId)) {
            return ["paddle", "move", {newY: posFraction * FIELD_HEIGHT, playerId: user.id}];
        }
    }, [leftPlayerId, rightPlayerId]);

    return <PlayingFieldContainer onPaddleMove={publishMovePaddle}>
        <Paddle y={leftPaddleY} side="left"/>
        <Paddle y={rightPaddleY} side="right"/>
        <Ball x={ballX} y={ballY}/>
        <ScoreBoard left={leftPoints} right={rightPoints} leftPlayerId={leftPlayerId} rightPlayerId={rightPlayerId} playerNames={playerNames}/>
    </PlayingFieldContainer>;
}

function PlayingFieldContainer({onPaddleMove, children}) {
    return <div style={{position: "relative", width: "100vw", height: "50vw"}}>
        <div style={{position: "absolute", width: "80%", height: "80%", left: "10%", top: "10%", outline: "1px solid #aaa", overflow: "visible"}}
            onMouseMove={event => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onPaddleMove((event.clientY - bounds.top) / bounds.height)
            }}>
            {children}
        </div>
    </div>;
}

function Paddle({y, side}) {
    return <BlackRectangle x={side === "left" ? -0.1 : FIELD_WIDTH} y={y - PADDLE_HEIGHT/2} width={0.1} height={PADDLE_HEIGHT}/>;
}

function Ball({x, y}) {
    return <BlackRectangle x={x - BALL_RADIUS} y={y - BALL_RADIUS} width={2 * BALL_RADIUS} height={2 * BALL_RADIUS}/>;
}

function BlackRectangle({x, y, width, height}) {
    return <div style={{
        position: "absolute",
        left: (x/FIELD_WIDTH * 100) + "%",
        top: (y/FIELD_HEIGHT * 100) + "%",
        width: (width/FIELD_WIDTH * 100) + "%",
        height: (height/FIELD_HEIGHT * 100) + "%",
        backgroundColor: "#000"
    }}></div>;
}

function ScoreBoard({left, right, leftPlayerId, rightPlayerId, playerNames}) {
    const commonStyle = {position: "absolute", width: "10%", textAlign: "center"};
    const spectators = Object.entries(playerNames)
                             .filter(([id, _]) => parseInt(id, 10) !== leftPlayerId && parseInt(id, 10) !== rightPlayerId)
                             .map(([id, name]) => `${name} (${id})`);
    return <div>
        <div style={{...commonStyle, left: "20%", top: "1vw", fontSize: "5vw"}}>{left}</div>
        <div style={{...commonStyle, right: "20%", top: "1vw", fontSize: "5vw"}}>{right}</div>
        {leftPlayerId && <div style={{...commonStyle, left: "20%", top: "6vw", fontSize: "2vw"}}>
            {playerNames[leftPlayerId]}<br/><span style={{fontSize: "1vw"}}>({leftPlayerId})</span>
        </div>}
        {rightPlayerId && <div style={{...commonStyle, right: "20%", top: "6vw", fontSize: "2vw"}}>
            {playerNames[rightPlayerId]}<br/><span style={{fontSize: "1vw"}}>({rightPlayerId})</span>
        </div>}
        {spectators.length !== 0 && <div style={{position: "absolute", left: "10%", width: "80%", textAlign: "center", bottom: "1vw", fontSize: "2vw"}}>
            Spectators: {spectators.join(", ")}
        </div>}
    </div>;
}

ReactDom.render(<PongApp/>, document.getElementById("app"));
