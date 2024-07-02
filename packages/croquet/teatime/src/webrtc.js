const ICE_NEGOTIATION_MAX = 5000; // maximum ms between sending our offer and the data channel being operational.  analogous to the controller's JOIN_FAILED_DELAY, between sending of JOIN and receipt of SYNC.

/* eslint-disable-next-line */
const NODE = _IS_NODE_; // replaced by rollup
const FIREFOX = !NODE && !!globalThis.navigator?.userAgent.toLowerCase().includes('firefox');

function getRandomString(length) {
    return Math.random()
        .toString(36)
        .substring(2, 2 + length);
}

export class CroquetWebRTCConnection {
    static get name() { return 'CroquetWebRTCConnection'; }

    constructor(registryURL) {
        this.clientId = getRandomString(4); // used only locally, to tag console messages for debug purposes
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
        this.twoStageConnection = true;

        this.url = "synchronizer"; // dummy value for logging
        this.bufferedAmount = 0; // keep the PULSE logic happy

        this.openConnection(registryURL);
    }

    isConnecting() {
        return this.signaling?.readyState === WebSocket.OPEN;
    }

    isConnected() {
        return this.dataChannel?.readyState === 'open';
    }

    async openConnection(registryURL) {
        try {
            /* eslint-disable-next-line */
            _ENSURE_RTCPEERCONNECTION_

            await this.openSignalingChannel(registryURL); // will never resolve if open fails
            console.log(`${this.clientId} signaling channel opened`);
            if (this.onopen) this.onopen(); // tell the controller that it has a socket (though not yet a connection to the synchronizer)
            await this.createPeerConnection();
            console.log(`${this.clientId} peer channel created`);

            this.dataChannel = this.pc.createDataChannel(`client-${this.clientId}`);
            console.log(`${this.clientId} data channel created`);
            this.dataChannel.onopen = evt => this.onDataChannelOpen(evt);
            this.dataChannel.onmessage = evt => this.onDataChannelMessage(evt);
            this.dataChannel.onclosing = evt => this.onDataChannelClosing(evt);
            this.dataChannel.onclose = evt => this.onDataChannelClose(evt);
            this.dataChannel.onerror = evt => this.onDataChannelError(evt);

            const offer = await this.pc.createOffer();
            if (this.signaling?.readyState !== WebSocket.OPEN) return; // already lost the connection

            // set a deadline by which we expect to have completed ICE negotiation
            // and started using the data channel.  if the deadline expires, it
            // could just be because we're waiting for a response from a STUN or
            // TURN server that is in fact unreachable (as seen on Firefox through
            // VPN).  if dataChannelFlowing is already true, we proceed on the
            // assumption that negotiation has succeeded anyway.
            this.negotiationTimeout = setTimeout(() => {
                delete this.negotiationTimeout;
                if (this.dataChannelFlowing) {
                    // negotiation appears to have succeeded.  schedule signalling
                    // closure if not already taken care of.
                    if (!this.signalingCloseScheduled) {
                        console.log(`${this.clientId} ICE negotiation timed out but appears to have succeeded`);
                        this.scheduleSignalingClose();
                    }
                } else {
                    // it appears that negotiation hasn't succeeded.  tell the
                    // controller to scrap the connection altogether and try again.
                    this.synchronizerDisconnected(1006, "ICE negotiation timed out");
                }
            }, ICE_NEGOTIATION_MAX);

            this.signalToSessionRunner({ type: 'offer', sdp: offer.sdp });
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
                // not supported on Firefox
                console.log(`${this.clientId} ICE candidate pair changed`);
                const pair = iceTransport.getSelectedCandidatePair();
                this.connectionTypes.local = pair.local.type;
                this.connectionTypes.remote = pair.remote.type;
                this.logConnectionState();
            };
        } catch (e) { this.synchronizerDisconnected(4000, e.message); }
    }

    openSignalingChannel(registryURL) {
        if (this.signaling) {
            console.warn(`${this.clientId} signaling channel already open`);
            return Promise.resolve();
        }

        this.synchronizerGatheringComplete = false;
        this.localGatheringComplete = false;
        this.dataChannelFlowing = false;
        this.signalingCloseScheduled = false;
        this.signalingKey = Math.random(); // so we don't get confused by multiple openings and closings

        return new Promise(resolve => {
            this.signaling = new WebSocket(registryURL);
            this.signaling.onopen = () => {
                console.log(`${this.clientId} signaling socket opened`);
                resolve();
            };
            this.signaling.onmessage = rawMsg => {
                const msgData = JSON.parse(rawMsg.data);
                // $$$ temporary handling for errors passed through signalling
                if (msgData.error) {
                    console.error("error received through signaling", msgData.error);
                    return;
                }
                console.log(`${this.clientId} received signal of type "${msgData.type}"`);
                // console.log(`${this.clientId} received message`, msgData);
                switch (msgData.type) {
                    case 'answer':
                        this.handleAnswer(msgData); // async
                        break;
                    case 'candidate':
                        this.handleCandidate(msgData); // async
                        break;
                    case 'gathering-complete':
                        this.synchronizerGatheringComplete = true;
                        break;
                    default:
                        console.log(`unhandled: ${msgData.type}`);
                        break;
                }
            };
            this.signaling.onclose = e => {
                // if we closed the socket on purpose, this handler will have
                // been removed - so this represents an unexpected closure,
                // presumably by the session registry (for example, on finding
                // that there is no synchronizer to serve the session).
                console.log(`${this.clientId} signaling socket closed unexpectedly (${e.code})`);
                this.synchronizerDisconnected(e.code, e.reason);
            };
            this.signaling.onerror = e => {
                // as discussed at https://stackoverflow.com/questions/38181156/websockets-is-an-error-event-always-followed-by-a-close-event,
                // an error during opening is not *necessarily* followed by a close
                // event.  so our synchronizerError() handling forces closure anyway.
                console.log(`${this.clientId} signaling socket error`, e);
                this.synchronizerError();
            };
        });
    }

    clearNegotiationTimeout() {
        if (this.negotiationTimeout) {
            clearTimeout(this.negotiationTimeout);
            delete this.negotiationTimeout;
        }
    }

    signalToSessionRunner(msg) {
        const msgStr = JSON.stringify(msg);
        try {
            this.signaling.send(msgStr);
        } catch (e) {
            console.error(`${this.clientId} WebRTC signaling send error`, e);
            // a socket-send error could just be a malformed message,
            // so don't invoke synchronizerError() which would trash the
            // connection.
        }
    }

    async logConnectionState() {
        // @@ on at least Firefox and Node we can't rely on the onselectedcandidatepairchange
        // event to find the connection types
        if ((FIREFOX || NODE) && this.pc) {
            try {
                const stats = await this.pc.getStats();
                if (stats) {
                    let selectedPairId = null;
                    for (const stat of stats.values()) {
                        if (stat.type === "transport") {
                            selectedPairId = stat.selectedCandidatePairId;
                            break;
                        }
                    }
                    let candidatePair = stats.get(selectedPairId);
                    if (!candidatePair) {
                        for (const stat of stats.values()) {
                            if (stat.type === "candidate-pair" && stat.selected) {
                                candidatePair = stat;
                                break;
                            }
                        }
                    }
                    if (candidatePair) {
                        this.connectionTypes.local = stats.get(candidatePair.localCandidateId).candidateType;
                        this.connectionTypes.remote = stats.get(candidatePair.remoteCandidateId).candidateType;
                    }
                }
            } catch (e) { /* */ }
        }

        const clientType = this.connectionTypes.local || '';
        const syncType = this.connectionTypes.remote || '';
        console.log(`${this.clientId} RTCDataChannel connection state: "${this.dataChannel.readyState}" (client connection="${clientType}"; synchronizer connection="${syncType}")`);
        if (this.signaling?.readyState === WebSocket.OPEN) {
            const message = {
                type: 'selectedCandidatePair',
                clientType,
                syncType
            };
            this.signalToSessionRunner(message);
        }
    }

    close(_code, _message) {
        // sent by connection.closeConnection, triggered by various error
        // conditions in the controller or related to the connection itself
        // (e.g., dormancy detection).
        // the controller will be acting on the supplied code to decide whether
        // to trigger an automatic reconnection.
        this.cleanUpConnection();
    }

    synchronizerDisconnected(code = 1006, reason = 'connection to synchronizer lost') {
        // triggered by a 'close' event from the signalling channel or data
        // channel, or timeout of the ICE negotiation.
        // in the particular case of a synchronizer-requested closure, we should
        // have already received a code and reason.
        if (this.synchronizerCloseReason) {
            code = this.synchronizerCloseReason[0];
            reason = this.synchronizerCloseReason[1];
        }
        this.cleanUpConnection();
        if (this.onclose) this.onclose({ code, reason });
    }

    synchronizerError(errorDetail) {
        // the controller assumes that with any reported error, the connection to
        // the synchronizer will be lost.  make sure that's the case.
        if (this.onerror) this.onerror();
        this.synchronizerDisconnected(undefined, errorDetail); // ensures that the controller's onclose is called
    }

    cleanUpConnection() {
        this.closeSignalingChannel();
        if (this.pc) {
            this.pc.close();
            this.pc = null;
            clearInterval(this.peerConnectionStatsInterval);
        }
        this.dataChannel = null;
    }

    closeSignalingChannel() {
        // closure either means that data-channel negotiation has completed
        // successfully, or that there was some kind of error during negotiation
        // that we are treating as fatal.
        this.clearNegotiationTimeout();
        if (this.signaling) {
            this.signaling.onclose = null; // don't trigger
            this.signaling.onerror = null;
            this.signaling.close();
            this.signaling = null;
        }
    }

    async createPeerConnection() {
        // fetch STUN and TURN details from Open Relay (https://www.metered.ca/tools/openrelay/)
        const response = await fetch(process.env.ICE_SERVERS_URL);
        // (previous) const response = await fetch(process.env.ICE_SERVERS_URL); // Croquet's free API key
        const iceServers = await response.json();
        this.pc = new globalThis.RTCPeerConnection({
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
            const { connectionState, iceConnectionState } = this.pc;
            console.log(`connection state: "${connectionState}" (cf. ICE connection state: "${iceConnectionState}")`);
            if (connectionState === 'disconnected' || connectionState === 'failed') this.synchronizerDisconnected();
        };
        this.pc.oniceconnectionstatechange = _e => {
            const state = this.pc.iceConnectionState;
            const dataChannelState = this.dataChannel.readyState;
            console.log(`${this.clientId} ICE connection state: "${state}"; data channel: "${dataChannelState}"`);
            // if (state === 'disconnected') {
                /* note from https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState:
                Checks to ensure that components are still connected failed for at least one component of the RTCPeerConnection. This is a less stringent test than failed and may trigger intermittently and resolve just as spontaneously on less reliable networks, or during temporary disconnections. When the problem resolves, the connection may return to the connected state.
                */
                // this.synchronizerDisconnected();  by the above reasoning, no.
            // }
            if (state === 'failed') {
                // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
                this.pc.restartIce();
            }
        };
        this.pc.onicecandidate = e => {
            // an ICE candidate (or null) has been generated locally.  our synchronizer's
            // node-datachannel API can't handle empty or null candidates (even though
            // the protocol says they can be used to indicate the end of the candidates)
            // - so we don't bother forwarding them.  but note that we've finished
            // gathering candidates, and can close the signalling connection if the
            // synchronizer has finished too.
            if (!e.candidate) {
                this.localGatheringComplete = true;
                return;
            }

            // also ignore if the signalling connection has been lost.
            if (this.signaling?.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'candidate',
                    candidate: e.candidate.candidate,
                    sdpMid: e.candidate.sdpMid,
                    sdpMLineIndex: e.candidate.sdpMLineIndex
                };
                this.signalToSessionRunner(message);
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
        console.log(`${this.clientId} RTCDataChannel open`);
        if (this.onconnected) this.onconnected();
        this.logConnectionState();
    }

    onDataChannelMessage(event) {
        if (!this.onmessage) return;

        // once messages are flowing and candidate gathering is complete at
        // both ends, make sure the signalling channel is closed.
        // we check this here, rather than on some connection-status change,
        // to guarantee that the synchronizer has this channel in its server.clients
        // and therefore won't kill the entire peer connection when the signalling
        // shuts down.
        // because Chrome, at least, has a habit of choosing a candidate pair
        // early then switching later, we delay this handling by 1 second to
        // increase the probability that ICE has indeed fully settled.
        // jun 2024: first seen in Firefox clients running through a VPN: candidate
        // generation can be held up around 10 seconds for some connection methods,
        // so the null candidate that signals end of gathering can be delayed even
        // though negotiation has succeeded (so localGatheringComplete remains false).
        // on expiry of ICE_NEGOTIATION_MAXIMUM we now proceed with closure of the
        // signalling channel if the connection appears to be up and running.
        this.dataChannelFlowing = true;
        if (!this.signalingCloseScheduled && this.synchronizerGatheringComplete && this.localGatheringComplete) {
            this.clearNegotiationTimeout(); // negotiation has successfully completed
            this.scheduleSignalingClose();
        }

        const msg = event.data;
        // special case: if we receive "!ping@<time>", immediately return "!pong@<time>"
        if (msg.startsWith('!ping')) {
            this.send(msg.replace('ping', 'pong'));
            return;
        }
        // special case: "!close|code|reason" indicates reason for an imminent closure
        if (msg.startsWith('!close')) {
            const parts = msg.split('|');
            this.synchronizerCloseReason = [Number(parts[1]), parts[2]];
            return;
        }

        // console.log(`Received message: ${msg}`);
        this.onmessage(event);
    }

    onDataChannelError(event) {
        console.error(`${this.clientId} RTCDataChannel error`, event);
        this.synchronizerError(event.errorDetail); // will also close the connection
    }

    onDataChannelClosing(_event) {
        // unexpected drop in the data channel.
        // this event sometimes (??) arrives as soon as the remote end goes away -
        // whereas the next event (ICE connection state => "disconnected")
        // isn't triggered for another 5 or 6 seconds.
        if (!this.pc) return; // connection has already gone

        console.log(`${this.clientId} data channel closing`);
        this.synchronizerDisconnected();
    }

    onDataChannelClose(_event) {
        // unexpected drop in the data channel
        if (!this.pc) return; // connection has already gone

        console.log(`${this.clientId} data channel closed`);
        this.synchronizerDisconnected();
    }

    scheduleSignalingClose() {
        this.signalingCloseScheduled = true;
        console.log(`${this.clientId} signaling channel closure scheduled`);
        const { signalingKey } = this;
        setTimeout(() => {
            if (signalingKey === this.signalingKey) {
                console.log(`${this.clientId} closing signaling channel`);
                this.closeSignalingChannel();
            }
        }, 1000);

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
