import { mediasoup } from './config.js';
import { RECORD_FILE_LOCATION_PATH } from './ffmpeg.js';

export default class Room {
  constructor(global_id, room_id, owner, rule, worker, io, renderQueue) {
    this.global_id = global_id;
    this.id = room_id;
    this.owner = owner;
    this.maxCount = rule.teamSize * rule.orderSize;
    this.rule = rule;
    this.teamSize = rule.teamSize;
    this.orderSize = rule.orderSize;
    this.locatePeer = new Array(this.maxCount);
    this.count = 0;
    this.isStart = false;
    this.waitProcessCount = 0;
    this.renderQueue = renderQueue;
    const mediaCodecs = mediasoup.router.mediaCodecs;
    worker
      .createRouter({
        mediaCodecs
      })
      .then(
        function (router) {
          this.router = router;
        }.bind(this)
      );

    this.peers = new Map();
    this.io = io;
  }

  loop(data) {
    if (data.length == 0) {
      this.peers.forEach((peer) => {
        peer.sendRule({ debater: 'end' });
        peer.stopRecord();
      });
      return;
    }
    const cur = data.shift();
    this.peers.forEach((peer) => {
      peer.sendRule(cur);
    });
    setTimeout(() => {
      this.loop(data);
    }, cur.time * 1000);
  }

  closeRecordProcess() {
    this.waitProcessCount--;
    console.log(this.waitProcessCount);
    if (this.waitProcessCount == 0) {
      const members = [];
      for (let i = 0; i < this.teamSize; i++)
        for (let j = 0; j < this.orderSize; j++)
          members.push({ 
            debater: `team_${i}_${j}`,
            filename: `${RECORD_FILE_LOCATION_PATH}/${this.locatePeer[i*this.teamSize + j].getId()}.webm`
          });
      console.log(`Record finished:`, {
        global_id: this.global_id,
        name: this.rule.name,
        description: this.rule.description,
        team_size: this.teamSize,
        order_size: this.orderSize,
        members: members,
        rules: this.rule.rules
      });
    }
  }

  start(name) {
    if (name !== this.owner)
      return false;
    this.waitProcessCount = this.count;
    this.peers.forEach((peer) => {
      peer.startRecord(this.router, () => this.closeRecordProcess());
    });
    this.loop(structuredClone(this.rule.rules));
    return true;
  }

  joinable() {
    return this.count < this.maxCount;
  }

  setLocatePeer(peer) {
    for (let i = 0; i < this.teamSize; i++) {
      for (let j = 0; j < this.orderSize; j++) {
        if (this.locatePeer[i * this.orderSize + j] === undefined) {
          this.locatePeer[i * this.orderSize + j] = peer;
          return [i, j];
        }
      }
    }
    return null;
  }

  removeLocatePeer(peer) {
    for (let i = 0; i < this.teamSize; i++) {
      for (let j = 0; j < this.orderSize; j++) {
        if (this.locatePeer[i * this.orderSize + j] == peer) {
          this.locatePeer[i * this.orderSize + j] = undefined;
        }
      }
    }
  }

  swapLocatePeer(socket_id, team_0, order_0, team_1, order_1) {
    let buf = this.locatePeer[team_0 * this.orderSize + order_0];
    this.locatePeer[team_0 * this.orderSize + order_0] = this.locatePeer[team_1 * this.orderSize + order_1];
    this.locatePeer[team_1 * this.orderSize + order_1] = buf;
    this.broadCast(socket_id, 'swapUser', { 
      team_0, order_0, team_1, order_1
    });
  }

  addPeer(peer) {
    let locate = this.setLocatePeer(peer);
    if (locate == null)
      return null;
    this.broadCast(peer.socket_id, 'addUser', { 
      id: peer.id, name: peer.name, team: locate[0], order: locate[1]
    });
    this.peers.set(peer.id, peer);
    this.count++;
    
    return locate;
  }

  getProducerListForPeer() {
    let producerList = [];
    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producerList.push({
          producer_id: producer.id
        });
      });
    });
    return producerList;
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(socket_id) {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = mediasoup.webRtcTransport;

    const transport = await this.router.createWebRtcTransport({
      listenIps: mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate
    });
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (error) {
        console.log(error);
      }
    }

    transport.on(
      'dtlsstatechange',
      function (dtlsState) {
        if (dtlsState === 'closed') {
          console.log('Transport close', { name: this.peers.get(socket_id).name });
          transport.close();
        }
      }.bind(this)
    );

    transport.on('close', () => {
      console.log('Transport close', { name: this.peers.get(socket_id).name });
    });

    console.log('Adding transport', { transportId: transport.id });
    this.peers.get(socket_id).addTransport(transport);
    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    };
  }

  async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
    if (!this.peers.has(socket_id)) return;

    await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters);
  }

  async produce(socket_id, producerTransportId, rtpParameters, kind) {
    // handle undefined errors
    return new Promise(
      async function (resolve, reject) {
        let producer = await this.peers.get(socket_id).createProducer(producerTransportId, rtpParameters, kind);
        resolve(producer.id);
        this.broadCast(socket_id, 'newProducers', [
          {
            producer_id: producer.id,
            id: socket_id
          }
        ]);
      }.bind(this)
    );
  }

  async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
    // handle nulls
    if (
      !this.router.canConsume({
        producerId: producer_id,
        rtpCapabilities
      })
    ) {
      console.error('can not consume');
      return;
    }

    let { consumer, params } = await this.peers
      .get(socket_id)
      .createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

    consumer.on(
      'producerclose',
      function () {
        console.log('Consumer closed due to producerclose event', {
          name: `${this.peers.get(socket_id).name}`,
          consumer_id: `${consumer.id}`
        });
        this.peers.get(socket_id).removeConsumer(consumer.id);
        // tell client consumer is dead
        this.io.to(socket_id).emit('consumerClosed', {
          consumer_id: consumer.id
        });
      }.bind(this)
    );

    return params;
  }

  async removePeer(socket_id) {
    let peer = this.peers.get(socket_id);
    peer.close();
    this.peers.delete(socket_id);
    this.broadCast(socket_id, 'removeUser', { id: socket_id });
    this.count--;
    this.removeLocatePeer(peer);
  }

  closeProducer(socket_id, producer_id) {
    this.peers.get(socket_id).closeProducer(producer_id);
  }

  broadCast(socket_id, name, data) {
    for (let otherID of Array.from(this.peers.keys()).filter((id) => id !== socket_id)) {
      this.send(otherID, name, data);
    }
  }

  send(socket_id, name, data) {
    this.io.to(socket_id).emit(name, data);
  }

  getPeers() {
    return this.peers;
  }

  toJson() {
    function replacer(key, value) {
      // Filtering out properties
      if (key === "socket") {
        return undefined;
      }
      return value;
    }
    return {
      id: this.id,
      teamSize: this.teamSize,
      orderSize: this.orderSize,
      peers: JSON.stringify([...this.peers], replacer)
    };
  }
}
