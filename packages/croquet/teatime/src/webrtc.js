const LIZZIE_SERVER = 'ws://138.68.6.125:9909';

function getRandomString(length) {
    return Math.random()
        .toString(36)
        .substring(2, 2 + length);
}

export class WebRTCConnection {
    constructor() {
        this.clientId = getRandomString(4);

        this.pc = null;
        this.dataChannel = null;
        this.signaling = null;
        this.connectionTypes = {}; // { local: t, remote: t }
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
    }

    isConnected() {
        return this.dataChannel?.readyState === 'open';
    }

    async openConnection() {
        await this.openSignalingChannel();
        await this.createPeerConnection();

        this.dataChannel = this.pc.createDataChannel(`client-${this.clientId}`);
        this.dataChannel.onopen = evt => this.onDataChannelOpen(evt);
        this.dataChannel.onmessage = evt => this.onDataChannelMessage(evt);
        this.dataChannel.onclose = evt => this.onDataChannelClose(evt);
        this.dataChannel.onerror = evt => this.onDataChannelError(evt);

        const offer = await this.pc.createOffer();
        this.signalToRemote({ type: 'offer', sdp: offer.sdp });
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
            const pair = iceTransport.getSelectedCandidatePair();
            this.connectionTypes.local = pair.local.type;
            this.connectionTypes.remote = pair.remote.type;
            this.logConnectionState();
        };
    }

    openSignalingChannel() {
        if (this.signaling) {
            console.warn(`signaling channel already open`);
            return Promise.resolve();
        }

        return new Promise(resolve => {
            // for the dummy session manager we encode in the connection URL the fact that
            // this is a client, and our ID.
            this.signaling = new WebSocket(`${LIZZIE_SERVER}/client/${this.clientId}`);
            this.signaling.onopen = resolve;
            this.signaling.onmessage = rawMsg => {
                const msgData = JSON.parse(rawMsg.data);
                console.log(`received signal of type "${msgData.type}"`);
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
                    // case 'bye':
                    //     signaling.close();
                    //     break;
                    default:
                        console.log(`unhandled: ${msgData.type}`);
                        break;
                }
            };
            this.signaling.onclose = e => console.log(`signaling socket closed (${e.code})`);
            this.signaling.onerror = e => console.warn(`signaling socket error: ${e}`, e);
        });
    }

    signalToRemote(msg) {
        msg.id = this.clientId;
        const msgStr = JSON.stringify(msg);
        // console.log(`attempting to signal: ${msgStr}`);
        if (!this.signaling) {
            console.warn(`no channel for signaling message: ${msgStr}`);
            return;
        }
        if (this.signaling.readyState !== WebSocket.OPEN) {
            console.warn(`signaling socket not open for message: ${msgStr}`);
            return;
        }
        try {
            this.signaling.send(msgStr);
        } catch (e) { console.error(`error on signaling socket send:`, e); }
    }

    logConnectionState() {
        console.log(`${this.dataChannel.readyState}: client connection="${this.connectionTypes.local || ''}"; reflector connection="${this.connectionTypes.remote || ''}"`);
    }

    close(code, message) {
        // $$$ explicitly tell the reflector?
        this.disconnect();
    }

    async disconnect() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.dataChannel = null;
        console.log('Reflector connection is closed');
    }

    async createPeerConnection() {
        // fetch STUN and TURN details from Open Relay (https://www.metered.ca/tools/openrelay/)
        const response = await fetch(process.env.ICE_SERVERS_URL); // Croquet's free API key
        // const iceServers = await response.json(); $$$
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); // $$$
        this.pc.oniceconnectionstatechange = e => {
            const state = this.pc.iceConnectionState;
            console.log(`ICE connection state: ${state}`);
            if (state === 'disconnected') this.disconnect();
        };
        this.pc.onicecandidate = e => {
            // an ICE candidate (or null) has been generated locally.  our reflector's
            // node-datachannel API can't handle empty or null candidates (even though
            // the protocol says they can be used to indicate the end of the candidates)
            // - so we don't bother forwarding them.
            if (e.candidate) {
                const message = {
                    type: 'candidate',
                    candidate: e.candidate.candidate,
                    sdpMid: e.candidate.sdpMid,
                    sdpMLineIndex: e.candidate.sdpMLineIndex
                };
                this.signalToRemote(message);
            }
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
            console.warn(`no data channel to send: ${data}`);
        }
    }

    onDataChannelOpen(event) {
        console.log("data channel open");
        this.signaling.close(); // (sometimes?) raises an error on Safari, for unknown reasons
        this.signaling = null;
        this.logConnectionState();
        if (this.onopen) this.onopen(event);
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
        if (this.onerror) this.onerror(event);
        else console.error("unhandled dataChannel error:", event);
    }

    onDataChannelClose(event) {
        if (!this.pc) return; // connection has already gone

        console.log("data channel closed");
        if (this.onclose) this.onclose(event);
        this.disconnect();
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
