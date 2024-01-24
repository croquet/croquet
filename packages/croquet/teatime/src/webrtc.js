const LIZZIE_SERVER = 'ws://138.68.6.125:9909';

function getRandomString(length) {
    return Math.random()
        .toString(36)
        .substring(2, 2 + length);
}

export class CroquetWebRTCConnection {
    constructor() {
        this.clientId = getRandomString(4);
        console.log(`${this.clientId} WebRTCConnection created`);

        this.pc = null;
        this.dataChannel = null;
        this.signaling = null;
        this.connectionTypes = {}; // { local: t, remote: t }

        // handlers supplied by the Controller (Connection).  'open' and
        // 'message' depend on the state of the data channel alone, while
        // 'error' and 'close' are triggered by:
        //   - the signalling channel
        //   - the RTCPeerConnection
        //   - the RTCDataChannel
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;

        // the controller also supplies a custom handler for a WebRTC
        // connection, because it happens in two stages: establishing
        // the socket, then negotiating and opening the data channel.
        // onconnected serves the latter stage.
        this.onconnected = null;

        this.url = "reflector"; // dummy value for logging
        this.bufferedAmount = 0; // keep the PULSE logic happy
    }

    isConnected() {
        return this.dataChannel?.readyState === 'open';
    }

    async openConnection(sessionId) {
        await this.openSignalingChannel(sessionId); // will never resolve if open fails
        console.log(`${this.clientId} signaling channel opened`);
        if (this.onopen) this.onopen(); // tell the controller that it has a socket (though not yet a connection to the reflector)
        await this.createPeerConnection();
        console.log(`${this.clientId} peer channel created`);

        this.dataChannel = this.pc.createDataChannel(`client-${this.clientId}`);
        console.log(`${this.clientId} data channel created`);
        this.dataChannel.onopen = evt => this.onDataChannelOpen(evt);
        this.dataChannel.onmessage = evt => this.onDataChannelMessage(evt);
        this.dataChannel.onclose = evt => this.onDataChannelClose(evt);
        this.dataChannel.onerror = evt => this.onDataChannelError(evt);

        const offer = await this.pc.createOffer();
        if (this.signaling?.readyState !== WebSocket.OPEN) return; // already lost the connection

        this.signalToSessionManager({ type: 'offer', sdp: offer.sdp });
        await this.pc.setLocalDescription(offer);

        // for some reason, the sctp property of the connection isn't set immediately
        // in createDataChannel... but after the calls above it seems to be reliably there.
        // ...except in Firefox.  Firefox just doesn't implement this stuff like the others.
        if (!this.pc.sctp) return; // probably Firefox

        // it also turns out that - at least in Chrome - the end of negotiation (signalled by
        // dataChannel's open event) happens some time before the transport's selected-pair
        // property is updated with the final choice.  so we watch all the choices as they're
        // made, whatever the current connection state.
        const iceTransport = this.pc.sctp.transport.iceTransport;
        iceTransport.onselectedcandidatepairchange = e => {
            console.log(`${this.clientId} ICE candidate pair changed`);
            const pair = iceTransport.getSelectedCandidatePair();
            this.connectionTypes.local = pair.local.type;
            this.connectionTypes.remote = pair.remote.type;
            this.logConnectionState();
        };
    }

    openSignalingChannel(sessionId) {
        if (this.signaling) {
            console.warn(`${this.clientId} signaling channel already open`);
            return Promise.resolve();
        }

        return new Promise(resolve => {
            // for the dummy session manager we encode in the connection URL the fact that
            // this is a client, and our ID.
            this.signaling = new WebSocket(`${LIZZIE_SERVER}/client/${this.clientId}/${sessionId}`);
            this.signaling.onopen = () => {
                console.log(`${this.clientId} signaling socket opened`);
                resolve();
            };
            this.signaling.onmessage = rawMsg => {
                const msgData = JSON.parse(rawMsg.data);
                console.log(`${this.clientId} received signal of type "${msgData.type}"`);
                switch (msgData.type) {
                    case 'offer':
                        // we don't expect this, since our client always makes the opening offer
                        this.handleOffer(msgData); // async
                        break;
                    case 'answer':
                        this.handleAnswer(msgData); // async
                        break;
                    case 'candidate':
                        this.handleCandidate(msgData); // async
                        break;
                    default:
                        console.log(`unhandled: ${msgData.type}`);
                        break;
                }
            };
            this.signaling.onclose = e => {
                // if we closed the socket on purpose, this handler will have
                // been removed - so this represents an unexpected closure,
                // presumably by the session manager (for example, on finding
                // that there is no reflector to serve the session).
                console.log(`${this.clientId} signaling socket closed unexpectedly (${e.code})`);
                this.reflectorDisconnected(e.code, e.reason);
            };
            this.signaling.onerror = e => {
                // as discussed at https://stackoverflow.com/questions/38181156/websockets-is-an-error-event-always-followed-by-a-close-event,
                // an error during opening is not *necessarily* followed by a close
                // event.  so our reflectorError() handling forces closure anyway.
                console.log(`${this.clientId} signaling socket error`, e);
                this.reflectorError();
            };
        });
    }

    signalToSessionManager(msg) {
        msg.id = this.clientId;
        const msgStr = JSON.stringify(msg);
        try {
            this.signaling.send(msgStr);
        } catch (e) {
            console.error(`${this.clientId} WebRTC signaling send error`, e);
            // a socket-send error could just be a malformed message,
            // so don't invoke reflectorError() which would trash the
            // connection.
        }
    }

    logConnectionState() {
        console.log(`${this.clientId} RTCDataChannel connection state: "${this.dataChannel.readyState}" (client connection="${this.connectionTypes.local || ''}"; reflector connection="${this.connectionTypes.remote || ''}")`);
    }

    close(_code, _message) {
        // sent by connection.closeConnection, triggered by various error
        // conditions in the controller or related to the connection itself
        // (e.g., dormancy detection).
        // the controller will be acting on the supplied code to decide whether
        // to trigger an automatic reconnection.
        this.cleanUpConnection();
    }

    reflectorDisconnected(code = 1006, reason = 'connection to reflector lost') {
        // triggered by a 'close' event from the signalling channel or data
        // channel.
        this.cleanUpConnection();
        if (this.onclose) this.onclose({ code, reason });
    }

    reflectorError(errorDetail) {
        // the controller assumes that with any reported error, the connection to
        // the reflector will be lost.  make sure that's the case.
        if (this.onerror) this.onerror();
        this.reflectorDisconnected(undefined, errorDetail); // ensures that the controller's onclose is called
    }

    cleanUpConnection() {
        this.closeSignalingChannel();
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.dataChannel = null;
    }

    closeSignalingChannel() {
        if (this.signaling) {
            this.signaling.onclose = null; // don't trigger
            this.signaling.close();
            this.signaling = null;
        }
    }

    async createPeerConnection() {
        // fetch STUN and TURN details from Open Relay (https://www.metered.ca/tools/openrelay/)
        const response = await fetch(process.env.ICE_SERVERS_URL);
        // (previous) const response = await fetch(process.env.ICE_SERVERS_URL); // Croquet's free API key
        const iceServers = await response.json();
        this.pc = new RTCPeerConnection({
            iceServers
            // iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.pc.onnegotiationneeded = _e => {
            console.log(`negotiationneeded event fired`);
        };
        this.pc.onsignalingstatechange = _e => {
            console.log(`signaling state: "${this.pc.signalingState}"`);
        };
        this.pc.onconnectionstatechange = _e => {
            console.log(`connection state: "${this.pc.connectionState}" (cf. ICE connection state: "${this.pc.iceConnectionState}")`);
        };
        this.pc.oniceconnectionstatechange = e => {
            const state = this.pc.iceConnectionState;
            const dataChannelState = this.dataChannel.readyState;
            console.log(`${this.clientId} ICE connection state: "${state}"; data channel: "${dataChannelState}"`);
            // if (state === 'disconnected') {
                /* note from https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState:
                Checks to ensure that components are still connected failed for at least one component of the RTCPeerConnection. This is a less stringent test than failed and may trigger intermittently and resolve just as spontaneously on less reliable networks, or during temporary disconnections. When the problem resolves, the connection may return to the connected state.
                */
                // this.reflectorDisconnected();  by the above reasoning, no.
            // }
            if (state === 'failed') {
                // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
                this.pc.restartIce();
            }
        };
        this.pc.onicecandidate = e => {
            // an ICE candidate (or null) has been generated locally.  our reflector's
            // node-datachannel API can't handle empty or null candidates (even though
            // the protocol says they can be used to indicate the end of the candidates)
            // - so we don't bother forwarding them.
            // also ignore these if the signalling connection has been lost.
            if (e.candidate && this.signaling?.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'candidate',
                    candidate: e.candidate.candidate,
                    sdpMid: e.candidate.sdpMid,
                    sdpMLineIndex: e.candidate.sdpMLineIndex
                };
                this.signalToSessionManager(message);
            }
        };
        this.pc.onicecandidateerror = e => {
            // it appears that these are generally not fatal.  report and
            // carry on.
            console.log(`${this.clientId} ICE error: ${e.errorText}`);
        };
    }

    async handleAnswer(answer) {
        // answer from remote
        if (!this.pc) {
            console.error('no peerconnection');
            return;
        }
        await this.pc.setRemoteDescription(answer);
    }

    async handleCandidate(candidate) {
        // ICE candidate from remote
        if (!this.pc) {
            console.error('no peerconnection');
            return;
        }

        if (!candidate.candidate) {
            await this.pc.addIceCandidate(null);
        } else {
            await this.pc.addIceCandidate(candidate);
        }
    }

    send(data) {
        // console.log("attempt to send", data, !!this.dataChannel);
        if (this.dataChannel) {
            this.dataChannel.send(data);
        } else {
            console.warn(`${this.clientId} no data channel to send: ${data}`);
        }
    }

    onDataChannelOpen(event) {
        console.log(`${this.clientId} RTCDataChannel open; closing signaling channel`);
        if (this.onconnected) this.onconnected();
        // this.closeSignalingChannel(); $$$ what if we keep it open?
        this.logConnectionState();
    }

    onDataChannelMessage(event) {
        if (!this.onmessage) return;

        const msg = event.data;
        // special case: if we receive "ping@<time>", immediately return "pong@<time>"
        if (msg.startsWith('!ping')) {
            this.send(msg.replace('ping', 'pong'));
            return;
        }

        // console.log(`Received message: ${msg}`);
        this.onmessage(event);
    }

    onDataChannelError(event) {
        console.error(`${this.clientId} RTCDataChannel error`, event);
        this.reflectorError(event.errorDetail); // will also close the connection
    }

    onDataChannelClose(_event) {
        // unexpected drop in the data channel
        if (!this.pc) return; // connection has already gone

        console.log(`${this.clientId} data channel closed`);
        this.reflectorDisconnected();
    }

    async defunct_readConnectionType() {
        // could be helpful if the onselectedcandidatepairchange approach turns out
        // not to work on some platform.  but beware calling this too soon after the
        // connection opens.
        const stats = await this.pc.getStats();
        if (stats) {
            let selectedPairId = null;
            for (const [key, stat] of stats) {
                if (stat.type === "transport") {
                    selectedPairId = stat.selectedCandidatePairId;
                    break;
                }
            }
            let candidatePair = stats.get(selectedPairId);
            if (!candidatePair) {
                for (const [key, stat] of stats) {
                    if (stat.type === "candidate-pair" && stat.selected) {
                        candidatePair = stat;
                        break;
                    }
                }
            }

            if (candidatePair) {
                for (const [key, stat] of stats) {
                    if (key === candidatePair.remoteCandidateId) {
                        return stat.candidateType;
                    }
                }
            }
        }
        return "";
    }

}
